import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createProgram } from '../program.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'ao-job-'))
  vi.restoreAllMocks()
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

function captureConsole(): { output: string[]; restore: () => void } {
  const output: string[] = []
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    output.push(args.map(String).join(' '))
  })
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    output.push(args.map(String).join(' '))
  })
  return {
    output,
    restore: () => {
      vi.restoreAllMocks()
    },
  }
}

async function seedJob(jobId: string, overrides: Record<string, unknown> = {}): Promise<void> {
  const jobDir = join(tempDir, '.agent-orchestra', 'jobs', jobId)
  await mkdir(jobDir, { recursive: true })
  await mkdir(join(jobDir, 'rounds'), { recursive: true })

  const baseJob = {
    id: jobId,
    title: 'Test Job',
    mode: 'code_review',
    brief: 'Test brief',
    status: 'awaiting_decision',
    protocol: 'single_challenger',
    scope: {
      primaryTargets: ['/ws/src/index.ts'],
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
    agents: [],
    currentRoundIndex: 0,
    maxRounds: 10,
    templateVersions: {},
    runtimeConfig: {
      maxConcurrentAgents: 2,
      pausePointsEnabled: false,
      synthesisConfig: { provider: 'architect_provider', rerunnable: false },
    },
    createdAt: '2026-03-22T00:00:00Z',
    updatedAt: '2026-03-22T00:00:00Z',
    ...overrides,
  }

  await writeFile(join(jobDir, 'job.json'), JSON.stringify(baseJob, null, 2))
}

async function seedRound(jobId: string, round: Record<string, unknown>): Promise<void> {
  const roundPath = join(
    tempDir,
    '.agent-orchestra',
    'jobs',
    jobId,
    'rounds',
    `round-${round.index}.json`,
  )
  await writeFile(roundPath, JSON.stringify(round, null, 2))
}

// ---------------------------------------------------------------------------
// job show — legacy compatibility
// ---------------------------------------------------------------------------

describe('job show — legacy job without targetResolution', () => {
  it('renders without crashing when targetResolution is absent', async () => {
    await seedJob('legacy-job-id-0000-0000-000000000001')

    const { output, restore } = captureConsole()
    const program = createProgram()
    program.exitOverride()

    await program.parseAsync([
      'node',
      'ao',
      'job',
      'show',
      'legacy-job-id-0000-0000-000000000001',
      '--path',
      tempDir,
    ])
    restore()

    const combined = output.join('\n')
    expect(combined).toContain('legacy-job-id-0000-0000-000000000001')
    expect(combined).toContain('Test Job')
  })
})

describe('job show — with targetResolution', () => {
  it('renders target resolution summary when present', async () => {
    await seedJob('target-job-id-0000-0000-000000000002', {
      targetResolution: {
        entryTarget: '/ws/docs/plan.md',
        entryKind: 'file',
        workspaceRoot: '/ws',
        resolvedFiles: ['/ws/docs/plan.md', '/ws/docs/spec.md'],
        discovery: [
          { path: '/ws/docs/plan.md', reason: 'entry' },
          { path: '/ws/docs/spec.md', reason: 'markdown_link', discoveredFrom: '/ws/docs/plan.md' },
        ],
      },
      baselineSnapshot: {
        fingerprint: 'fp-target-1',
        capturedAt: '2026-03-22T00:00:00Z',
        files: [
          {
            path: '/ws/docs/plan.md',
            relativePath: 'docs/plan.md',
            content: '# Plan\n',
            sha256: 'sha-plan',
          },
        ],
      },
    })

    const { output, restore } = captureConsole()
    const program = createProgram()
    program.exitOverride()

    await program.parseAsync([
      'node',
      'ao',
      'job',
      'show',
      'target-job-id-0000-0000-000000000002',
      '--path',
      tempDir,
    ])
    restore()

    const combined = output.join('\n')
    expect(combined).toContain('Target resolution')
    expect(combined).toContain('plan.md')
    expect(combined).toContain('2 file')
    expect(combined).toContain('Baseline')
    expect(combined).toContain('fp-target-1')
  })
})

describe('job show — with apply round', () => {
  it('renders apply rounds distinctly with summary', async () => {
    const jobId = 'apply-job-id-0000-0000-000000000003'
    await seedJob(jobId)
    await seedRound(jobId, {
      id: 'round-apply-1',
      jobId,
      index: 4,
      state: 'apply',
      reviewerOutputs: [],
      createdAt: '2026-03-22T00:00:00Z',
      architectOutput: {
        rawText: 'applied',
        structuredSections: {},
        findings: [],
        warnings: [],
      },
      applySummary: {
        attemptedFiles: ['/ws/docs/plan.md'],
        writtenFiles: ['/ws/docs/plan.md'],
        unchangedFiles: [],
        skippedFiles: [],
        errors: [],
      },
    })

    const { output, restore } = captureConsole()
    const program = createProgram()
    program.exitOverride()

    await program.parseAsync(['node', 'ao', 'job', 'show', jobId, '--path', tempDir])
    restore()

    const combined = output.join('\n')
    expect(combined).toContain('apply')
    expect(combined).toContain('wrote 1')
  })
})

describe('job compare', () => {
  it('renders comparable runs sharing the same baseline fingerprint', async () => {
    const baselineSnapshot = {
      fingerprint: 'shared-fp-1',
      capturedAt: '2026-03-22T00:00:00Z',
      files: [
        {
          path: '/ws/docs/plan.md',
          relativePath: 'docs/plan.md',
          content: '# Plan\n',
          sha256: 'sha-plan',
        },
      ],
    }

    await seedJob('compare-job-a-0000-0000-000000000004', {
      targetResolution: {
        entryTarget: '/ws/docs/plan.md',
        entryKind: 'file',
        workspaceRoot: '/ws',
        resolvedFiles: ['/ws/docs/plan.md'],
        discovery: [{ path: '/ws/docs/plan.md', reason: 'entry' }],
      },
      baselineSnapshot,
      createdAt: '2026-03-22T00:00:00Z',
      updatedAt: '2026-03-22T00:00:00Z',
    })
    await seedRound('compare-job-a-0000-0000-000000000004', {
      id: 'round-final-a',
      jobId: 'compare-job-a-0000-0000-000000000004',
      index: 5,
      state: 'final_check',
      reviewerOutputs: [],
      createdAt: '2026-03-22T00:00:00Z',
      finalCheckSummary: {
        verdict: 'mixed',
        score: 65,
        summary: 'Some improvement.',
        changedFiles: ['/ws/docs/plan.md'],
        unchangedFiles: [],
        baselineFingerprint: 'shared-fp-1',
      },
    })

    await seedJob('compare-job-b-0000-0000-000000000005', {
      targetResolution: {
        entryTarget: '/ws/docs/plan.md',
        entryKind: 'file',
        workspaceRoot: '/ws',
        resolvedFiles: ['/ws/docs/plan.md'],
        discovery: [{ path: '/ws/docs/plan.md', reason: 'entry' }],
      },
      baselineSnapshot,
      createdAt: '2026-03-22T01:00:00Z',
      updatedAt: '2026-03-22T01:00:00Z',
    })
    await seedRound('compare-job-b-0000-0000-000000000005', {
      id: 'round-final-b',
      jobId: 'compare-job-b-0000-0000-000000000005',
      index: 5,
      state: 'final_check',
      reviewerOutputs: [],
      createdAt: '2026-03-22T01:00:00Z',
      finalCheckSummary: {
        verdict: 'improved',
        score: 88,
        summary: 'Best run.',
        changedFiles: ['/ws/docs/plan.md'],
        unchangedFiles: [],
        baselineFingerprint: 'shared-fp-1',
      },
    })

    const { output, restore } = captureConsole()
    const program = createProgram()
    program.exitOverride()

    await program.parseAsync([
      'node',
      'ao',
      'job',
      'compare',
      'compare-job-a-0000-0000-000000000004',
      '--path',
      tempDir,
    ])
    restore()

    const combined = output.join('\n')
    expect(combined).toContain('Comparable runs')
    expect(combined).toContain('shared-fp-1')
    expect(combined).toContain('compare-job-b')
    expect(combined).toContain('88')
  })
})
