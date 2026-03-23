import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SingleChallengerRunner } from '../single-challenger.js'
import { DefaultCancellationRegistry } from '../../orchestrator/cancellation.js'
import { EventBus } from '../../events/event-bus.js'
import type { Job } from '../../types/job.js'
import type { ProtocolExecutionDeps } from '../../types/orchestrator.js'
import type { ProviderOutput, NormalizationResult, AgentOutput } from '../../types/output.js'
import type { Round } from '../../types/protocol.js'
import type { AgentContext } from '../../types/context.js'
import type { SkillDefinition } from '../../skills/types.js'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ---------------------------------------------------------------------------
// Mock provider that returns fixed findings
// ---------------------------------------------------------------------------

function makeMockProviderOutput(rawText: string): ProviderOutput {
  return {
    rawText,
    structuredSections: {},
    warnings: [],
    usage: { inputTokens: 100, outputTokens: 200 },
  }
}

function makeMockAgentOutput(rawText: string, findingTitles: string[]): AgentOutput {
  return {
    rawText,
    structuredSections: {},
    findings: findingTitles.map((title, i) => ({
      id: `finding-${i}`,
      title,
      description: `Description for ${title}`,
      scopeType: 'primary' as const,
      actionability: 'must_fix_now' as const,
      confidence: 'high' as const,
    })),
    warnings: [],
  }
}

function makeMockNormalizationResult(
  rawText: string,
  findingTitles: string[],
): NormalizationResult {
  return {
    output: makeMockAgentOutput(rawText, findingTitles),
    warnings: [],
    malformed: false,
  }
}

// ---------------------------------------------------------------------------
// Test job and deps factory
// ---------------------------------------------------------------------------

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-test-1',
    title: 'Test Job',
    mode: 'code_review',
    brief: 'Review the architecture.',
    status: 'running',
    protocol: 'single_challenger',
    scope: {
      primaryTargets: ['src/index.ts'],
      excludedTargets: [],
      referencePolicy: { enabled: false, depth: 'same_file' },
      outOfScopeHandling: 'ignore',
      allowDebateExpansion: false,
    },
    targetResolution: {
      entryTarget: '/tmp/workspace/src/index.ts',
      entryKind: 'file',
      workspaceRoot: '/tmp/workspace',
      resolvedFiles: ['/tmp/workspace/src/index.ts'],
      discovery: [
        {
          path: '/tmp/workspace/src/index.ts',
          reason: 'entry',
        },
      ],
    },
    baselineSnapshot: {
      fingerprint: 'fp-1',
      capturedAt: '2026-03-22T00:00:00Z',
      files: [
        {
          path: '/tmp/workspace/src/index.ts',
          relativePath: 'src/index.ts',
          content: 'export const value = 1\n',
          sha256: 'sha-1',
        },
      ],
    },
    decisionLog: {
      lockedConstraints: [],
      acceptedDecisions: [],
      rejectedOptions: [],
      unresolvedItems: [],
    },
    agents: [
      {
        id: 'architect-1',
        agentConfigId: 'cfg-1',
        role: 'architect',
        connectionType: 'api',
        providerKey: 'openai',
        modelOrCommand: 'gpt-4o',
        protocol: 'single_challenger',
        enabled: true,
        allowReferenceScan: false,
        canWriteCode: false,
      },
      {
        id: 'reviewer-1',
        agentConfigId: 'cfg-2',
        role: 'reviewer',
        lens: 'security',
        connectionType: 'api',
        providerKey: 'openai',
        modelOrCommand: 'gpt-4o',
        protocol: 'single_challenger',
        enabled: true,
        allowReferenceScan: false,
        canWriteCode: false,
      },
    ],
    currentRoundIndex: 0,
    maxRounds: 5,
    templateVersions: {},
    runtimeConfig: {
      maxConcurrentAgents: 2,
      pausePointsEnabled: false,
      synthesisConfig: { provider: 'architect_provider', rerunnable: false },
    },
    createdAt: '2026-03-21T00:00:00Z',
    updatedAt: '2026-03-21T00:00:00Z',
    ...overrides,
  }
}

/**
 * Build mock ProtocolExecutionDeps with a mock provider that returns
 * predictable findings for each call (analysis, review, rebuttal).
 */
function makeMockDeps(): {
  deps: ProtocolExecutionDeps
  savedRounds: Round[]
  eventBus: EventBus
  providerCallCount: { count: number }
} {
  const savedRounds: Round[] = []
  const eventBus = new EventBus()
  const cancellationRegistry = new DefaultCancellationRegistry()
  const providerCallCount = { count: 0 }

  // Mock provider: returns different findings for each step
  const mockProvider = {
    run: vi.fn().mockImplementation(() => {
      providerCallCount.count++
      const n = providerCallCount.count
      return Promise.resolve(makeMockProviderOutput(`Response ${n} from mock provider`))
    }),
  }

  // Mock normalizer: returns findings based on call count
  let normalizeCount = 0
  const mockNormalizer = {
    normalize: vi.fn().mockImplementation((output: ProviderOutput) => {
      normalizeCount++
      if (normalizeCount === 1) {
        return makeMockNormalizationResult(output.rawText, [
          'Missing error handling',
          'Inconsistent naming',
        ])
      }
      if (normalizeCount === 2) {
        return makeMockNormalizationResult(output.rawText, [
          'SQL injection vulnerability',
          'Missing input validation',
        ])
      }
      if (normalizeCount === 3) {
        return makeMockNormalizationResult(output.rawText, [
          'Confirmed: SQL injection vulnerability',
        ])
      }
      return makeMockNormalizationResult(output.rawText, [])
    }),
  }

  const mockContext: AgentContext = {
    role: 'architect',
    mode: 'code_review',
    pinned: {
      brief: 'Test brief',
      scope: {
        primaryTargets: ['src/'],
        excludedTargets: [],
        referencePolicy: { enabled: false, depth: 'same_file' },
        outOfScopeHandling: 'ignore',
        allowDebateExpansion: false,
      },
      decisionLog: {
        lockedConstraints: [],
        acceptedDecisions: [],
        rejectedOptions: [],
        unresolvedItems: [],
      },
      protocol: 'single_challenger',
    },
    dynamic: {},
    evidence: [],
    skillContext: '',
  }
  const mockResolvedSkills: SkillDefinition[] = [
    {
      id: 'risk-check',
      version: '1.0.0',
      name: 'Risk Check',
      description: 'Assess plan risk',
      skillType: 'prompt',
      source: { type: 'local', path: '/tmp/risk-check/SKILL.md' },
      promptContent: 'Assess risk.',
      promptSummary: 'Assess risk.',
    },
  ]

  const deps: ProtocolExecutionDeps = {
    providerExecutor: mockProvider,
    contextBuilder: {
      buildFor: vi.fn().mockReturnValue(mockContext),
    },
    outputNormalizer: mockNormalizer,
    scopeGuard: null,
    clusteringEngine: null,
    synthesisEngine: null,
    roundStore: {
      save: vi.fn().mockImplementation(async (round: Round) => {
        savedRounds.push(round)
      }),
      load: vi.fn(),
      listByJob: vi.fn().mockResolvedValue([]),
    },
    jobStore: {
      load: vi.fn(),
      create: vi.fn(),
      updateStatus: vi.fn(),
      list: vi.fn(),
      save: vi.fn(),
    },
    eventBus,
    cancellationRegistry,
    budgetManager: { fitToLimit: (ctx: unknown) => ctx },
    resolvedSkills: mockResolvedSkills,
  } as unknown as ProtocolExecutionDeps

  return { deps, savedRounds, eventBus, providerCallCount }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SingleChallengerRunner', () => {
  let runner: SingleChallengerRunner
  const tempDirs: string[] = []

  beforeEach(() => {
    runner = new SingleChallengerRunner()
  })

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('should execute all 4 steps: analysis, review, rebuttal, convergence', async () => {
    const { deps, savedRounds } = makeMockDeps()
    const job = makeJob()

    await runner.execute(job, deps)

    expect(savedRounds).toHaveLength(5)
    expect(savedRounds[0].state).toBe('analysis')
    expect(savedRounds[1].state).toBe('review')
    expect(savedRounds[2].state).toBe('rebuttal')
    expect(savedRounds[3].state).toBe('convergence')
    expect(savedRounds[4].state).toBe('final_check')
  })

  it('should call the provider 4 times (analysis, review, rebuttal, final_check)', async () => {
    const { deps, providerCallCount } = makeMockDeps()
    const job = makeJob()

    await runner.execute(job, deps)

    expect(providerCallCount.count).toBe(4)
  })

  it('uses job.maxRounds as the step budget for iterative review', async () => {
    const { deps, savedRounds, providerCallCount } = makeMockDeps()
    const job = makeJob({ maxRounds: 7 })

    await runner.execute(job, deps)

    expect(savedRounds.map((round) => round.state)).toEqual([
      'analysis',
      'review',
      'rebuttal',
      'review',
      'rebuttal',
      'convergence',
      'final_check',
    ])
    expect(providerCallCount.count).toBe(6)
  })

  it('preserves legacy maxDebateRounds behavior for existing jobs', async () => {
    const { deps, savedRounds } = makeMockDeps()
    const job = makeJob({
      maxRounds: 10,
      runtimeConfig: {
        maxConcurrentAgents: 2,
        pausePointsEnabled: false,
        synthesisConfig: { provider: 'architect_provider', rerunnable: false },
        maxDebateRounds: 1,
      },
    })

    await runner.execute(job, deps)

    expect(savedRounds.map((round) => round.state)).toEqual([
      'analysis',
      'review',
      'rebuttal',
      'convergence',
      'final_check',
    ])
  })

  it('passes resolved skills into every context-builder call', async () => {
    const { deps } = makeMockDeps()
    const job = makeJob()

    await runner.execute(job, deps)

    expect(deps.contextBuilder.buildFor).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'architect' }),
      job,
      expect.objectContaining({
        skills: deps.resolvedSkills,
      }),
    )
    expect(deps.contextBuilder.buildFor).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'reviewer' }),
      job,
      expect.objectContaining({
        skills: deps.resolvedSkills,
      }),
    )
  })

  it('should emit round:start and round:complete events for each step', async () => {
    const { deps, eventBus } = makeMockDeps()
    const job = makeJob()

    const roundStarts: string[] = []
    const roundCompletes: string[] = []

    eventBus.on('round:start', (evt) => roundStarts.push(evt.state))
    eventBus.on('round:complete', (evt) => roundCompletes.push(evt.state))

    await runner.execute(job, deps)

    expect(roundStarts).toEqual(['analysis', 'review', 'rebuttal', 'convergence', 'final_check'])
    expect(roundCompletes).toEqual(['analysis', 'review', 'rebuttal', 'convergence', 'final_check'])
  })

  it('should emit synthesis:ready event at the end', async () => {
    const { deps, eventBus } = makeMockDeps()
    const job = makeJob()

    let synthesisReady = false
    eventBus.on('synthesis:ready', () => {
      synthesisReady = true
    })

    await runner.execute(job, deps)

    expect(synthesisReady).toBe(true)
  })

  it('should emit agent:output:end events for each agent step', async () => {
    const { deps, eventBus } = makeMockDeps()
    const job = makeJob()

    const agentOutputs: string[] = []
    eventBus.on('agent:output:end', (evt) => agentOutputs.push(evt.agentId))

    await runner.execute(job, deps)

    expect(agentOutputs).toEqual(['architect-1', 'reviewer-1', 'architect-1', 'reviewer-1'])
  })

  it('should deduplicate findings in the convergence round', async () => {
    const { deps, savedRounds } = makeMockDeps()
    const job = makeJob()

    await runner.execute(job, deps)

    const convergence = savedRounds.find((r) => r.state === 'convergence')
    expect(convergence).toBeDefined()

    const findings = convergence!.architectOutput!.findings
    // All 5 findings have unique titles, so all should be present
    expect(findings.length).toBe(5)
  })

  it('should throw if no architect agent is assigned', async () => {
    const { deps } = makeMockDeps()
    const job = makeJob({ agents: [] })

    await expect(runner.execute(job, deps)).rejects.toThrow(
      'single_challenger protocol requires an architect agent',
    )
  })

  it('should throw if no reviewer agent is assigned', async () => {
    const { deps } = makeMockDeps()
    const job = makeJob({
      agents: [
        {
          id: 'architect-1',
          agentConfigId: 'cfg-1',
          role: 'architect',
          connectionType: 'api',
          providerKey: 'openai',
          modelOrCommand: 'gpt-4o',
          protocol: 'single_challenger',
          enabled: true,
          allowReferenceScan: false,
          canWriteCode: false,
        },
      ],
    })

    await expect(runner.execute(job, deps)).rejects.toThrow(
      'single_challenger protocol requires a reviewer agent',
    )
  })

  it('should persist apply round with state "apply" and applySummary when autoApply is true', async () => {
    const { deps, savedRounds } = makeMockDeps()
    const job = makeJob({
      maxRounds: 6,
      runtimeConfig: {
        maxConcurrentAgents: 2,
        pausePointsEnabled: false,
        synthesisConfig: { provider: 'architect_provider', rerunnable: false },
        autoApply: true,
      },
    })

    await runner.execute(job, deps)

    const applyRound = savedRounds.find((r) => r.state === 'apply')
    expect(applyRound).toBeDefined()
    expect(applyRound!.applySummary).toBeDefined()
    expect(Array.isArray(applyRound!.applySummary!.attemptedFiles)).toBe(true)
    expect(Array.isArray(applyRound!.applySummary!.writtenFiles)).toBe(true)
    expect(Array.isArray(applyRound!.applySummary!.unchangedFiles)).toBe(true)
    expect(Array.isArray(applyRound!.applySummary!.skippedFiles)).toBe(true)
    expect(Array.isArray(applyRound!.applySummary!.errors)).toBe(true)

    const finalCheckRound = savedRounds.find((r) => r.state === 'final_check')
    expect(finalCheckRound?.finalCheckSummary).toBeDefined()
  })

  it('uses workspace-relative file labels in the single-file apply prompt', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'ao-single-apply-'))
    tempDirs.push(workspaceRoot)

    const targetPath = join(workspaceRoot, 'src', 'index.ts')
    await mkdir(join(workspaceRoot, 'src'), { recursive: true })
    await writeFile(targetPath, 'export const value = 1\n', 'utf-8')

    const { deps, savedRounds } = makeMockDeps()
    const providerCalls: Array<{ userPrompt: string }> = []
    ;(deps as Record<string, unknown>).providerExecutor = {
      run: vi.fn().mockImplementation(async (input: { userPrompt: string }) => {
        providerCalls.push({ userPrompt: input.userPrompt })
        if (providerCalls.length === 4) {
          return makeMockProviderOutput(
            ['=== FILE: src/index.ts ===', 'export const value = 2', '=== END FILE ==='].join('\n'),
          )
        }
        if (providerCalls.length === 5) {
          return makeMockProviderOutput(
            [
              '## Verdict',
              'improved',
              '',
              '## Score',
              '88',
              '',
              '## Summary',
              'Final artifact resolves the confirmed issues and improves the file.',
            ].join('\n'),
          )
        }
        return makeMockProviderOutput(`Response ${providerCalls.length}`)
      }),
    }

    const job = makeJob({
      maxRounds: 6,
      scope: {
        primaryTargets: [targetPath],
        excludedTargets: [],
        referencePolicy: { enabled: false, depth: 'same_file' },
        outOfScopeHandling: 'ignore',
        allowDebateExpansion: false,
      },
      targetResolution: {
        entryTarget: targetPath,
        entryKind: 'file',
        resolvedFiles: [targetPath],
        discovery: [{ path: targetPath, reason: 'entry' }],
        workspaceRoot,
      } as Job['targetResolution'],
      runtimeConfig: {
        maxConcurrentAgents: 2,
        pausePointsEnabled: false,
        synthesisConfig: { provider: 'architect_provider', rerunnable: false },
        autoApply: true,
      },
    })

    await runner.execute(job, deps)

    expect(providerCalls).toHaveLength(5)
    expect(providerCalls[3].userPrompt).toContain('--- src/index.ts ---')

    const applyRound = savedRounds.find((round) => round.state === 'apply')
    expect(applyRound?.applySummary?.writtenFiles).toContain(targetPath)
    const finalCheckRound = savedRounds.find((round) => round.state === 'final_check')
    expect(finalCheckRound?.finalCheckSummary?.verdict).toBe('improved')
    expect(await readFile(targetPath, 'utf-8')).toBe('export const value = 2')
  })

  it('persists a final_check round with baseline-aware summary', async () => {
    const { deps, savedRounds } = makeMockDeps()
    const job = makeJob()

    await runner.execute(job, deps)

    const finalCheckRound = savedRounds.find((round) => round.state === 'final_check')
    expect(finalCheckRound).toBeDefined()
    expect(finalCheckRound!.finalCheckSummary).toBeDefined()
    expect(finalCheckRound!.finalCheckSummary!.baselineFingerprint).toBe('fp-1')
  })

  it('should NOT create an apply round when autoApply is false', async () => {
    const { deps, savedRounds } = makeMockDeps()
    const job = makeJob() // default: no autoApply

    await runner.execute(job, deps)

    const applyRound = savedRounds.find((r) => r.state === 'apply')
    expect(applyRound).toBeUndefined()
  })

  it('should abort early when cancelled before a step', async () => {
    const { deps } = makeMockDeps()
    const job = makeJob()

    // Pre-cancel the job
    await deps.cancellationRegistry.cancelJob(job.id)

    await expect(runner.execute(job, deps)).rejects.toThrow('has been cancelled')
  })

  it('should continue with partial results when reviewer fails (FailurePolicy)', async () => {
    const { deps, savedRounds, eventBus } = makeMockDeps()
    const job = makeJob()

    // Make the provider fail on the 2nd call (review step)
    let callCount = 0
    const failingProvider = {
      run: vi.fn().mockImplementation(() => {
        callCount++
        if (callCount === 2) {
          return Promise.reject(new Error('Reviewer provider failed'))
        }
        return Promise.resolve(makeMockProviderOutput(`Response ${callCount}`))
      }),
    }
    ;(deps as Record<string, unknown>).providerExecutor = failingProvider

    const errors: string[] = []
    eventBus.on('error', (evt) => errors.push(evt.error))

    await runner.execute(job, deps)

    expect(savedRounds.length).toBe(4) // analysis, rebuttal, convergence, final_check
    expect(savedRounds.some((round) => round.state === 'final_check')).toBe(true)

    // Should have emitted an error for the reviewer failure
    expect(errors.some((e) => e.includes('continuing with partial results'))).toBe(true)
  })

  it('should fail the job when architect fails (FailurePolicy)', async () => {
    const { deps, eventBus } = makeMockDeps()
    const job = makeJob()

    // Make the provider fail on the 1st call (analysis step)
    const failingProvider = {
      run: vi.fn().mockRejectedValue(new Error('Architect provider failed')),
    }
    ;(deps as Record<string, unknown>).providerExecutor = failingProvider

    const errors: string[] = []
    eventBus.on('error', (evt) => errors.push(evt.error))

    await expect(runner.execute(job, deps)).rejects.toThrow('Architect provider failed')
  })
})
