import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { InteractiveRunner } from '../interactive-runner.js'
import { FileRunStore } from '../../storage/run-store.js'
import { FileTaskStore } from '../../storage/task-store.js'
import type { RunRequest, SessionState } from '../../types/runtime.js'

describe('InteractiveRunner', () => {
  let baseDir: string
  let runStore: FileRunStore
  let taskStore: FileTaskStore

  const makeSession = (): SessionState => ({
    sessionId: 'sess-1',
    sessionType: 'interactive',
    owner: 'test',
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
  })

  const makeRequest = (msg?: string): RunRequest => ({
    source: 'chat',
    sessionId: 'sess-1',
    actorId: 'user-1',
    trustedMeta: {},
    userMessage: msg ?? 'Fix the login bug',
    requestedMode: 'interactive',
  })

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'ao-test-interactive-'))
    runStore = new FileRunStore(baseDir)
    taskStore = new FileTaskStore(baseDir)
  })

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true })
  })

  it('should create run and task records', async () => {
    const runner = new InteractiveRunner(runStore, taskStore)
    const result = await runner.execute(makeRequest(), makeSession())

    expect(result.runRecord).toBeDefined()
    expect(result.runRecord.status).toBe('completed')

    // Check task was created
    const tasks = await taskStore.listBySession('sess-1')
    expect(tasks).toHaveLength(1)
    expect(tasks[0].title).toBe('Fix the login bug')
    expect(tasks[0].executionRequired).toBe(true) // "Fix" is an action verb
  })

  it('should classify question tasks as not executionRequired', async () => {
    const runner = new InteractiveRunner(runStore, taskStore)
    await runner.execute(makeRequest('What is the database schema?'), makeSession())

    const tasks = await taskStore.listBySession('sess-1')
    expect(tasks[0].executionRequired).toBe(false)
  })

  it('should work without model executor (skeleton mode)', async () => {
    const runner = new InteractiveRunner(runStore, taskStore)
    const result = await runner.execute(makeRequest(), makeSession())

    expect(result.output).toBe('(no model executor configured)')
    expect(result.runRecord.status).toBe('completed')
  })

  it('should execute model and log tool calls', async () => {
    const mockModel = async () => ({
      text: 'Fixed the bug.',
      toolCalls: [
        { id: 'tc-1', name: 'edit_file', result: 'Edited login.ts', status: 'ok' as const },
      ],
    })

    const runner = new InteractiveRunner(runStore, taskStore, mockModel)
    const result = await runner.execute(makeRequest(), makeSession())

    expect(result.output).toBe('Fixed the bug.')
    expect(result.runRecord.status).toBe('completed')
    expect(result.runRecord.toolCalls).toHaveLength(1)
    expect(result.runRecord.toolCalls[0].name).toBe('edit_file')
  })

  it('should update task with evidence from tool calls', async () => {
    const mockModel = async () => ({
      text: 'Done.',
      toolCalls: [
        { id: 'tc-1', name: 'read_file', result: 'Read 42 lines', status: 'ok' as const },
      ],
    })

    const runner = new InteractiveRunner(runStore, taskStore, mockModel)
    await runner.execute(makeRequest(), makeSession())

    const tasks = await taskStore.listBySession('sess-1')
    expect(tasks[0].lastEvidence).toBeDefined()
    expect(tasks[0].lastActionAt).toBeDefined()
  })

  it('should handle model execution failure', async () => {
    const failingModel = async () => {
      throw new Error('API rate limit')
    }

    const runner = new InteractiveRunner(runStore, taskStore, failingModel)
    const result = await runner.execute(makeRequest(), makeSession())

    expect(result.error).toBe('API rate limit')
    expect(result.runRecord.status).toBe('failed')
    expect(result.runRecord.failureReason).toBe('API rate limit')

    const tasks = await taskStore.listBySession('sess-1')
    expect(tasks[0].status).toBe('failed')
    expect(tasks[0].blocker).toBe('API rate limit')
  })

  it('should cancel a run', async () => {
    const runner = new InteractiveRunner(runStore, taskStore)
    const result = await runner.execute(makeRequest(), makeSession())

    await runner.cancel(result.runRecord.runId)

    const loaded = await runStore.load(result.runRecord.runId)
    expect(loaded!.status).toBe('cancelled')
  })

  it('should report mode as interactive', () => {
    const runner = new InteractiveRunner(runStore, taskStore)
    expect(runner.mode).toBe('interactive')
  })
})
