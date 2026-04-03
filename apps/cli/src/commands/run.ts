import { Option, type Command } from 'commander'
import { join, resolve } from 'node:path'
import {
  ContextBuilder,
  DefaultOutputNormalizer,
  EventBus,
  FileJobStore,
  FileRoundStore,
  FileConversationStore,
  EventLogger,
  Orchestrator,
  ProtocolRegistry,
  DefaultCancellationRegistry,
  SkillMatcher,
  SkillInjector,
  loadSuperpowerCatalog,
  SuperpowerResolver,
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
  SkillDefinition,
  DebateEventMap,
} from '@malayvuong/agent-orchestra-core'
import { simpleTokenEstimator } from '../utils/token-estimator.js'
import { loadAgentsConfig } from '../init/agents-config.js'
import { buildProviderExecutor } from '../providers/resolve-provider.js'
import {
  loadWorkspaceSkillCatalog,
  materializeRunSkills,
} from '../superpowers/resolve-run-skills.js'
import { readScope } from '../targeting/read-scope.js'
import { buildBaselineSnapshot } from '../targeting/build-baseline-snapshot.js'
import { resolveTarget } from '../targeting/resolve-target.js'

/** Base directory for agent-orchestra storage */
const STORAGE_DIR_NAME = '.agent-orchestra'

/** Wraps an async command handler with user-friendly error handling */
function handleErrors<T extends unknown[]>(fn: (...args: T) => Promise<void>) {
  return async (...args: T): Promise<void> => {
    try {
      await fn(...args)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`Error: ${message}`)
      process.exit(1)
    }
  }
}

// ---------------------------------------------------------------------------
// Findings display
// ---------------------------------------------------------------------------

function displayFindings(findings: Finding[]): void {
  if (findings.length === 0) {
    console.log('\n  No findings.')
    return
  }

  const critical = findings.filter((f) => f.actionability === 'must_fix_now')
  const followUp = findings.filter((f) => f.actionability === 'follow_up_candidate')
  const notes = findings.filter((f) => f.actionability === 'note_only')

  console.log(`\n  Total: ${findings.length} findings`)
  console.log(
    `  Critical: ${critical.length} | Recommendations: ${followUp.length} | Notes: ${notes.length}`,
  )
  console.log('')

  for (const finding of findings) {
    const icon =
      finding.actionability === 'must_fix_now'
        ? '[!]'
        : finding.actionability === 'follow_up_candidate'
          ? '[>]'
          : '[.]'

    const confidence = `(${finding.confidence})`
    console.log(`  ${icon} ${finding.title} ${confidence}`)
    if (finding.description) {
      // Show first 120 chars of description
      const desc =
        finding.description.length > 120
          ? finding.description.slice(0, 120) + '...'
          : finding.description
      console.log(`      ${desc}`)
    }
  }
}

// ---------------------------------------------------------------------------
// Run command implementation
// ---------------------------------------------------------------------------

async function runCommand(opts: {
  target: string
  provider: string
  model?: string
  lens: string
  brief: string
  protocol: string
  path: string
  superpower?: string
  architectProvider?: string
  architectModel?: string
  reviewerProvider?: string
  reviewerModel?: string
  maxRounds?: string
  debateRounds?: string
  autoApply: boolean
}): Promise<void> {
  const workspacePath = resolve(opts.path)
  const baseDir = join(workspacePath, STORAGE_DIR_NAME)

  // ---------------------------------------------------------------------------
  // Superpower resolution (when --superpower is provided)
  // ---------------------------------------------------------------------------
  let resolved: ResolvedSuperpower | null = null
  let resolvedSkills: SkillDefinition[] = []
  let effectiveProvider = opts.provider
  let effectiveModel = opts.model ?? ''
  let effectiveLens = opts.lens
  let effectiveProtocol = opts.protocol

  if (opts.superpower) {
    const { skills, skillSets } = await loadWorkspaceSkillCatalog(workspacePath)
    const catalog = loadSuperpowerCatalog()
    const resolver = new SuperpowerResolver(catalog, {
      loadedSkillIds: skills.map((skill) => skill.id),
      loadedSkillSetIds: skillSets.map((skillSet) => skillSet.id),
    })

    // Only pass overrides when user explicitly set values (not defaults)
    const isExplicitProvider = opts.provider !== 'auto'
    const isExplicitModel = opts.model !== undefined
    const isExplicitLens = opts.lens !== 'logic'

    resolved = resolver.resolve(opts.superpower, {
      provider: isExplicitProvider ? opts.provider : undefined,
      model: isExplicitModel ? opts.model : undefined,
      lens: isExplicitLens ? (opts.lens as AgentLens) : undefined,
    })
    resolvedSkills = materializeRunSkills({
      loadedSkills: skills,
      loadedSkillSets: skillSets,
      resolvedSkillIds: resolved.resolvedSkillIds,
      resolvedSkillSetIds: resolved.resolvedSkillSetIds,
    })

    // Print superpower banner
    const sp = resolved.superpower
    const skillList = [...resolved.resolvedSkillIds, ...resolved.resolvedSkillSetIds]
    console.log(`Using superpower: ${sp.id}`)

    if (sp.id === 'plan-review') {
      console.log(`Review mode: planning / execution-readiness`)
      console.log(`Protocol: ${resolved.protocol}`)
      console.log(`Focus: sequencing, scope, dependencies, implementation readiness`)
    } else {
      console.log(`Resolved skills: ${skillList.length > 0 ? skillList.join(', ') : '(none)'}`)
      console.log(`Reviewer lens: ${sp.agentPreset.reviewer.lens ?? effectiveLens}`)
      console.log(`Protocol: ${resolved.protocol}`)
    }

    // Print warnings
    for (const warning of resolved.warnings) {
      console.log(`[WARN] ${warning}`)
    }
    console.log('')

    // Apply resolved values — CLI explicit args take precedence
    effectiveProtocol = resolved.protocol
    if (opts.lens === 'logic' && sp.agentPreset.reviewer.lens) {
      effectiveLens = sp.agentPreset.reviewer.lens
    }
    if (!isExplicitProvider) {
      // No explicit provider — keep 'auto' so provider resolution auto-detects
      effectiveProvider = opts.provider
    }
    if (!isExplicitModel && !isExplicitProvider) {
      // No explicit model or provider — let provider resolution pick the default model
      effectiveModel = ''
    } else if (!isExplicitModel && sp.agentPreset.reviewer.model) {
      effectiveModel = sp.agentPreset.reviewer.model
    }
  }

  console.log(`Agent Orchestra — ${effectiveProtocol} protocol`)
  console.log(`Provider: ${effectiveProvider}${effectiveModel ? ` (${effectiveModel})` : ''}`)
  console.log(`Target: ${opts.target}`)
  console.log(`Lens: ${effectiveLens}`)
  console.log('')

  // 1. Read target files
  console.log('Reading target files...')
  const resolvedTarget = await resolveTarget({
    workspacePath,
    targetPath: resolve(workspacePath, opts.target),
  })
  const { content: targetContent, files: targetFiles } = await readScope({
    workspacePath,
    resolvedTarget,
  })
  const baselineSnapshot = await buildBaselineSnapshot(workspacePath, resolvedTarget)
  console.log(`  ${targetFiles.length} file(s) loaded.`)

  // 2. Build job scope
  const scope: JobScope = {
    primaryTargets: targetFiles,
    excludedTargets: [],
    referencePolicy: { enabled: false, depth: 'same_file' },
    outOfScopeHandling: 'note',
    allowDebateExpansion: false,
  }

  // 3. Build agent assignments — use superpower assignments when available
  let agents: AgentAssignment[]

  if (resolved) {
    agents = resolved.agentAssignments
  } else {
    const architectAgent: AgentAssignment = {
      id: 'architect-1',
      agentConfigId: 'cli-architect',
      role: 'architect',
      connectionType: 'api',
      providerKey: effectiveProvider,
      modelOrCommand: effectiveModel,
      protocol: effectiveProtocol,
      enabled: true,
      allowReferenceScan: false,
      canWriteCode: false,
    }

    const reviewerAgent: AgentAssignment = {
      id: 'reviewer-1',
      agentConfigId: 'cli-reviewer',
      role: 'reviewer',
      lens: effectiveLens as AgentLens,
      connectionType: 'api',
      providerKey: effectiveProvider,
      modelOrCommand: effectiveModel,
      protocol: effectiveProtocol,
      enabled: true,
      allowReferenceScan: false,
      canWriteCode: false,
    }

    agents = [architectAgent, reviewerAgent]
  }

  // 4. Wire up dependencies
  console.log('Initializing engine...')

  const jobStore = new FileJobStore(baseDir)
  const roundStore = new FileRoundStore(baseDir)
  const conversationStore = new FileConversationStore(baseDir)
  const eventLogger = new EventLogger(baseDir)
  const eventBus = new EventBus<DebateEventMap>()
  const cancellationRegistry = new DefaultCancellationRegistry()
  const outputNormalizer = new DefaultOutputNormalizer()
  // TemplateLoader is used internally by protocol runners via default imports
  const protocolRegistry = new ProtocolRegistry()

  // Build ContextBuilder with skill support
  const budgetManager = {
    fitToLimit: (context: unknown) => context,
  }
  const skillMatcher = new SkillMatcher()
  const skillInjector = new SkillInjector(simpleTokenEstimator)
  const contextBuilder = new ContextBuilder(
    budgetManager as Parameters<(typeof ContextBuilder)['prototype']['buildFor']> extends never
      ? never
      : ConstructorParameters<typeof ContextBuilder>[0],
    simpleTokenEstimator,
    skillMatcher,
    skillInjector,
  )

  // Create provider router — supports per-agent providers
  const agentsConfig = await loadAgentsConfig(workspacePath)

  const providerResolution = await buildProviderExecutor({
    agents,
    defaultProvider: effectiveProvider,
    defaultModel: effectiveModel,
    agentsConfig,
    architectOverride:
      opts.architectProvider || opts.architectModel
        ? { provider: opts.architectProvider, model: opts.architectModel }
        : undefined,
    reviewerOverride:
      opts.reviewerProvider || opts.reviewerModel
        ? { provider: opts.reviewerProvider, model: opts.reviewerModel }
        : undefined,
  })
  agents = providerResolution.agents

  const architectPlan = agents.find((agent) => agent.role === 'architect')
  const reviewerPlan = agents.find((agent) => agent.role === 'reviewer')

  // Print provider info if mixed mode
  if (
    architectPlan &&
    reviewerPlan &&
    (architectPlan.providerKey !== reviewerPlan.providerKey ||
      architectPlan.modelOrCommand !== reviewerPlan.modelOrCommand)
  ) {
    console.log(
      `  Architect provider: ${architectPlan.providerKey}${architectPlan.modelOrCommand ? ` (${architectPlan.modelOrCommand})` : ''}`,
    )
    console.log(
      `  Reviewer provider: ${reviewerPlan.providerKey}${reviewerPlan.modelOrCommand ? ` (${reviewerPlan.modelOrCommand})` : ''}`,
    )
    console.log('')
  }

  // Compose the brief with target content
  const isPlanReview = resolved?.superpower.id === 'plan-review'
  const targetLabel = isPlanReview ? 'Target Plan' : 'Target Code'
  const defaultBrief = isPlanReview
    ? `Review the following implementation plan for sequencing issues, missing dependencies, scope problems, unclear assumptions, and implementation readiness:\n\n${targetContent}`
    : `Review the following code:\n\n${targetContent}`
  const fullBrief = opts.brief
    ? `${opts.brief}\n\n## ${targetLabel}\n\n${targetContent}`
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
    conversationStore,
  }

  const orchestrator = new Orchestrator(protocolRegistry, deps)

  // 5. Subscribe to events for terminal output
  eventBus.on('round:start', (evt) => {
    console.log(`\n[Round ${evt.roundIndex}] Starting ${evt.state}...`)
  })

  eventBus.on('agent:output:end', (evt) => {
    const findingCount = evt.output.findings.length
    console.log(`  Agent ${evt.agentId}: ${findingCount} finding(s)`)
    if (evt.output.warnings.length > 0) {
      for (const w of evt.output.warnings) {
        console.log(`  [WARN] ${w}`)
      }
    }
  })

  eventBus.on('round:complete', (evt) => {
    console.log(`  Round ${evt.roundIndex} (${evt.state}) complete.`)
  })

  eventBus.on('error', (evt) => {
    console.error(`  [ERROR] ${evt.error}`)
  })

  let synthesisFindings: Finding[] = []

  eventBus.on('synthesis:ready', async (evt) => {
    // Load the convergence round to get final findings
    const rounds = await roundStore.listByJob(evt.jobId)
    const convergence = rounds.find((r) => r.state === 'convergence')
    if (convergence?.architectOutput) {
      synthesisFindings = convergence.architectOutput.findings
    }
  })

  // Log all events to the NDJSON event log
  const eventTypes = [
    'job:update',
    'round:start',
    'round:complete',
    'agent:output:end',
    'synthesis:ready',
    'error',
  ] as const

  // 6. Create and run job
  console.log('Creating job...')

  const explicitMaxRounds = parsePositiveInteger(opts.maxRounds)
  const legacyDebateRounds = parsePositiveInteger(opts.debateRounds)
  const maxRounds =
    explicitMaxRounds ??
    (legacyDebateRounds !== undefined
      ? legacyDebateRoundsToMaxRounds(legacyDebateRounds, opts.autoApply)
      : 10)

  if (legacyDebateRounds !== undefined && explicitMaxRounds === undefined) {
    console.log('[WARN] --debate-rounds is deprecated. Use --max-rounds instead.')
  }

  const runtimeOverrides = {
    ...(resolved?.runtimeConfigPatch ?? {}),
    ...(opts.autoApply ? { autoApply: true } : {}),
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
    title: isPlanReview ? `Plan Review: ${opts.target}` : `CLI Review: ${opts.target}`,
    brief: fullBrief,
    mode: isPlanReview ? 'plan' : 'code_review',
    protocol: effectiveProtocol as Protocol,
    scope,
    targetResolution: resolvedTarget,
    baselineSnapshot,
    agents,
    maxRounds,
    runtimeConfig,
  })

  console.log(`Job created: ${job.id}`)

  // Register event logging after we have the job ID
  for (const eventType of eventTypes) {
    eventBus.on(eventType, (evt) => {
      eventLogger.log(job.id, evt as Record<string, unknown>).catch(() => {
        // Silently ignore logging errors
      })
    })
  }

  // Handle process signals for graceful cancellation
  const handleSignal = () => {
    console.log('\nCancelling job...')
    cancellationRegistry.cancelJob(job.id).catch(() => {
      process.exit(1)
    })
  }
  process.on('SIGINT', handleSignal)
  process.on('SIGTERM', handleSignal)

  try {
    console.log('Running protocol...\n')
    await orchestrator.runJob(job.id)

    // Load synthesis findings from the convergence round
    const rounds = await roundStore.listByJob(job.id)
    const convergence = rounds.find((r) => r.state === 'convergence')
    if (convergence?.architectOutput) {
      synthesisFindings = convergence.architectOutput.findings
    }

    console.log('\n========================================')
    console.log('  Review Complete')
    console.log('========================================')

    displayFindings(synthesisFindings)

    // Truthful apply reporting — read the persisted apply round
    if (opts.autoApply) {
      const applyRound = rounds.find((r) => r.state === 'apply')
      if (applyRound?.applySummary) {
        const as = applyRound.applySummary
        const wrote = as.writtenFiles.length
        const unchanged = as.unchangedFiles.length
        const skipped = as.skippedFiles.length
        const errs = as.errors.length
        if (wrote > 0 || unchanged > 0 || skipped > 0) {
          console.log(
            `\n  Apply summary: wrote ${wrote} file(s), unchanged ${unchanged}, skipped ${skipped}`,
          )
        }
        if (errs > 0) {
          console.log(`  Apply errors: ${errs}`)
          for (const e of as.errors.slice(0, 3)) {
            console.log(`    ${e}`)
          }
        }
        if (wrote === 0 && errs === 0) {
          console.log(`\n  Auto-apply: no files were changed`)
        }
      }
    }

    const finalCheckRound = rounds.find((r) => r.state === 'final_check')
    if (finalCheckRound?.finalCheckSummary) {
      const finalCheck = finalCheckRound.finalCheckSummary
      const scoreText = finalCheck.score !== undefined ? `, score ${finalCheck.score}` : ''
      console.log(`\n  Final check: ${finalCheck.verdict}${scoreText}`)
      console.log(`  ${finalCheck.summary}`)
    }

    console.log(`\nJob ID: ${job.id}`)
    console.log(`Status: awaiting_decision`)
    console.log(`Storage: ${baseDir}/jobs/${job.id}/`)
    console.log(`Conversation log: ${baseDir}/jobs/${job.id}/conversation.jsonl`)
  } catch (err) {
    const isCancelled = cancellationRegistry.isCancelled(job.id)
    if (isCancelled) {
      console.log('\nJob cancelled.')
    } else {
      console.error(`\nJob failed: ${err instanceof Error ? err.message : String(err)}`)
    }
    process.exit(isCancelled ? 0 : 1)
  } finally {
    process.off('SIGINT', handleSignal)
    process.off('SIGTERM', handleSignal)
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerRunCommand(program: Command): void {
  const runCommandDefinition = program
    .command('run')
    .description('Run a multi-agent code review')
    .requiredOption('--target <path>', 'File or directory to review')
    .option('--provider <name>', 'Provider: auto, claude-cli, codex-cli, openai, anthropic', 'auto')
    .option('--model <model>', 'Model name (default depends on provider)')
    .option('--lens <lens>', 'Review lens: security, testing, performance, etc.', 'logic')
    .option('--brief <text>', 'Job description', '')
    .option('--protocol <name>', 'Protocol to use', 'single_challenger')
    .option('--superpower <id>', 'Use a superpower preset (overrides defaults)')
    .option('--architect-provider <name>', 'Provider for architect agent')
    .option('--architect-model <model>', 'Model for architect agent')
    .option('--reviewer-provider <name>', 'Provider for reviewer agent')
    .option('--reviewer-model <model>', 'Model for reviewer agent')
    .option(
      '--max-rounds <n>',
      'Max protocol steps to persist before convergence/apply/final_check (default: 10)',
      '10',
    )
    .option('--auto-apply', 'Auto-apply confirmed findings to the original file', false)
    .option('--path <path>', 'Workspace path', process.cwd())
    .action(
      handleErrors(
        async (opts: {
          target: string
          provider: string
          model?: string
          lens: string
          brief: string
          protocol: string
          path: string
          superpower?: string
          architectProvider?: string
          architectModel?: string
          reviewerProvider?: string
          reviewerModel?: string
          maxRounds?: string
          debateRounds?: string
          autoApply: boolean
        }) => {
          await runCommand(opts)
        },
      ),
    )

  runCommandDefinition.addOption(
    new Option('--debate-rounds <n>', 'Deprecated alias for --max-rounds').hideHelp(),
  )
}

function parsePositiveInteger(raw: string | undefined): number | undefined {
  if (raw === undefined) {
    return undefined
  }

  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function legacyDebateRoundsToMaxRounds(debateRounds: number, autoApply: boolean): number {
  const normalizedDebateRounds = Math.max(1, debateRounds)
  const interactiveSteps = 2 + normalizedDebateRounds + (normalizedDebateRounds - 1)
  const terminalSteps = 2 + (autoApply ? 1 : 0)
  return interactiveSteps + terminalSteps
}
