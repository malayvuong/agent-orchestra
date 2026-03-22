import { describe, it, expect, vi } from 'vitest'
import { Orchestrator } from '../orchestrator.js'
import { DefaultCancellationRegistry } from '../cancellation.js'
import { ProtocolRegistry } from '../../protocols/registry.js'
import type { ProtocolRunner } from '../../interfaces/protocol-runner.js'
import type { Job } from '../../types/job.js'
import type { ProtocolExecutionDeps } from '../../types/orchestrator.js'
import type { JobStore } from '../../storage/types.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'test-job-id',
    title: 'Test Job',
    mode: 'code_review',
    brief: 'Test brief',
    status: 'draft',
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
          content: 'export const x = 1\n',
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
    maxRounds: 10,
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

function makeInMemoryJobStore(): JobStore {
  const jobs = new Map<string, Job>()

  return {
    async create(partial) {
      const now = new Date().toISOString()
      const job: Job = {
        ...partial,
        id: `job-${Date.now()}`,
        status: 'draft',
        createdAt: now,
        updatedAt: now,
      } as Job
      jobs.set(job.id, job)
      return job
    },
    async load(jobId) {
      return jobs.get(jobId)
    },
    async updateStatus(jobId, status) {
      const job = jobs.get(jobId)
      if (!job) throw new Error(`Job not found: ${jobId}`)
      job.status = status
      job.updatedAt = new Date().toISOString()
      return job
    },
    async list() {
      return [...jobs.values()]
    },
    async save(job) {
      jobs.set(job.id, job)
    },
  }
}

function makeMockDeps(overrides: Partial<ProtocolExecutionDeps> = {}): ProtocolExecutionDeps {
  return {
    providerExecutor: null,
    contextBuilder: {
      buildFor: vi
        .fn()
        .mockReturnValue({
          role: 'architect',
          mode: 'code_review',
          pinned: {},
          dynamic: {},
          evidence: [],
        }),
    },
    outputNormalizer: { normalize: vi.fn() },
    scopeGuard: null,
    clusteringEngine: null,
    synthesisEngine: null,
    roundStore: { save: vi.fn(), load: vi.fn(), listByJob: vi.fn() },
    jobStore: makeInMemoryJobStore(),
    eventBus: {
      emit: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      once: vi.fn(),
      removeAllListeners: vi.fn(),
    },
    cancellationRegistry: new DefaultCancellationRegistry(),
    budgetManager: { fitToLimit: (ctx: unknown) => ctx },
    resolvedSkills: [],
    ...overrides,
  } as unknown as ProtocolExecutionDeps
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Orchestrator', () => {
  describe('createJob', () => {
    it('should create a job with draft status', async () => {
      const deps = makeMockDeps()
      const registry = new ProtocolRegistry()
      const orchestrator = new Orchestrator(registry, deps)

      const job = await orchestrator.createJob({
        title: 'Test Review',
        brief: 'Review the code',
        mode: 'code_review',
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
              content: 'export const x = 1\n',
              sha256: 'sha-1',
            },
          ],
        },
        agents: [],
      })

      expect(job).toBeDefined()
      expect(job.id).toBeTruthy()
      expect(job.status).toBe('draft')
      expect(job.title).toBe('Test Review')
      expect(job.protocol).toBe('single_challenger')
      expect(job.targetResolution.resolvedFiles).toEqual(['/tmp/workspace/src/index.ts'])
      expect(job.baselineSnapshot?.fingerprint).toBe('fp-1')
    })
  })

  describe('runJob', () => {
    it('should transition job: draft -> running -> awaiting_decision on success', async () => {
      const jobStore = makeInMemoryJobStore()
      const testJob = makeJob()
      await jobStore.save(testJob)

      const mockRunner: ProtocolRunner = {
        execute: vi.fn().mockResolvedValue(undefined),
      }

      const registry = new ProtocolRegistry()
      registry.register('single_challenger', mockRunner)

      const deps = makeMockDeps({ jobStore })
      const orchestrator = new Orchestrator(registry, deps)

      await orchestrator.runJob(testJob.id)

      const updatedJob = await jobStore.load(testJob.id)
      expect(updatedJob?.status).toBe('awaiting_decision')
      expect(mockRunner.execute).toHaveBeenCalledOnce()
    })

    it('should transition job to failed on protocol error', async () => {
      const jobStore = makeInMemoryJobStore()
      const testJob = makeJob()
      await jobStore.save(testJob)

      const mockRunner: ProtocolRunner = {
        execute: vi.fn().mockRejectedValue(new Error('Provider error')),
      }

      const registry = new ProtocolRegistry()
      registry.register('single_challenger', mockRunner)

      const deps = makeMockDeps({ jobStore })
      const orchestrator = new Orchestrator(registry, deps)

      await expect(orchestrator.runJob(testJob.id)).rejects.toThrow('Provider error')

      const updatedJob = await jobStore.load(testJob.id)
      expect(updatedJob?.status).toBe('failed')
    })

    it('should transition job to cancelled when CancellationRegistry reports cancelled', async () => {
      const jobStore = makeInMemoryJobStore()
      const cancellationRegistry = new DefaultCancellationRegistry()
      const testJob = makeJob()
      await jobStore.save(testJob)

      const mockRunner: ProtocolRunner = {
        execute: vi.fn().mockImplementation(async () => {
          // Simulate cancellation happening during execution
          await cancellationRegistry.cancelJob(testJob.id)
          throw new Error('Job cancelled')
        }),
      }

      const registry = new ProtocolRegistry()
      registry.register('single_challenger', mockRunner)

      const deps = makeMockDeps({ jobStore, cancellationRegistry })
      const orchestrator = new Orchestrator(registry, deps)

      await expect(orchestrator.runJob(testJob.id)).rejects.toThrow('Job cancelled')

      const updatedJob = await jobStore.load(testJob.id)
      expect(updatedJob?.status).toBe('cancelled')
    })

    it('should throw when job is not found', async () => {
      const deps = makeMockDeps()
      const registry = new ProtocolRegistry()
      const orchestrator = new Orchestrator(registry, deps)

      await expect(orchestrator.runJob('nonexistent')).rejects.toThrow('Job not found')
    })

    it('should throw when protocol is not registered', async () => {
      const jobStore = makeInMemoryJobStore()
      const testJob = makeJob({ protocol: 'unknown_protocol' as Job['protocol'] })
      await jobStore.save(testJob)

      const registry = new ProtocolRegistry()
      // Don't register unknown_protocol

      const deps = makeMockDeps({ jobStore })
      const orchestrator = new Orchestrator(registry, deps)

      await expect(orchestrator.runJob(testJob.id)).rejects.toThrow('No protocol runner registered')
    })
  })
})
