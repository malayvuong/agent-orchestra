import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Scheduler, calculateNextRunMs } from '../scheduler.js'
import type { AutomationJobDefinition } from '../types.js'

describe('Scheduler', () => {
  let scheduler: Scheduler
  let runCalls: AutomationJobDefinition[]

  const makeJob = (overrides?: Partial<AutomationJobDefinition>): AutomationJobDefinition => ({
    id: `job-${Math.random().toString(36).slice(2, 8)}`,
    name: 'Test Job',
    workflow: [],
    enabled: true,
    createdAt: Date.now(),
    ...overrides,
  })

  beforeEach(() => {
    vi.useFakeTimers()
    runCalls = []
    scheduler = new Scheduler({ storageDir: '/tmp/ao-test-scheduler' }, async (job) => {
      runCalls.push(job)
    })
  })

  afterEach(() => {
    scheduler.shutdown()
    vi.useRealTimers()
  })

  it('should register and list jobs', () => {
    const job1 = makeJob({ id: 'j1' })
    const job2 = makeJob({ id: 'j2' })

    scheduler.register(job1)
    scheduler.register(job2)

    const jobs = scheduler.listJobs()
    expect(jobs).toHaveLength(2)
    expect(jobs.map((j) => j.id).sort()).toEqual(['j1', 'j2'])
  })

  it('should unregister a job', () => {
    const job = makeJob({ id: 'j1' })
    scheduler.register(job)

    scheduler.unregister('j1')

    expect(scheduler.listJobs()).toHaveLength(0)
  })

  it('should schedule an enabled job with a schedule', async () => {
    const job = makeJob({ id: 'j1', schedule: 'every 5m', enabled: true })
    scheduler.register(job)

    // Advance time by 5 minutes
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)

    expect(runCalls).toHaveLength(1)
    expect(runCalls[0].id).toBe('j1')
  })

  it('should not schedule a disabled job', async () => {
    const job = makeJob({ id: 'j1', schedule: 'every 5m', enabled: false })
    scheduler.register(job)

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)

    expect(runCalls).toHaveLength(0)
  })

  it('should not schedule a job without a schedule', async () => {
    const job = makeJob({ id: 'j1', enabled: true })
    scheduler.register(job)

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)

    expect(runCalls).toHaveLength(0)
  })

  it('should re-schedule after execution', async () => {
    const job = makeJob({ id: 'j1', schedule: 'every 5m', enabled: true })
    scheduler.register(job)

    // First execution
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
    expect(runCalls).toHaveLength(1)

    // Second execution
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
    expect(runCalls).toHaveLength(2)
  })

  it('should clear timer on unregister', async () => {
    const job = makeJob({ id: 'j1', schedule: 'every 5m', enabled: true })
    scheduler.register(job)

    scheduler.unregister('j1')

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)

    expect(runCalls).toHaveLength(0)
  })

  it('should clear all timers on shutdown', async () => {
    scheduler.register(makeJob({ id: 'j1', schedule: 'every 5m', enabled: true }))
    scheduler.register(makeJob({ id: 'j2', schedule: 'every 1h', enabled: true }))

    scheduler.shutdown()

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)

    expect(runCalls).toHaveLength(0)
  })

  it('should update lastRunStatus to ok on success', async () => {
    const job = makeJob({ id: 'j1', schedule: 'every 5m', enabled: true })
    scheduler.register(job)

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)

    const listed = scheduler.listJobs().find((j) => j.id === 'j1')
    expect(listed!.lastRunStatus).toBe('ok')
    expect(listed!.lastRunAt).toBeDefined()
  })

  it('should update lastRunStatus to failed on error', async () => {
    scheduler.shutdown()
    scheduler = new Scheduler({ storageDir: '/tmp/ao-test-scheduler' }, async () => {
      throw new Error('boom')
    })

    const job = makeJob({ id: 'j1', schedule: 'every 5m', enabled: true })
    scheduler.register(job)

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)

    const listed = scheduler.listJobs().find((j) => j.id === 'j1')
    expect(listed!.lastRunStatus).toBe('failed')
  })
})

describe('calculateNextRunMs', () => {
  it('should parse "every 5m" as 300000ms', () => {
    expect(calculateNextRunMs('every 5m')).toBe(300_000)
  })

  it('should parse "every 1h" as 3600000ms', () => {
    expect(calculateNextRunMs('every 1h')).toBe(3_600_000)
  })

  it('should parse "every 1d" as 86400000ms', () => {
    expect(calculateNextRunMs('every 1d')).toBe(86_400_000)
  })

  it('should parse "every 30m" correctly', () => {
    expect(calculateNextRunMs('every 30m')).toBe(30 * 60 * 1000)
  })

  it('should return 0 for invalid schedule format', () => {
    expect(calculateNextRunMs('invalid')).toBe(0)
    expect(calculateNextRunMs('')).toBe(0)
    expect(calculateNextRunMs('every')).toBe(0)
    expect(calculateNextRunMs('every 5x')).toBe(0)
  })
})
