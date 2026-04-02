import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { FileTaskStore } from '../task-store.js'
import type { TaskState } from '../../types/runtime.js'

describe('FileTaskStore', () => {
  let baseDir: string
  let store: FileTaskStore

  const makeTask = (
    overrides?: Partial<Omit<TaskState, 'taskId' | 'createdAt' | 'updatedAt'>>,
  ): Omit<TaskState, 'taskId' | 'createdAt' | 'updatedAt'> => ({
    origin: 'user',
    status: 'queued',
    title: 'Test task',
    objective: 'Do something',
    executionRequired: true,
    ...overrides,
  })

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'ao-test-taskstore-'))
    store = new FileTaskStore(baseDir)
  })

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true })
  })

  it('should create a task with generated id and timestamps', async () => {
    const task = await store.create(makeTask({ title: 'My task' }))

    expect(task.taskId).toBeDefined()
    expect(task.taskId.length).toBeGreaterThan(0)
    expect(task.title).toBe('My task')
    expect(task.createdAt).toBeGreaterThan(0)
    expect(task.updatedAt).toBe(task.createdAt)
  })

  it('should create and load a task', async () => {
    const created = await store.create(makeTask({ title: 'Load me', sessionId: 'sess-1' }))

    const loaded = await store.load(created.taskId)
    expect(loaded).toBeDefined()
    expect(loaded!.title).toBe('Load me')
    expect(loaded!.sessionId).toBe('sess-1')
    expect(loaded!.executionRequired).toBe(true)
  })

  it('should return undefined for non-existent task', async () => {
    const loaded = await store.load('no-such-task')
    expect(loaded).toBeUndefined()
  })

  it('should update task fields and bump updatedAt', async () => {
    const created = await store.create(makeTask({ title: 'Update me' }))

    // Small delay to ensure updatedAt changes
    await new Promise((r) => setTimeout(r, 5))

    const updated = await store.update(created.taskId, {
      status: 'running',
      lastActionAt: Date.now(),
    })

    expect(updated.status).toBe('running')
    expect(updated.lastActionAt).toBeDefined()
    expect(updated.updatedAt).toBeGreaterThan(created.updatedAt)
    expect(updated.taskId).toBe(created.taskId) // taskId must not change
    expect(updated.createdAt).toBe(created.createdAt) // createdAt must not change
  })

  it('should throw when updating non-existent task', async () => {
    await expect(store.update('ghost', { status: 'done' })).rejects.toThrow('Task not found: ghost')
  })

  it('should list tasks by session', async () => {
    await store.create(makeTask({ sessionId: 'sess-a', title: 'Task A1' }))
    await store.create(makeTask({ sessionId: 'sess-a', title: 'Task A2' }))
    await store.create(makeTask({ sessionId: 'sess-b', title: 'Task B1' }))

    const sessA = await store.listBySession('sess-a')
    const sessB = await store.listBySession('sess-b')

    expect(sessA).toHaveLength(2)
    expect(sessB).toHaveLength(1)
  })

  it('should list tasks by status', async () => {
    await store.create(makeTask({ title: 'Queued 1' }))
    await store.create(makeTask({ title: 'Queued 2' }))
    await store.create(makeTask({ title: 'Running', status: 'running' }))

    const queued = await store.listByStatus('queued')
    const running = await store.listByStatus('running')
    const done = await store.listByStatus('done')

    expect(queued).toHaveLength(2)
    expect(running).toHaveLength(1)
    expect(done).toHaveLength(0)
  })

  it('should return empty list when no tasks exist', async () => {
    const tasks = await store.listBySession('empty')
    expect(tasks).toEqual([])
  })

  it('should handle all task statuses', async () => {
    const statuses = ['queued', 'running', 'blocked', 'waiting', 'done', 'failed'] as const
    for (const status of statuses) {
      const task = await store.create(makeTask({ status, title: `Status: ${status}` }))
      const loaded = await store.load(task.taskId)
      expect(loaded!.status).toBe(status)
    }
  })

  it('should handle all task origins', async () => {
    const origins = ['user', 'cron', 'system', 'subagent'] as const
    for (const origin of origins) {
      const task = await store.create(makeTask({ origin, title: `Origin: ${origin}` }))
      const loaded = await store.load(task.taskId)
      expect(loaded!.origin).toBe(origin)
    }
  })

  it('should preserve optional fields', async () => {
    const created = await store.create(
      makeTask({
        runId: 'run-1',
        blocker: 'Need API key',
        resumeHint: 'Retry after config',
        lastEvidence: 'File read OK',
      }),
    )

    const loaded = await store.load(created.taskId)
    expect(loaded!.runId).toBe('run-1')
    expect(loaded!.blocker).toBe('Need API key')
    expect(loaded!.resumeHint).toBe('Retry after config')
    expect(loaded!.lastEvidence).toBe('File read OK')
  })

  it('should allow sessionId to be undefined', async () => {
    const task = await store.create(makeTask({ title: 'No session' }))
    expect(task.sessionId).toBeUndefined()
  })
})
