import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { FileRoundStore } from '../round-store.js'
import type { Round } from '../../types/protocol.js'

describe('FileRoundStore', () => {
  let baseDir: string
  let store: FileRoundStore

  const makeRound = (jobId: string, index: number): Round => ({
    id: `round-${jobId}-${index}`,
    jobId,
    index,
    state: 'analysis',
    reviewerOutputs: [],
    createdAt: new Date().toISOString(),
  })

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'ao-test-roundstore-'))
    store = new FileRoundStore(baseDir)
  })

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true })
  })

  it('should save and load a round', async () => {
    const round = makeRound('job-1', 0)
    await store.save(round)

    const loaded = await store.load('job-1', 0)
    expect(loaded).toBeDefined()
    expect(loaded!.id).toBe(round.id)
    expect(loaded!.jobId).toBe('job-1')
    expect(loaded!.index).toBe(0)
    expect(loaded!.state).toBe('analysis')
  })

  it('should return undefined when loading a non-existent round', async () => {
    const loaded = await store.load('no-job', 0)
    expect(loaded).toBeUndefined()
  })

  it('should list all rounds for a job sorted by index', async () => {
    // Save rounds out of order
    await store.save(makeRound('job-1', 2))
    await store.save(makeRound('job-1', 0))
    await store.save(makeRound('job-1', 1))

    const rounds = await store.listByJob('job-1')
    expect(rounds).toHaveLength(3)
    expect(rounds[0].index).toBe(0)
    expect(rounds[1].index).toBe(1)
    expect(rounds[2].index).toBe(2)
  })

  it('should return empty list when no rounds exist for a job', async () => {
    const rounds = await store.listByJob('empty-job')
    expect(rounds).toEqual([])
  })

  it('should isolate rounds between different jobs', async () => {
    await store.save(makeRound('job-a', 0))
    await store.save(makeRound('job-b', 0))
    await store.save(makeRound('job-b', 1))

    const roundsA = await store.listByJob('job-a')
    const roundsB = await store.listByJob('job-b')

    expect(roundsA).toHaveLength(1)
    expect(roundsB).toHaveLength(2)
  })

  it('should overwrite a round when saved again', async () => {
    const round = makeRound('job-1', 0)
    await store.save(round)

    round.state = 'review'
    await store.save(round)

    const loaded = await store.load('job-1', 0)
    expect(loaded!.state).toBe('review')
  })
})
