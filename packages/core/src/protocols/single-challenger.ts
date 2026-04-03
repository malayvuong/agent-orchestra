import { randomUUID } from 'node:crypto'
import type { ProtocolRunner } from '../interfaces/protocol-runner.js'
import type { Job, FailurePolicy } from '../types/job.js'
import type { ProtocolExecutionDeps } from '../types/orchestrator.js'
import type {
  Round,
  RoundState,
  ApplySummary,
  FinalCheckSummary,
  FinalCheckVerdict,
} from '../types/protocol.js'
import type { AgentAssignment } from '../types/agent.js'
import type { AgentOutput, ProviderOutput } from '../types/output.js'
import type { Finding } from '../types/finding.js'
import type { RoundStore } from '../storage/types.js'
import type { ConversationStore } from '../storage/conversation-types.js'
import type { AgentMessage, ContentBlock, TextBlock } from '../types/message.js'
import type { RenderedPrompt } from '../templates/types.js'
import type { EventBus } from '../events/event-bus.js'
import type { DebateEventMap } from '../events/debate-events.js'
import { renderTemplate } from '../templates/renderer.js'
import { architectAnalysisTemplate } from '../templates/defaults/architect-analysis.js'
import { reviewerByLensTemplate } from '../templates/defaults/reviewer-by-lens.js'
import { architectResponseTemplate } from '../templates/defaults/architect-response.js'
import { reviewerFollowupTemplate } from '../templates/defaults/reviewer-followup.js'
import { architectApplyTemplate } from '../templates/defaults/architect-apply.js'
import { reviewerFinalCheckTemplate } from '../templates/defaults/reviewer-final-check.js'
import { parseApplyOutput, type PatchOperation } from '../apply/parse-apply-output.js'

/**
 * Minimal interface matching what we need from the provider executor.
 * The actual AgentProvider from @malayvuong/agent-orchestra-providers satisfies this contract.
 */
interface ProviderExecutor {
  run(input: {
    systemPrompt: string
    userPrompt: string
    model: string
    maxTokens?: number
    temperature?: number
    timeoutMs?: number
    abortSignal?: AbortSignal
  }): Promise<ProviderOutput>
}

/**
 * Provider router interface for per-agent provider dispatch.
 * When present, the runner uses forAgent() to resolve the provider for each agent.
 * Falls back to using the executor directly if forAgent() is not available.
 */
interface ProviderRouter extends ProviderExecutor {
  forAgent(agent: AgentAssignment): ProviderExecutor
}

/** Default failure policy per spec v1.3 SS9.3 */
const DEFAULT_FAILURE_POLICY: FailurePolicy = {
  reviewerFailure: 'continue_with_partial_results',
  architectFailure: 'fail_job',
  builderFailure: 'fail_job',
  maxRetriesPerAgent: 2,
  agentTimeoutMsDefault: 900_000,
}

/**
 * SingleChallengerRunner implements the `single_challenger` protocol.
 *
 * Step sequence: analysis -> review -> (rebuttal -> inline apply -> follow-up)* -> convergence.
 *
 * 1. Architect analyzes the target code
 * 2. Reviewer reviews with lens focus, building on architect findings
 * 3. Architect responds to reviewer findings (rebuttal)
 * 4. Architect patches the live file(s) inline when auto-apply is enabled
 * 5. Reviewer re-reads the patched file(s) and continues the debate
 * 6. Convergence: collect and synthesize all findings
 */
export class SingleChallengerRunner implements ProtocolRunner {
  async execute(job: Job, deps: ProtocolExecutionDeps): Promise<void> {
    const providerExecutor = deps.providerExecutor as ProviderExecutor | ProviderRouter
    const roundStore = deps.roundStore as RoundStore
    const eventBus = deps.eventBus as EventBus<DebateEventMap>
    const resolvedSkills = deps.resolvedSkills ?? []

    const failurePolicy = job.failurePolicy ?? DEFAULT_FAILURE_POLICY

    // Resolve agents
    const architect = job.agents.find((a) => a.role === 'architect')
    const reviewer = job.agents.find((a) => a.role === 'reviewer')

    if (!architect) {
      throw new Error('single_challenger protocol requires an architect agent')
    }
    if (!reviewer) {
      throw new Error('single_challenger protocol requires a reviewer agent')
    }

    const agentCount = job.agents.filter((a) => a.enabled).length
    const autoApplyRequested = job.runtimeConfig?.autoApply ?? false
    const terminalReservation = 2
    const minimumRequiredRounds = autoApplyRequested ? 6 : 5
    const totalRoundBudget = this.resolveTotalRoundBudget(job, agentCount, autoApplyRequested)

    if (totalRoundBudget < minimumRequiredRounds) {
      throw new Error(
        `single_challenger protocol requires at least ${minimumRequiredRounds} max rounds` +
          `${autoApplyRequested ? ' when auto-apply is enabled' : ''}`,
      )
    }

    let roundIndex = 0
    const allFindings: Finding[] = []
    let aggregateApplySummary: ApplySummary | undefined

    // Structured conversation log (replaces debateHistory: string[])
    const conversationStore = deps.conversationStore as ConversationStore | undefined

    // Max chars for debate history to prevent context overflow.
    // Keep ~40K chars — enough for 2-3 full rounds of context.
    const MAX_DEBATE_HISTORY_CHARS = 40_000

    // -----------------------------------------------------------------------
    // Step 1: Analysis
    // -----------------------------------------------------------------------
    this.checkCancellation(job.id, deps)

    const architectOutput = await this.runStep({
      job,
      agent: architect,
      state: 'analysis',
      roundIndex: roundIndex++,
      deps,
      providerExecutor,
      roundStore,
      eventBus,
      renderPrompt: async () => {
        const currentSnapshot = await this.readCurrentScopeSnapshot(job)
        const context = deps.contextBuilder.buildFor(architect, job, {
          skills: resolvedSkills,
          lifecyclePoint: 'pre_round',
        })
        return renderTemplate(architectAnalysisTemplate, {
          brief: job.brief,
          current_content: currentSnapshot.formatted,
          scope: JSON.stringify(job.scope.primaryTargets),
          skill_context: context.skillContext ?? '',
        })
      },
      failurePolicy,
      isCritical: true,
    })

    if (architectOutput) {
      allFindings.push(...architectOutput.findings)
      await this.appendToConversation(
        conversationStore,
        architectOutput,
        job.id,
        roundIndex - 1,
        architect,
        'analysis',
      )
    }

    // -----------------------------------------------------------------------
    // Step 2: Initial Review
    // -----------------------------------------------------------------------
    this.checkCancellation(job.id, deps)

    const architectFindingsText = architectOutput
      ? this.formatFindings(architectOutput.findings)
      : '(no architect findings)'

    let lastReviewerOutput = await this.runStep({
      job,
      agent: reviewer,
      state: 'review',
      roundIndex: roundIndex++,
      deps,
      providerExecutor,
      roundStore,
      eventBus,
      renderPrompt: async () => {
        const currentSnapshot = await this.readCurrentScopeSnapshot(job)
        const context = deps.contextBuilder.buildFor(reviewer, job, {
          skills: resolvedSkills,
          lifecyclePoint: 'pre_round',
        })
        return renderTemplate(reviewerByLensTemplate, {
          brief: job.brief,
          current_content: currentSnapshot.formatted,
          scope: JSON.stringify(job.scope.primaryTargets),
          lens: reviewer.lens ?? 'general',
          findings: architectFindingsText,
          skill_context: context.skillContext ?? '',
        })
      },
      failurePolicy,
      isCritical: false,
    })

    if (lastReviewerOutput) {
      allFindings.push(...lastReviewerOutput.findings)
      await this.appendToConversation(
        conversationStore,
        lastReviewerOutput,
        job.id,
        roundIndex - 1,
        reviewer,
        'review',
      )
    }

    // -----------------------------------------------------------------------
    // Iterative Debate Loop: response → followup → response → followup → ...
    // -----------------------------------------------------------------------
    let debateRound = 0

    while (roundIndex < totalRoundBudget - terminalReservation) {
      debateRound++
      this.checkCancellation(job.id, deps)

      // --- Architect Response (acknowledge + apply + discover) ---
      const lastReviewerText = lastReviewerOutput
        ? this.formatFindings(lastReviewerOutput.findings)
        : '(no reviewer findings)'
      const reviewerFindings = lastReviewerOutput?.findings ?? []

      const responseOutput = await this.runStep({
        job,
        agent: architect,
        state: 'rebuttal',
        roundIndex: roundIndex++,
        deps,
        providerExecutor,
        roundStore,
        eventBus,
        renderPrompt: async () => {
          const currentSnapshot = await this.readCurrentScopeSnapshot(job)
          // Always use iterative response template — acknowledge, apply, discover
          return renderTemplate(architectResponseTemplate, {
            brief: job.brief,
            current_content: currentSnapshot.formatted,
            scope: JSON.stringify(job.scope.primaryTargets),
            findings: lastReviewerText,
            clusters: '(clustering not yet implemented)',
            debate_history: await this.loadFormattedHistory(
              conversationStore,
              job.id,
              MAX_DEBATE_HISTORY_CHARS,
            ),
            skill_context:
              deps.contextBuilder.buildFor(architect, job, {
                skills: resolvedSkills,
                lifecyclePoint: 'pre_round',
              }).skillContext ?? '',
          })
        },
        failurePolicy,
        isCritical: true,
      })

      if (responseOutput) {
        allFindings.push(...responseOutput.findings)
        await this.appendToConversation(
          conversationStore,
          responseOutput,
          job.id,
          roundIndex - 1,
          architect,
          'rebuttal',
        )
      }

      const acknowledgedReviewerFindings = responseOutput
        ? this.selectAcknowledgedReviewerFindings(reviewerFindings, responseOutput.rawText)
        : []

      if (
        autoApplyRequested &&
        acknowledgedReviewerFindings.length > 0 &&
        roundIndex < totalRoundBudget - terminalReservation
      ) {
        this.checkCancellation(job.id, deps)

        const inlineApplySummary = await this.runApplyStep({
          job,
          agent: architect,
          roundIndex: roundIndex++,
          deps,
          providerExecutor,
          roundStore,
          eventBus,
          findingsToApply: acknowledgedReviewerFindings,
          architectResponseText: responseOutput?.rawText ?? '',
          failurePolicy,
        })
        aggregateApplySummary = this.mergeApplySummaries(aggregateApplySummary, inlineApplySummary)
      }

      if (roundIndex >= totalRoundBudget - terminalReservation) break

      const hasBudgetForReviewerFollowup = roundIndex < totalRoundBudget - terminalReservation
      if (!hasBudgetForReviewerFollowup) break

      // --- Reviewer Follow-up ---
      this.checkCancellation(job.id, deps)

      const responseText = responseOutput ? responseOutput.rawText : '(no architect response)'

      lastReviewerOutput = await this.runStep({
        job,
        agent: reviewer,
        state: 'review',
        roundIndex: roundIndex++,
        deps,
        providerExecutor,
        roundStore,
        eventBus,
        renderPrompt: async () => {
          const currentSnapshot = await this.readCurrentScopeSnapshot(job)
          const context = deps.contextBuilder.buildFor(reviewer, job, {
            skills: resolvedSkills,
            lifecyclePoint: 'pre_round',
          })
          return renderTemplate(reviewerFollowupTemplate, {
            brief: job.brief,
            current_content: currentSnapshot.formatted,
            scope: JSON.stringify(job.scope.primaryTargets),
            lens: reviewer.lens ?? 'general',
            findings: responseText,
            debate_history: await this.loadFormattedHistory(
              conversationStore,
              job.id,
              MAX_DEBATE_HISTORY_CHARS,
            ),
            skill_context: context.skillContext ?? '',
          })
        },
        failurePolicy,
        isCritical: false,
      })

      if (lastReviewerOutput) {
        allFindings.push(...lastReviewerOutput.findings)
        await this.appendToConversation(
          conversationStore,
          lastReviewerOutput,
          job.id,
          roundIndex - 1,
          reviewer,
          'review',
        )

        // Convergence detection: if reviewer found 0 new findings, stop
        if (lastReviewerOutput.findings.length === 0) {
          // Check rawText for explicit convergence signal
          const rawLower = lastReviewerOutput.rawText.toLowerCase()
          if (rawLower.includes('no new findings') || rawLower.includes('debate converged')) {
            break
          }
        }
      } else {
        // Reviewer failed — stop iterating
        break
      }
    }

    // -----------------------------------------------------------------------
    // Final: Convergence
    // -----------------------------------------------------------------------
    this.checkCancellation(job.id, deps)

    const synthesisFindings = this.deduplicateFindings(allFindings)

    const convergenceRound: Round = {
      id: randomUUID(),
      jobId: job.id,
      index: roundIndex,
      state: 'convergence',
      reviewerOutputs: [],
      architectOutput: {
        rawText: `Synthesis complete. ${synthesisFindings.length} unique findings from ${debateRound} debate round(s).`,
        structuredSections: {},
        findings: synthesisFindings,
        warnings: [],
      },
      summary: `Converged with ${synthesisFindings.length} findings from ${roundIndex} rounds (${debateRound} debate cycles).`,
      createdAt: new Date().toISOString(),
    }

    await roundStore.save(convergenceRound)

    eventBus.emit('round:start', {
      type: 'round:start',
      jobId: job.id,
      roundIndex,
      state: 'convergence',
      timestamp: new Date().toISOString(),
    })

    eventBus.emit('round:complete', {
      type: 'round:complete',
      jobId: job.id,
      roundIndex,
      state: 'convergence',
      timestamp: new Date().toISOString(),
    })

    eventBus.emit('synthesis:ready', {
      type: 'synthesis:ready',
      jobId: job.id,
      timestamp: new Date().toISOString(),
    })

    // -----------------------------------------------------------------------
    // Final check phase: compare final artifact vs original baseline
    // -----------------------------------------------------------------------
    this.checkCancellation(job.id, deps)
    roundIndex++

    await this.runFinalCheckStep({
      job,
      agent: reviewer,
      roundIndex,
      deps,
      providerExecutor,
      roundStore,
      eventBus,
      synthesisFindings,
      applySummary: aggregateApplySummary,
      failurePolicy,
    })
  }

  private resolveTotalRoundBudget(job: Job, agentCount: number, autoApply: boolean): number {
    const configuredLegacyDebate = job.runtimeConfig?.maxDebateRounds
    if (configuredLegacyDebate !== undefined) {
      const absoluteLegacyMax = Math.pow(2, agentCount + 1)
      const normalizedLegacyDebate = Math.max(1, configuredLegacyDebate)
      const effectiveLegacyDebate = Math.min(normalizedLegacyDebate, absoluteLegacyMax)
      return this.legacyDebateRoundsToTotalRounds(effectiveLegacyDebate, autoApply)
    }

    return job.maxRounds
  }

  private legacyDebateRoundsToTotalRounds(debateRounds: number, autoApply: boolean): number {
    const interactiveSteps = 2 + debateRounds + (debateRounds - 1) + (autoApply ? debateRounds : 0)
    const terminalSteps = 2
    return interactiveSteps + terminalSteps
  }

  /**
   * Dedicated inline apply step — renders patch prompt, invokes provider,
   * applies patch operations to the live files, then persists the round with
   * truthful applySummary. Does NOT reuse runStep() because apply must
   * persist AFTER writes, not before.
   */
  private async runApplyStep(params: {
    job: Job
    agent: AgentAssignment
    roundIndex: number
    deps: ProtocolExecutionDeps
    providerExecutor: ProviderExecutor | ProviderRouter
    roundStore: RoundStore
    eventBus: EventBus<DebateEventMap>
    findingsToApply: Finding[]
    architectResponseText: string
    failurePolicy: FailurePolicy
  }): Promise<ApplySummary> {
    const {
      job,
      agent,
      roundIndex,
      deps,
      providerExecutor,
      roundStore,
      eventBus,
      findingsToApply,
      architectResponseText,
      failurePolicy,
    } = params

    const { readFile, writeFile, rename } = await import('node:fs/promises')

    // Emit round:start
    eventBus.emit('round:start', {
      type: 'round:start',
      jobId: job.id,
      roundIndex,
      state: 'apply',
      timestamp: new Date().toISOString(),
    })

    const applySummary: ApplySummary = {
      attemptedFiles: [],
      writtenFiles: [],
      unchangedFiles: [],
      skippedFiles: [],
      errors: [],
    }

    let agentOutput: AgentOutput | undefined

    try {
      const currentSnapshot = await this.readCurrentScopeSnapshot(job)

      if (currentSnapshot.files.length === 0) {
        applySummary.errors.push('No readable target files found')
      } else {
        const findingsText = this.formatFindings(findingsToApply)

        // Render and invoke the provider
        const rendered = renderTemplate(architectApplyTemplate, {
          findings: findingsText,
          architect_response: architectResponseText,
          current_content: currentSnapshot.formatted,
        })

        const agentProvider =
          'forAgent' in providerExecutor
            ? (providerExecutor as ProviderRouter).forAgent(agent)
            : providerExecutor

        const providerOutput = await agentProvider.run({
          systemPrompt: rendered.system,
          userPrompt: rendered.user,
          model: agent.modelOrCommand,
          timeoutMs: failurePolicy.agentTimeoutMsDefault,
        })

        const normalized = deps.outputNormalizer.normalize(providerOutput, {
          agentId: agent.id,
          role: agent.role,
          templateVersion: job.templateVersions['apply'] ?? 1,
        })
        agentOutput = normalized.output

        const rawText = providerOutput.rawText
        const parsedApplyOutput = parseApplyOutput(
          rawText,
          currentSnapshot.files.map((file) => file.absolutePath),
          currentSnapshot.workspaceRoot,
        )

        applySummary.skippedFiles.push(...parsedApplyOutput.skippedFiles)
        applySummary.errors.push(...parsedApplyOutput.errors)

        for (const filePatch of parsedApplyOutput.filePatches) {
          applySummary.attemptedFiles.push(filePatch.absolutePath)

          try {
            const original = await readFile(filePatch.absolutePath, 'utf-8')
            const patchResult = this.applyPatchOperations({
              original,
              operations: filePatch.operations,
              relativePath: filePatch.relativePath,
            })

            if (!patchResult.ok) {
              applySummary.skippedFiles.push({
                path: filePatch.relativePath,
                reason: patchResult.reason,
              })
              continue
            }

            if (patchResult.content === original) {
              applySummary.unchangedFiles.push(filePatch.absolutePath)
              continue
            }

            const tmpPath = filePatch.absolutePath + '.ao-tmp-' + Date.now()
            await writeFile(tmpPath, patchResult.content, 'utf-8')
            await rename(tmpPath, filePatch.absolutePath)
            applySummary.writtenFiles.push(filePatch.absolutePath)
          } catch (err) {
            applySummary.errors.push(
              `Failed to patch ${filePatch.absolutePath}: ${err instanceof Error ? err.message : String(err)}`,
            )
          }
        }
      }
    } catch (err) {
      applySummary.errors.push(
        `Apply phase error: ${err instanceof Error ? err.message : String(err)}`,
      )
    }

    // Persist the apply round AFTER writes
    const round: Round = {
      id: randomUUID(),
      jobId: job.id,
      index: roundIndex,
      state: 'apply',
      reviewerOutputs: [],
      createdAt: new Date().toISOString(),
      architectOutput: agentOutput ?? {
        rawText: '',
        structuredSections: {},
        findings: [],
        warnings: [],
      },
      applySummary,
    }

    await roundStore.save(round)

    // Emit completion
    eventBus.emit('round:complete', {
      type: 'round:complete',
      jobId: job.id,
      roundIndex,
      state: 'apply',
      timestamp: new Date().toISOString(),
    })

    return applySummary
  }

  /**
   * Final check phase — compare the current artifact against the original
   * baseline snapshot and persist a reviewer-authored evaluation summary.
   */
  private async runFinalCheckStep(params: {
    job: Job
    agent: AgentAssignment
    roundIndex: number
    deps: ProtocolExecutionDeps
    providerExecutor: ProviderExecutor | ProviderRouter
    roundStore: RoundStore
    eventBus: EventBus<DebateEventMap>
    synthesisFindings: Finding[]
    applySummary?: ApplySummary
    failurePolicy: FailurePolicy
  }): Promise<void> {
    const {
      job,
      agent,
      roundIndex,
      deps,
      providerExecutor,
      roundStore,
      eventBus,
      synthesisFindings,
      applySummary,
      failurePolicy,
    } = params

    const { readFile } = await import('node:fs/promises')

    eventBus.emit('round:start', {
      type: 'round:start',
      jobId: job.id,
      roundIndex,
      state: 'final_check',
      timestamp: new Date().toISOString(),
    })

    const baselineFiles = job.baselineSnapshot?.files ?? []
    const changedFiles: string[] = []
    const unchangedFiles: string[] = []
    const finalFileBlocks: string[] = []

    for (const file of baselineFiles) {
      let currentContent = file.content
      try {
        currentContent = await readFile(file.path, 'utf-8')
      } catch {
        // Preserve baseline content in the rendered final block if file cannot be read.
      }

      if (currentContent === file.content) {
        unchangedFiles.push(file.path)
      } else {
        changedFiles.push(file.path)
      }

      finalFileBlocks.push(`--- ${file.relativePath} ---\n${currentContent}`)
    }

    const fallbackSummary = this.buildFallbackFinalCheckSummary({
      job,
      changedFiles,
      unchangedFiles,
      applySummary,
    })

    if (baselineFiles.length === 0) {
      const round: Round = {
        id: randomUUID(),
        jobId: job.id,
        index: roundIndex,
        state: 'final_check',
        reviewerOutputs: [],
        createdAt: new Date().toISOString(),
        finalCheckSummary: fallbackSummary,
      }
      await roundStore.save(round)
      eventBus.emit('round:complete', {
        type: 'round:complete',
        jobId: job.id,
        roundIndex,
        state: 'final_check',
        timestamp: new Date().toISOString(),
      })
      return
    }

    try {
      const rendered = renderTemplate(reviewerFinalCheckTemplate, {
        brief: job.brief,
        lens: agent.lens ?? 'general',
        findings: this.formatFindings(synthesisFindings),
        apply_summary: this.formatApplySummary(applySummary),
        original_content: baselineFiles
          .map((file) => `--- ${file.relativePath} ---\n${file.content}`)
          .join('\n\n'),
        final_content: finalFileBlocks.join('\n\n'),
      })

      const agentProvider =
        'forAgent' in providerExecutor
          ? (providerExecutor as ProviderRouter).forAgent(agent)
          : providerExecutor

      const providerOutput = await agentProvider.run({
        systemPrompt: rendered.system,
        userPrompt: rendered.user,
        model: agent.modelOrCommand,
        timeoutMs: failurePolicy.agentTimeoutMsDefault,
      })

      const normalized = deps.outputNormalizer.normalize(providerOutput, {
        agentId: agent.id,
        role: agent.role,
        templateVersion: job.templateVersions['final_check'] ?? 1,
      })
      const reviewerOutput = normalized.output
      const finalCheckSummary = this.parseFinalCheckSummary(providerOutput.rawText, fallbackSummary)

      const round: Round = {
        id: randomUUID(),
        jobId: job.id,
        index: roundIndex,
        state: 'final_check',
        reviewerOutputs: [{ agentId: agent.id, output: reviewerOutput }],
        createdAt: new Date().toISOString(),
        finalCheckSummary,
      }
      await roundStore.save(round)

      eventBus.emit('agent:output:end', {
        type: 'agent:output:end',
        jobId: job.id,
        agentId: agent.id,
        output: reviewerOutput,
        timestamp: new Date().toISOString(),
      })

      eventBus.emit('round:complete', {
        type: 'round:complete',
        jobId: job.id,
        roundIndex,
        state: 'final_check',
        timestamp: new Date().toISOString(),
      })
    } catch (err) {
      if (failurePolicy.reviewerFailure === 'continue_with_partial_results') {
        eventBus.emit('error', {
          type: 'error',
          jobId: job.id,
          error: `Reviewer ${agent.id} failed during final_check, continuing with baseline diff only: ${err instanceof Error ? err.message : String(err)}`,
          details: { agent: agent.id, state: 'final_check', partial: true },
          timestamp: new Date().toISOString(),
        })

        const round: Round = {
          id: randomUUID(),
          jobId: job.id,
          index: roundIndex,
          state: 'final_check',
          reviewerOutputs: [],
          createdAt: new Date().toISOString(),
          finalCheckSummary: fallbackSummary,
        }
        await roundStore.save(round)

        eventBus.emit('round:complete', {
          type: 'round:complete',
          jobId: job.id,
          roundIndex,
          state: 'final_check',
          timestamp: new Date().toISOString(),
        })
        return
      }

      throw err
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Execute a single protocol step: render prompt, call provider, normalize,
   * save round, and emit events.
   */
  private async runStep(params: {
    job: Job
    agent: AgentAssignment
    state: RoundState
    roundIndex: number
    deps: ProtocolExecutionDeps
    providerExecutor: ProviderExecutor | ProviderRouter
    roundStore: RoundStore
    eventBus: EventBus<DebateEventMap>
    renderPrompt: () => RenderedPrompt | Promise<RenderedPrompt>
    failurePolicy: FailurePolicy
    isCritical: boolean
  }): Promise<AgentOutput | undefined> {
    const {
      job,
      agent,
      state,
      roundIndex,
      deps,
      providerExecutor,
      roundStore,
      eventBus,
      renderPrompt,
      failurePolicy,
      isCritical,
    } = params

    // Emit round:start
    eventBus.emit('round:start', {
      type: 'round:start',
      jobId: job.id,
      roundIndex,
      state,
      timestamp: new Date().toISOString(),
    })

    try {
      // Render the prompt template
      const rendered = await renderPrompt()

      // Resolve the provider for this agent (supports per-agent routing)
      const agentProvider =
        'forAgent' in providerExecutor
          ? (providerExecutor as ProviderRouter).forAgent(agent)
          : providerExecutor

      // Call the provider
      const providerOutput = await agentProvider.run({
        systemPrompt: rendered.system,
        userPrompt: rendered.user,
        model: agent.modelOrCommand,
        timeoutMs: failurePolicy.agentTimeoutMsDefault,
      })

      // Normalize the output
      const normalized = deps.outputNormalizer.normalize(providerOutput, {
        agentId: agent.id,
        role: agent.role,
        templateVersion: job.templateVersions[state] ?? 1,
      })

      const agentOutput = normalized.output

      // Build and save the round
      const round: Round = {
        id: randomUUID(),
        jobId: job.id,
        index: roundIndex,
        state,
        reviewerOutputs: [],
        createdAt: new Date().toISOString(),
      }

      if (agent.role === 'architect') {
        round.architectOutput = agentOutput
      } else {
        round.reviewerOutputs = [{ agentId: agent.id, output: agentOutput }]
      }

      await roundStore.save(round)

      // Emit agent:output:end
      eventBus.emit('agent:output:end', {
        type: 'agent:output:end',
        jobId: job.id,
        agentId: agent.id,
        output: agentOutput,
        timestamp: new Date().toISOString(),
      })

      // Emit round:complete
      eventBus.emit('round:complete', {
        type: 'round:complete',
        jobId: job.id,
        roundIndex,
        state,
        timestamp: new Date().toISOString(),
      })

      return agentOutput
    } catch (err) {
      // Apply failure policy based on the step's criticality.
      // isCritical = true for architect steps (architectFailure always = 'fail_job')
      // isCritical = false for reviewer steps (reviewerFailure may allow partial results)
      if (isCritical) {
        eventBus.emit('error', {
          type: 'error',
          jobId: job.id,
          error: err instanceof Error ? err.message : String(err),
          details: { agent: agent.id, state },
          timestamp: new Date().toISOString(),
        })
        throw err
      }

      // Reviewer failure with continue_with_partial_results
      if (failurePolicy.reviewerFailure === 'continue_with_partial_results') {
        eventBus.emit('error', {
          type: 'error',
          jobId: job.id,
          error: `Reviewer ${agent.id} failed, continuing with partial results: ${err instanceof Error ? err.message : String(err)}`,
          details: { agent: agent.id, state, partial: true },
          timestamp: new Date().toISOString(),
        })

        // Emit round:complete even on partial failure
        eventBus.emit('round:complete', {
          type: 'round:complete',
          jobId: job.id,
          roundIndex,
          state,
          timestamp: new Date().toISOString(),
        })

        return undefined
      }

      throw err
    }
  }

  private async readCurrentScopeSnapshot(job: Job): Promise<{
    workspaceRoot: string
    files: Array<{ absolutePath: string; relativePath: string; content: string }>
    formatted: string
  }> {
    const { readFile } = await import('node:fs/promises')

    const scopeFiles =
      job.targetResolution?.resolvedFiles.length && job.targetResolution.resolvedFiles.length > 0
        ? job.targetResolution.resolvedFiles
        : job.scope.primaryTargets
    const workspaceRoot = this.resolveWorkspaceRoot(job, scopeFiles)
    const files: Array<{ absolutePath: string; relativePath: string; content: string }> = []

    for (const absolutePath of scopeFiles) {
      try {
        const content = await readFile(absolutePath, 'utf-8')
        files.push({
          absolutePath,
          relativePath: this.toRelativePath(workspaceRoot, absolutePath),
          content,
        })
      } catch {
        // Skip unreadable targets from the live snapshot.
      }
    }

    return {
      workspaceRoot,
      files,
      formatted:
        files.length > 0
          ? files.map((file) => `--- ${file.relativePath} ---\n${file.content}`).join('\n\n')
          : '(no readable target files found)',
    }
  }

  private resolveWorkspaceRoot(job: Job, scopeFiles: string[]): string {
    if (job.targetResolution?.workspaceRoot) {
      return job.targetResolution.workspaceRoot
    }

    if (scopeFiles.length === 0) {
      return ''
    }

    const directories = scopeFiles.map((file) => this.dirname(file).split('/').filter(Boolean))
    const commonParts: string[] = []

    for (let index = 0; index < directories[0].length; index++) {
      const segment = directories[0][index]
      if (directories.every((parts) => parts[index] === segment)) {
        commonParts.push(segment)
      } else {
        break
      }
    }

    if (commonParts.length === 0) {
      return scopeFiles[0].startsWith('/') ? '/' : ''
    }

    return `${scopeFiles[0].startsWith('/') ? '/' : ''}${commonParts.join('/')}`
  }

  private dirname(filePath: string): string {
    const normalized = filePath.replace(/\/+$/, '')
    const lastSlash = normalized.lastIndexOf('/')
    if (lastSlash <= 0) {
      return lastSlash === 0 ? '/' : '.'
    }
    return normalized.slice(0, lastSlash)
  }

  private toRelativePath(workspaceRoot: string, absolutePath: string): string {
    if (!workspaceRoot || workspaceRoot === '/' || !absolutePath.startsWith(workspaceRoot)) {
      return absolutePath
    }

    const trimmed = absolutePath.slice(workspaceRoot.length).replace(/^\/+/, '')
    return trimmed || absolutePath
  }

  private applyPatchOperations(params: {
    original: string
    operations: PatchOperation[]
    relativePath: string
  }): { ok: true; content: string } | { ok: false; reason: string } {
    const { original, operations, relativePath } = params
    let nextContent = original

    for (const operation of operations) {
      const match = this.findUniqueOccurrence(nextContent, operation.target)

      if (!match.ok) {
        return {
          ok: false,
          reason: `${operation.type} target in ${relativePath} ${match.reason}`,
        }
      }

      const before = nextContent.slice(0, match.start)
      const after = nextContent.slice(match.end)
      const replacement = operation.replacement ?? ''

      if (operation.type === 'replace') {
        nextContent = before + replacement + after
        continue
      }

      if (operation.type === 'delete') {
        nextContent = before + after
        continue
      }

      if (operation.type === 'insert_after') {
        nextContent = nextContent.slice(0, match.end) + replacement + nextContent.slice(match.end)
        continue
      }

      nextContent = nextContent.slice(0, match.start) + replacement + nextContent.slice(match.start)
    }

    if (original.trim().length > 0 && nextContent.trim().length === 0) {
      return {
        ok: false,
        reason: 'patch would blank the entire file',
      }
    }

    return { ok: true, content: nextContent }
  }

  private findUniqueOccurrence(
    content: string,
    target: string,
  ): { ok: true; start: number; end: number } | { ok: false; reason: string } {
    const firstIndex = content.indexOf(target)
    if (firstIndex === -1) {
      return { ok: false, reason: 'was not found' }
    }

    const secondIndex = content.indexOf(target, firstIndex + Math.max(target.length, 1))
    if (secondIndex !== -1) {
      return { ok: false, reason: 'is ambiguous' }
    }

    return {
      ok: true,
      start: firstIndex,
      end: firstIndex + target.length,
    }
  }

  private mergeApplySummaries(base: ApplySummary | undefined, next: ApplySummary): ApplySummary {
    if (!base) {
      return {
        attemptedFiles: [...next.attemptedFiles],
        writtenFiles: [...next.writtenFiles],
        unchangedFiles: [...next.unchangedFiles],
        skippedFiles: [...next.skippedFiles],
        errors: [...next.errors],
      }
    }

    return {
      attemptedFiles: this.mergeStringList(base.attemptedFiles, next.attemptedFiles),
      writtenFiles: this.mergeStringList(base.writtenFiles, next.writtenFiles),
      unchangedFiles: this.mergeStringList(base.unchangedFiles, next.unchangedFiles).filter(
        (file) => !next.writtenFiles.includes(file),
      ),
      skippedFiles: this.mergeSkippedFiles(base.skippedFiles, next.skippedFiles),
      errors: this.mergeStringList(base.errors, next.errors),
    }
  }

  private mergeStringList(existing: string[], next: string[]): string[] {
    return [...new Set([...existing, ...next])]
  }

  private mergeSkippedFiles(
    existing: Array<{ path: string; reason: string }>,
    next: Array<{ path: string; reason: string }>,
  ): Array<{ path: string; reason: string }> {
    const merged = new Map<string, { path: string; reason: string }>()
    for (const entry of [...existing, ...next]) {
      merged.set(`${entry.path}::${entry.reason}`, entry)
    }
    return [...merged.values()]
  }

  private selectAcknowledgedReviewerFindings(
    reviewerFindings: Finding[],
    architectResponseText: string,
  ): Finding[] {
    if (reviewerFindings.length === 0 || !architectResponseText.trim()) {
      return []
    }

    const acknowledgedTitles = new Set(
      [...architectResponseText.matchAll(/^\*{0,2}Acknowledged:\s*(.+?)\*{0,2}\s*$/gim)]
        .map((match) => match[1]?.trim().toLowerCase())
        .filter((value): value is string => Boolean(value)),
    )

    if (acknowledgedTitles.size === 0) {
      return []
    }

    return reviewerFindings.filter((finding) =>
      acknowledgedTitles.has(finding.title.trim().toLowerCase()),
    )
  }

  /** Convert an AgentOutput into an AgentMessage for the conversation log. */
  private toAgentMessage(
    output: AgentOutput,
    jobId: string,
    roundIndex: number,
    agent: AgentAssignment,
    state: RoundState,
  ): AgentMessage {
    const contentBlocks: ContentBlock[] = [
      { type: 'text', text: output.rawText },
      ...output.findings.map((f) => ({ type: 'finding' as const, finding: f })),
    ]
    return {
      id: randomUUID(),
      jobId,
      roundIndex,
      sender: agent.id,
      role: agent.role,
      state,
      timestamp: new Date().toISOString(),
      contentBlocks,
      findingCount: output.findings.length,
      warnings: output.warnings.length > 0 ? output.warnings : undefined,
      usage: output.usage
        ? {
            inputTokens: output.usage.inputTokens,
            outputTokens: output.usage.outputTokens,
            latencyMs: output.usage.latencyMs,
          }
        : undefined,
    }
  }

  /** Append an agent output to the conversation store, failing silently. */
  private async appendToConversation(
    store: ConversationStore | undefined,
    output: AgentOutput,
    jobId: string,
    roundIndex: number,
    agent: AgentAssignment,
    state: RoundState,
  ): Promise<void> {
    if (!store) return
    try {
      await store.append(this.toAgentMessage(output, jobId, roundIndex, agent, state))
    } catch (err) {
      // Conversation log is best-effort — protocol continues without it
      console.warn(
        `[SingleChallengerRunner] Failed to append to conversation log: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  /** Load conversation history from the store, format as markdown, and truncate. */
  private async loadFormattedHistory(
    store: ConversationStore | undefined,
    jobId: string,
    maxChars: number,
  ): Promise<string> {
    if (!store) return ''
    try {
      const messages = await store.loadByJob(jobId)
      const entries = messages.map((m) => {
        const text = m.contentBlocks
          .filter((b): b is TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('\n\n')
        return `## ${m.role} (${m.state}, round ${m.roundIndex})\n\n${text}`
      })
      return this.buildDebateHistoryText(entries, maxChars)
    } catch {
      return ''
    }
  }

  /**
   * Build debate history string, truncating older rounds if total exceeds maxChars.
   * Keeps the most recent rounds in full, summarizes older ones.
   */
  private buildDebateHistoryText(history: string[], maxChars: number): string {
    const joined = history.join('\n\n---\n\n')
    if (joined.length <= maxChars) {
      return joined
    }

    // Keep recent rounds, truncate older ones
    let totalChars = 0
    const kept: string[] = []

    // Walk backwards from most recent
    for (let i = history.length - 1; i >= 0; i--) {
      if (totalChars + history[i].length > maxChars && kept.length > 0) {
        // Summarize remaining older rounds
        const skippedCount = i + 1
        kept.unshift(
          `[${skippedCount} earlier debate round(s) truncated for context limits. Key findings are preserved in the accumulated findings list above.]`,
        )
        break
      }
      kept.unshift(history[i])
      totalChars += history[i].length
    }

    return kept.join('\n\n---\n\n')
  }

  /** Throw if the job has been cancelled. */
  private checkCancellation(jobId: string, deps: ProtocolExecutionDeps): void {
    if (deps.cancellationRegistry.isCancelled(jobId)) {
      throw new Error(`Job ${jobId} has been cancelled`)
    }
  }

  /** Format findings into a human-readable markdown string for template injection. */
  private formatFindings(findings: Finding[]): string {
    if (findings.length === 0) return '(no findings)'

    return findings
      .map((f, i) => {
        const parts = [
          `### Finding ${i + 1}: ${f.title}`,
          `- **Scope:** ${f.scopeType}`,
          `- **Actionability:** ${f.actionability}`,
          `- **Confidence:** ${f.confidence}`,
        ]
        if (f.evidence) {
          parts.push(`- **Evidence:** ${f.evidence.files.join(', ')}`)
        }
        parts.push('', f.description)
        return parts.join('\n')
      })
      .join('\n\n---\n\n')
  }

  private formatApplySummary(applySummary?: ApplySummary): string {
    if (!applySummary) return 'No apply round ran.'

    return [
      `Attempted: ${applySummary.attemptedFiles.length}`,
      `Written: ${applySummary.writtenFiles.length}`,
      `Unchanged: ${applySummary.unchangedFiles.length}`,
      `Skipped: ${applySummary.skippedFiles.length}`,
      `Errors: ${applySummary.errors.length}`,
    ].join('\n')
  }

  private buildFallbackFinalCheckSummary(params: {
    job: Job
    changedFiles: string[]
    unchangedFiles: string[]
    applySummary?: ApplySummary
  }): FinalCheckSummary {
    const { job, changedFiles, unchangedFiles, applySummary } = params
    const verdict: FinalCheckVerdict =
      changedFiles.length === 0 ? 'unchanged' : applySummary?.errors.length ? 'mixed' : 'improved'
    const summary =
      changedFiles.length === 0
        ? 'Final artifact matches the original baseline snapshot.'
        : `Detected ${changedFiles.length} changed file(s) relative to the original baseline.`

    return {
      verdict,
      score: verdict === 'unchanged' ? 50 : verdict === 'improved' ? 80 : 60,
      summary,
      changedFiles,
      unchangedFiles,
      baselineFingerprint: job.baselineSnapshot?.fingerprint,
    }
  }

  private parseFinalCheckSummary(rawText: string, fallback: FinalCheckSummary): FinalCheckSummary {
    const verdictMatch = rawText.match(/^## Verdict\s+([a-z_]+)$/im)
    const scoreMatch = rawText.match(/^## Score\s+(\d{1,3})$/im)
    const summary = this.extractMarkdownSection(rawText, 'Summary') ?? fallback.summary
    const verdict =
      this.normalizeVerdict(verdictMatch?.[1]) ??
      this.deriveVerdictFromScore(scoreMatch?.[1], fallback.verdict)
    const score = scoreMatch
      ? Math.max(0, Math.min(100, parseInt(scoreMatch[1], 10)))
      : fallback.score

    return {
      ...fallback,
      verdict,
      score,
      summary,
    }
  }

  private normalizeVerdict(value?: string): FinalCheckVerdict | undefined {
    if (!value) return undefined
    if (
      value === 'improved' ||
      value === 'mixed' ||
      value === 'unchanged' ||
      value === 'regressed'
    ) {
      return value
    }
    return undefined
  }

  private deriveVerdictFromScore(
    scoreText: string | undefined,
    fallback: FinalCheckVerdict,
  ): FinalCheckVerdict {
    if (!scoreText) return fallback
    const score = parseInt(scoreText, 10)
    if (Number.isNaN(score)) return fallback
    if (score >= 80) return 'improved'
    if (score <= 30) return 'regressed'
    if (score <= 55) return 'unchanged'
    return 'mixed'
  }

  private extractMarkdownSection(rawText: string, sectionName: string): string | undefined {
    const match = rawText.match(new RegExp(`^## ${sectionName}\\s+([\\s\\S]*?)(?=^##\\s|$)`, 'im'))
    return match?.[1]?.trim() || undefined
  }

  /**
   * Basic deduplication of findings by title normalization.
   * Full clustering engine (spec SS35.2) is deferred to Phase 2.
   */
  private deduplicateFindings(findings: Finding[]): Finding[] {
    const seen = new Map<string, Finding>()

    for (const finding of findings) {
      const normalizedTitle = finding.title.toLowerCase().trim()
      if (!seen.has(normalizedTitle)) {
        seen.set(normalizedTitle, finding)
      }
    }

    return [...seen.values()]
  }
}
