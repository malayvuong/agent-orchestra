/**
 * MCP tool handler implementations.
 *
 * Each handler maps an MCP tool call to existing Agent Orchestra core services.
 * No business logic is duplicated here — handlers are thin adapters.
 */

import { join, resolve } from 'node:path'
import {
  ContextBuilder,
  DefaultOutputNormalizer,
  EventBus,
  FileJobStore,
  FileRoundStore,
  FileConversationStore,
  Orchestrator,
  ProtocolRegistry,
  DefaultCancellationRegistry,
  SkillMatcher,
  SkillInjector,
  SkillParser,
  SkillLoader,
  loadSuperpowerCatalog,
  SuperpowerResolver,
  PolicyEngine,
  loadPolicyConfig,
} from '@malayvuong/agent-orchestra-core'
import type {
  AgentAssignment,
  AgentLens,
  JobRuntimeConfig,
  JobScope,
  Protocol,
  ProtocolExecutionDeps,
  Finding,
  ResolvedSuperpower,
  CapabilityScope,
  SkillDefinition,
  DebateEventMap,
} from '@malayvuong/agent-orchestra-core'
import { loadAgentsConfig } from '../init/agents-config.js'
import { buildRunComparison, selectComparableJobs } from '../jobs/compare-runs.js'
import { buildProviderExecutor } from '../providers/resolve-provider.js'
import {
  loadWorkspaceSkillCatalog,
  materializeRunSkills,
} from '../superpowers/resolve-run-skills.js'
import { simpleTokenEstimator } from '../utils/token-estimator.js'
import { buildBaselineSnapshot } from '../targeting/build-baseline-snapshot.js'
import { readScope } from '../targeting/read-scope.js'
import { resolveTarget } from '../targeting/resolve-target.js'

/** Logger for non-interactive MCP mode */
const mcpLogger = {
  warn: (msg: string) => process.stderr.write(`[WARN] ${msg}\n`),
  error: (msg: string) => process.stderr.write(`[ERROR] ${msg}\n`),
}

/** MCP tool result shape */
export type ToolResult = {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

function textResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }] }
}

function errorResult(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

// ---------------------------------------------------------------------------
// Findings formatting
// ---------------------------------------------------------------------------

function formatFindings(findings: Finding[]): string {
  if (findings.length === 0) {
    return 'No findings.'
  }

  const critical = findings.filter((f) => f.actionability === 'must_fix_now')
  const followUp = findings.filter((f) => f.actionability === 'follow_up_candidate')
  const notes = findings.filter((f) => f.actionability === 'note_only')

  const lines: string[] = [
    `Total: ${findings.length} findings`,
    `Critical: ${critical.length} | Recommendations: ${followUp.length} | Notes: ${notes.length}`,
    '',
  ]

  for (const finding of findings) {
    const icon =
      finding.actionability === 'must_fix_now'
        ? '[!]'
        : finding.actionability === 'follow_up_candidate'
          ? '[>]'
          : '[.]'

    lines.push(`${icon} ${finding.title} (${finding.confidence})`)
    if (finding.description) {
      const desc =
        finding.description.length > 200
          ? finding.description.slice(0, 200) + '...'
          : finding.description
      lines.push(`    ${desc}`)
    }
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Tool handler: list_superpowers
// ---------------------------------------------------------------------------

export function handleListSuperpowers(): ToolResult {
  const catalog = loadSuperpowerCatalog()
  const superpowers = catalog.list().map((sp) => ({
    id: sp.id,
    name: sp.name,
    category: sp.category,
    maturity: sp.maturity,
    description: sp.description,
    requiresApproval: sp.requiresApproval ?? false,
    reviewerLens: sp.agentPreset.reviewer.lens ?? null,
  }))

  return textResult(JSON.stringify({ superpowers }, null, 2))
}

// ---------------------------------------------------------------------------
// Tool handler: review_target
// ---------------------------------------------------------------------------

export async function handleReviewTarget(
  args: { target: string; superpower?: string; brief?: string; lens?: string },
  workspacePath: string,
): Promise<ToolResult> {
  const baseDir = join(workspacePath, '.agent-orchestra')

  // Superpower resolution
  let resolvedSp: ResolvedSuperpower | null = null
  let resolvedSkills: SkillDefinition[] = []
  let effectiveProvider = 'auto'
  let effectiveModel = ''
  let effectiveLens = args.lens ?? 'logic'
  let effectiveProtocol = 'single_challenger'

  if (args.superpower) {
    const { skills, skillSets } = await loadWorkspaceSkillCatalog(workspacePath)
    const catalog = loadSuperpowerCatalog()
    if (!catalog.has(args.superpower)) {
      const available = catalog
        .list()
        .map((s) => s.id)
        .join(', ')
      return errorResult(`Unknown superpower: "${args.superpower}". Available: ${available}`)
    }

    const resolver = new SuperpowerResolver(catalog, {
      loadedSkillIds: skills.map((skill) => skill.id),
      loadedSkillSetIds: skillSets.map((skillSet) => skillSet.id),
    })
    resolvedSp = resolver.resolve(args.superpower, {
      lens: args.lens ? (args.lens as AgentLens) : undefined,
    })
    resolvedSkills = materializeRunSkills({
      loadedSkills: skills,
      loadedSkillSets: skillSets,
      resolvedSkillIds: resolvedSp.resolvedSkillIds,
      resolvedSkillSetIds: resolvedSp.resolvedSkillSetIds,
    })

    effectiveProtocol = resolvedSp.protocol
    const sp = resolvedSp.superpower
    if (sp.agentPreset.reviewer.lens) effectiveLens = sp.agentPreset.reviewer.lens
    if (sp.agentPreset.reviewer.provider) effectiveProvider = sp.agentPreset.reviewer.provider
    if (sp.agentPreset.reviewer.model) effectiveModel = sp.agentPreset.reviewer.model

    // Check approval requirement
    if (sp.requiresApproval) {
      return textResult(
        JSON.stringify(
          {
            status: 'requires_approval',
            superpower: sp.id,
            message:
              `Superpower "${sp.id}" requires human approval before execution. ` +
              `It requests capabilities: ${(sp.capabilityExpectation ?? []).join(', ')}. ` +
              `Confirm with the user before proceeding.`,
          },
          null,
          2,
        ),
      )
    }
  }

  // Read target
  let targetContent: string
  let targetFiles: string[]
  let resolvedTarget
  try {
    resolvedTarget = await resolveTarget({
      workspacePath,
      targetPath: resolve(workspacePath, args.target),
    })
    const result = await readScope({
      workspacePath,
      resolvedTarget,
    })
    targetContent = result.content
    targetFiles = result.files
  } catch (err) {
    return errorResult(`Failed to read target: ${err instanceof Error ? err.message : String(err)}`)
  }
  const baselineSnapshot = await buildBaselineSnapshot(workspacePath, resolvedTarget)

  // Build scope
  const scope: JobScope = {
    primaryTargets: targetFiles,
    excludedTargets: [],
    referencePolicy: { enabled: false, depth: 'same_file' },
    outOfScopeHandling: 'note',
    allowDebateExpansion: false,
  }

  // Build agents
  let agents: AgentAssignment[]
  if (resolvedSp) {
    agents = resolvedSp.agentAssignments
  } else {
    agents = [
      {
        id: 'mcp-architect',
        agentConfigId: 'mcp-architect',
        role: 'architect',
        connectionType: 'api',
        providerKey: effectiveProvider,
        modelOrCommand: effectiveModel,
        protocol: effectiveProtocol,
        enabled: true,
        allowReferenceScan: false,
        canWriteCode: false,
      },
      {
        id: 'mcp-reviewer',
        agentConfigId: 'mcp-reviewer',
        role: 'reviewer',
        lens: effectiveLens as AgentLens,
        connectionType: 'api',
        providerKey: effectiveProvider,
        modelOrCommand: effectiveModel,
        protocol: effectiveProtocol,
        enabled: true,
        allowReferenceScan: false,
        canWriteCode: false,
      },
    ]
  }

  // Wire dependencies (same pattern as run.ts)
  const jobStore = new FileJobStore(baseDir)
  const roundStore = new FileRoundStore(baseDir)
  const eventBus = new EventBus<DebateEventMap>()
  const cancellationRegistry = new DefaultCancellationRegistry()
  const outputNormalizer = new DefaultOutputNormalizer()
  const protocolRegistry = new ProtocolRegistry()

  const budgetManager = { fitToLimit: (context: unknown) => context }
  const skillMatcher = new SkillMatcher()
  const skillInjector = new SkillInjector(simpleTokenEstimator)
  const contextBuilder = new ContextBuilder(
    budgetManager as ConstructorParameters<typeof ContextBuilder>[0],
    simpleTokenEstimator,
    skillMatcher,
    skillInjector,
  )

  const agentsConfig = await loadAgentsConfig(workspacePath)
  let providerResolution
  try {
    providerResolution = await buildProviderExecutor({
      agents,
      defaultProvider: effectiveProvider,
      defaultModel: effectiveModel,
      agentsConfig,
    })
  } catch (err) {
    return errorResult(`Provider error: ${err instanceof Error ? err.message : String(err)}`)
  }
  agents = providerResolution.agents

  // Build brief
  const isPlanReview = resolvedSp?.superpower.id === 'plan-review'
  const targetLabel = isPlanReview ? 'Target Plan' : 'Target Code'
  const defaultBrief = isPlanReview
    ? `Review the following implementation plan for sequencing issues, missing dependencies, scope problems, unclear assumptions, and implementation readiness:\n\n${targetContent}`
    : `Review the following code:\n\n${targetContent}`
  const fullBrief = args.brief
    ? `${args.brief}\n\n## ${targetLabel}\n\n${targetContent}`
    : defaultBrief

  const deps: ProtocolExecutionDeps = {
    providerExecutor: providerResolution.providerExecutor,
    contextBuilder,
    outputNormalizer,
    scopeGuard: null,
    clusteringEngine: null,
    synthesisEngine: null,
    roundStore,
    jobStore,
    eventBus,
    cancellationRegistry,
    budgetManager: budgetManager as ProtocolExecutionDeps['budgetManager'],
    resolvedSkills,
    conversationStore: new FileConversationStore(baseDir),
  }

  const orchestrator = new Orchestrator(protocolRegistry, deps)

  // Capture synthesis findings
  let synthesisFindings: Finding[] = []
  eventBus.on('synthesis:ready', async (evt) => {
    const rounds = await roundStore.listByJob(evt.jobId)
    const convergence = rounds.find((r) => r.state === 'convergence')
    if (convergence?.architectOutput) {
      synthesisFindings = convergence.architectOutput.findings
    }
  })

  // Create and run job
  try {
    const runtimeOverrides = {
      ...(resolvedSp?.runtimeConfigPatch ?? {}),
    }
    const runtimeConfig: JobRuntimeConfig | undefined =
      Object.keys(runtimeOverrides).length > 0
        ? {
            maxConcurrentAgents: 2,
            pausePointsEnabled: false,
            synthesisConfig: {
              provider: 'architect_provider',
              rerunnable: false,
            },
            ...runtimeOverrides,
          }
        : undefined

    const job = await orchestrator.createJob({
      title: isPlanReview ? `Plan Review: ${args.target}` : `MCP Review: ${args.target}`,
      brief: fullBrief,
      mode: isPlanReview ? 'plan' : 'code_review',
      protocol: effectiveProtocol as Protocol,
      scope,
      targetResolution: resolvedTarget,
      baselineSnapshot,
      agents,
      runtimeConfig,
    })

    await orchestrator.runJob(job.id)

    return textResult(
      JSON.stringify(
        {
          jobId: job.id,
          status: 'completed',
          superpower: args.superpower ?? null,
          target: args.target,
          findings: formatFindings(synthesisFindings),
          findingsCount: {
            total: synthesisFindings.length,
            critical: synthesisFindings.filter((f) => f.actionability === 'must_fix_now').length,
            recommendations: synthesisFindings.filter(
              (f) => f.actionability === 'follow_up_candidate',
            ).length,
            notes: synthesisFindings.filter((f) => f.actionability === 'note_only').length,
          },
        },
        null,
        2,
      ),
    )
  } catch (err) {
    return errorResult(`Review failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// ---------------------------------------------------------------------------
// Tool handler: review_plan (convenience wrapper)
// ---------------------------------------------------------------------------

export async function handleReviewPlan(
  args: { target: string; brief?: string },
  workspacePath: string,
): Promise<ToolResult> {
  return handleReviewTarget(
    { target: args.target, superpower: 'plan-review', brief: args.brief },
    workspacePath,
  )
}

// ---------------------------------------------------------------------------
// Tool handler: show_findings
// ---------------------------------------------------------------------------

export async function handleShowFindings(
  args: { jobId: string },
  workspacePath: string,
): Promise<ToolResult> {
  const baseDir = join(workspacePath, '.agent-orchestra')
  const jobStore = new FileJobStore(baseDir)
  const roundStore = new FileRoundStore(baseDir)

  // Load job
  let job
  try {
    job = await jobStore.load(args.jobId)
  } catch {
    return errorResult(`Job not found: ${args.jobId}`)
  }

  if (!job) {
    return errorResult(`Job not found: ${args.jobId}`)
  }

  // Load rounds and collect findings
  const rounds = await roundStore.listByJob(args.jobId)
  const allFindings: Finding[] = []

  for (const round of rounds) {
    if (round.architectOutput?.findings) {
      allFindings.push(...round.architectOutput.findings)
    }
    for (const reviewer of round.reviewerOutputs) {
      if (reviewer.output?.findings) {
        allFindings.push(...reviewer.output.findings)
      }
    }
  }

  // Get synthesis findings from convergence round
  const convergence = rounds.find((r) => r.state === 'convergence')
  const synthesisFindings = convergence?.architectOutput?.findings ?? []

  // Include apply summary if an apply round exists
  const applyRound = rounds.find((r) => r.state === 'apply' && r.applySummary)
  const applySummary = applyRound?.applySummary
    ? {
        attemptedFiles: applyRound.applySummary.attemptedFiles.length,
        writtenFiles: applyRound.applySummary.writtenFiles.length,
        unchangedFiles: applyRound.applySummary.unchangedFiles.length,
        skippedFiles: applyRound.applySummary.skippedFiles.length,
        errors: applyRound.applySummary.errors.length,
      }
    : undefined

  return textResult(
    JSON.stringify(
      {
        jobId: job.id,
        title: job.title,
        status: job.status,
        protocol: job.protocol,
        synthesis: formatFindings(synthesisFindings),
        findingsCount: {
          total: synthesisFindings.length,
          critical: synthesisFindings.filter((f) => f.actionability === 'must_fix_now').length,
          recommendations: synthesisFindings.filter(
            (f) => f.actionability === 'follow_up_candidate',
          ).length,
          notes: synthesisFindings.filter((f) => f.actionability === 'note_only').length,
        },
        roundCount: rounds.length,
        applySummary: applySummary ?? undefined,
      },
      null,
      2,
    ),
  )
}

// ---------------------------------------------------------------------------
// Tool handler: list_skills
// ---------------------------------------------------------------------------

export async function handleListSkills(workspacePath: string): Promise<ToolResult> {
  const parser = new SkillParser(simpleTokenEstimator)
  const loader = new SkillLoader(parser, mcpLogger)
  const result = await loader.loadFromWorkspace(workspacePath)

  const skills = result.skills.map((s) => ({
    id: s.id,
    name: s.name,
    version: s.version,
    description: s.description,
    triggers: s.triggers ?? null,
  }))

  return textResult(
    JSON.stringify(
      {
        skills,
        count: skills.length,
        errors: result.errors.length,
      },
      null,
      2,
    ),
  )
}

// ---------------------------------------------------------------------------
// Tool handler: evaluate_policy
// ---------------------------------------------------------------------------

export async function handleEvaluatePolicy(
  args: { capability: string; scope?: string | string[] },
  workspacePath: string,
): Promise<ToolResult> {
  const policy = await loadPolicyConfig(workspacePath)
  const engine = new PolicyEngine()

  const scopeArray = args.scope ? (Array.isArray(args.scope) ? args.scope : [args.scope]) : []

  const evaluation = engine.evaluate(
    args.capability as CapabilityScope['capability'],
    scopeArray,
    policy,
  )

  return textResult(
    JSON.stringify(
      {
        capability: args.capability,
        scope: scopeArray,
        action: evaluation.action,
        reason: evaluation.reason,
        matchedRule: evaluation.matchedRule ?? null,
      },
      null,
      2,
    ),
  )
}

// ---------------------------------------------------------------------------
// Tool handler: get_job
// ---------------------------------------------------------------------------

export async function handleGetJob(
  args: { jobId: string },
  workspacePath: string,
): Promise<ToolResult> {
  const baseDir = join(workspacePath, '.agent-orchestra')
  const jobStore = new FileJobStore(baseDir)

  let job
  try {
    job = await jobStore.load(args.jobId)
  } catch {
    return errorResult(`Job not found: ${args.jobId}`)
  }

  if (!job) {
    return errorResult(`Job not found: ${args.jobId}`)
  }

  // Compact target resolution summary — tolerates legacy jobs without it
  const rawTr = (job as Record<string, unknown>).targetResolution as
    | {
        entryTarget?: string
        entryKind?: string
        resolvedFiles?: string[]
        discovery?: Array<{ reason: string }>
      }
    | undefined

  const targetResolution = rawTr
    ? {
        entryTarget: rawTr.entryTarget,
        entryKind: rawTr.entryKind,
        resolvedFileCount: rawTr.resolvedFiles?.length ?? 0,
        discoveryReasons: rawTr.discovery
          ? Object.entries(
              rawTr.discovery.reduce((acc: Record<string, number>, d) => {
                acc[d.reason] = (acc[d.reason] ?? 0) + 1
                return acc
              }, {}),
            ).map(([reason, count]) => ({ reason, count }))
          : [],
      }
    : null

  const rawBaseline = (job as Record<string, unknown>).baselineSnapshot as
    | {
        fingerprint?: string
        files?: Array<unknown>
      }
    | undefined
  const baselineSnapshot = rawBaseline
    ? {
        fingerprint: rawBaseline.fingerprint,
        fileCount: rawBaseline.files?.length ?? 0,
      }
    : null

  // Load apply round summaries
  const roundStore = new FileRoundStore(baseDir)
  const rounds = await roundStore.listByJob(args.jobId)
  const applyRounds = rounds
    .filter((r) => r.state === 'apply' && r.applySummary)
    .map((r) => ({
      roundIndex: r.index,
      writtenFiles: r.applySummary!.writtenFiles.length,
      unchangedFiles: r.applySummary!.unchangedFiles.length,
      skippedFiles: r.applySummary!.skippedFiles.length,
      errors: r.applySummary!.errors.length,
    }))

  return textResult(
    JSON.stringify(
      {
        id: job.id,
        title: job.title,
        status: job.status,
        mode: job.mode,
        protocol: job.protocol,
        agents: job.agents.map((a) => ({
          id: a.id,
          role: a.role,
          lens: a.lens ?? null,
          provider: a.providerKey,
          model: a.modelOrCommand,
        })),
        scope: {
          primaryTargets: job.scope.primaryTargets,
          excludedTargets: job.scope.excludedTargets,
        },
        targetResolution,
        baselineSnapshot,
        applyRounds: applyRounds.length > 0 ? applyRounds : undefined,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      },
      null,
      2,
    ),
  )
}

export async function handleCompareRuns(
  args: { jobId: string },
  workspacePath: string,
): Promise<ToolResult> {
  const baseDir = join(workspacePath, '.agent-orchestra')
  const jobStore = new FileJobStore(baseDir)
  const roundStore = new FileRoundStore(baseDir)

  const anchorJob = await jobStore.load(args.jobId)
  if (!anchorJob) {
    return errorResult(`Job not found: ${args.jobId}`)
  }

  const allJobs = await jobStore.list()
  const relatedJobs = selectComparableJobs(anchorJob, allJobs)
  const roundsByJob = new Map<
    string,
    Array<Awaited<ReturnType<typeof roundStore.listByJob>>[number]>
  >()

  for (const job of relatedJobs) {
    roundsByJob.set(job.id, await roundStore.listByJob(job.id))
  }

  const comparison = buildRunComparison(anchorJob, relatedJobs, roundsByJob)
  return textResult(JSON.stringify(comparison, null, 2))
}
