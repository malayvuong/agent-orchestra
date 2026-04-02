import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { FileAutomationStore } from '../automation-store.js'
import type { AutomationJobDefinition } from '../../runner/types.js'

describe('FileAutomationStore', () => {
  let baseDir: string
  let store: FileAutomationStore

  const makeJob = (overrides?: Partial<AutomationJobDefinition>): AutomationJobDefinition => ({
    id: `job-${Math.random().toString(36).slice(2, 8)}`,
    name: 'Test Automation',
    workflow: [{ id: 's1', type: 'tool_call', name: 'step-1', config: {} }],
    enabled: true,
    createdAt: Date.now(),
    ...overrides,
  })

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'ao-test-automationstore-'))
    store = new FileAutomationStore(baseDir)
  })

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true })
  })

  it('should save and load an automation job', async () => {
    const job = makeJob({ id: 'auto-1', name: 'My Automation' })
    await store.save(job)

    const loaded = await store.load('auto-1')
    expect(loaded).toBeDefined()
    expect(loaded!.id).toBe('auto-1')
    expect(loaded!.name).toBe('My Automation')
    expect(loaded!.enabled).toBe(true)
    expect(loaded!.workflow).toHaveLength(1)
  })

  it('should return undefined for non-existent job', async () => {
    const loaded = await store.load('no-such-job')
    expect(loaded).toBeUndefined()
  })

  it('should overwrite an existing job', async () => {
    const job = makeJob({ id: 'auto-1', name: 'Original' })
    await store.save(job)

    job.name = 'Updated'
    await store.save(job)

    const loaded = await store.load('auto-1')
    expect(loaded!.name).toBe('Updated')
  })

  it('should list all automation jobs', async () => {
    await store.save(makeJob({ id: 'a1', name: 'First' }))
    await store.save(makeJob({ id: 'a2', name: 'Second' }))
    await store.save(makeJob({ id: 'a3', name: 'Third' }))

    const jobs = await store.list()
    expect(jobs).toHaveLength(3)

    const names = jobs.map((j) => j.name).sort()
    expect(names).toEqual(['First', 'Second', 'Third'])
  })

  it('should return empty list when no jobs exist', async () => {
    const jobs = await store.list()
    expect(jobs).toEqual([])
  })

  it('should delete an automation job', async () => {
    const job = makeJob({ id: 'auto-del' })
    await store.save(job)

    await store.delete('auto-del')

    const loaded = await store.load('auto-del')
    expect(loaded).toBeUndefined()
  })

  it('should not throw when deleting a non-existent job', async () => {
    await expect(store.delete('ghost')).resolves.toBeUndefined()
  })

  it('should preserve all fields through save/load', async () => {
    const job = makeJob({
      id: 'full-job',
      name: 'Full Job',
      description: 'A complete job',
      schedule: 'every 5m',
      trigger: 'cron',
      notify: {
        onSuccess: [{ type: 'console', destination: 'stdout' }],
        onFailure: [{ type: 'webhook', destination: 'https://example.com/hook' }],
      },
      lastRunAt: 1234567890,
      lastRunStatus: 'ok',
    })

    await store.save(job)

    const loaded = await store.load('full-job')
    expect(loaded!.description).toBe('A complete job')
    expect(loaded!.schedule).toBe('every 5m')
    expect(loaded!.trigger).toBe('cron')
    expect(loaded!.notify!.onSuccess).toHaveLength(1)
    expect(loaded!.notify!.onFailure![0].type).toBe('webhook')
    expect(loaded!.lastRunAt).toBe(1234567890)
    expect(loaded!.lastRunStatus).toBe('ok')
  })
})
