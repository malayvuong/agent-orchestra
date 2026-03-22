import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { FileJobStore } from '../job-store.js'
import type { Job } from '../../types/job.js'

describe('FileJobStore', () => {
  let baseDir: string
  let store: FileJobStore

  /** Minimal job fields required by create() (everything except id, status, createdAt, updatedAt). */
  const jobPartial: Omit<Job, 'id' | 'createdAt' | 'updatedAt' | 'status'> = {
    title: 'Test Job',
    mode: 'code_review',
    brief: 'Review the storage module',
    protocol: 'single_challenger',
    scope: {
      primaryTargets: ['src/storage/'],
      excludedTargets: [],
      referencePolicy: { enabled: false, depth: 'same_file' },
      outOfScopeHandling: 'ignore',
      allowDebateExpansion: false,
    },
    targetResolution: {
      entryTarget: '/tmp/workspace/src/storage',
      entryKind: 'directory',
      workspaceRoot: '/tmp/workspace',
      resolvedFiles: ['src/storage/job-store.ts'],
      discovery: [
        {
          path: '/tmp/workspace/src/storage/job-store.ts',
          reason: 'directory_walk',
        },
      ],
    },
    baselineSnapshot: {
      fingerprint: 'baseline-fingerprint-1',
      capturedAt: '2026-03-22T00:00:00Z',
      files: [
        {
          path: '/tmp/workspace/src/storage/job-store.ts',
          relativePath: 'src/storage/job-store.ts',
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
    agents: [],
    currentRoundIndex: 0,
    maxRounds: 3,
    templateVersions: {},
    runtimeConfig: {
      maxConcurrentAgents: 3,
      pausePointsEnabled: false,
      synthesisConfig: { provider: 'architect_provider', rerunnable: true },
    },
  }

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'ao-test-jobstore-'))
    store = new FileJobStore(baseDir)
  })

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true })
  })

  it('should create a job with UUID, draft status, and timestamps', async () => {
    const job = await store.create(jobPartial)

    expect(job.id).toBeDefined()
    expect(job.id.length).toBeGreaterThan(0)
    expect(job.status).toBe('draft')
    expect(job.createdAt).toBeDefined()
    expect(job.updatedAt).toBeDefined()
    expect(job.title).toBe('Test Job')
    expect(job.targetResolution.entryKind).toBe('directory')
    expect(job.baselineSnapshot?.fingerprint).toBe('baseline-fingerprint-1')
  })

  it('should load a previously created job', async () => {
    const created = await store.create(jobPartial)
    const loaded = await store.load(created.id)

    expect(loaded).toBeDefined()
    expect(loaded!.id).toBe(created.id)
    expect(loaded!.title).toBe('Test Job')
    expect(loaded!.status).toBe('draft')
  })

  it('should return undefined when loading a non-existent job', async () => {
    const loaded = await store.load('non-existent-id')
    expect(loaded).toBeUndefined()
  })

  it('should update job status and updatedAt', async () => {
    const created = await store.create(jobPartial)
    const updated = await store.updateStatus(created.id, 'running')

    expect(updated.status).toBe('running')
    expect(updated.updatedAt).not.toBe(created.updatedAt)

    // Verify persistence
    const loaded = await store.load(created.id)
    expect(loaded!.status).toBe('running')
  })

  it('should throw when updating status of a non-existent job', async () => {
    await expect(store.updateStatus('no-such-job', 'running')).rejects.toThrow('Job not found')
  })

  it('should list all jobs', async () => {
    await store.create(jobPartial)
    await store.create({ ...jobPartial, title: 'Second Job' })

    const jobs = await store.list()
    expect(jobs).toHaveLength(2)

    const titles = jobs.map((j) => j.title).sort()
    expect(titles).toEqual(['Second Job', 'Test Job'])
  })

  it('should return empty list when no jobs exist', async () => {
    const jobs = await store.list()
    expect(jobs).toEqual([])
  })

  it('should save and overwrite an existing job', async () => {
    const created = await store.create(jobPartial)
    created.title = 'Updated Title'
    await store.save(created)

    const loaded = await store.load(created.id)
    expect(loaded!.title).toBe('Updated Title')
  })
})
