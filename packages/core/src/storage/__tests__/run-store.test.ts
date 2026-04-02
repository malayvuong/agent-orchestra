import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { FileRunStore } from '../run-store.js'
import type { RunRecord, ToolCallRecord, GuardViolation } from '../../types/runtime.js'

describe('FileRunStore', () => {
  let baseDir: string
  let store: FileRunStore

  const makeRun = (
    overrides?: Partial<Omit<RunRecord, 'toolCalls' | 'guardViolations'>>,
  ): Omit<RunRecord, 'toolCalls' | 'guardViolations'> => ({
    runId: `run-${Math.random().toString(36).slice(2, 8)}`,
    source: 'chat',
    startedAt: Date.now(),
    status: 'running',
    ...overrides,
  })

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'ao-test-runstore-'))
    store = new FileRunStore(baseDir)
  })

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true })
  })

  it('should create and load a run', async () => {
    const input = makeRun({ runId: 'run-1', sessionId: 'sess-1', source: 'chat' })
    const created = await store.create(input)

    expect(created.runId).toBe('run-1')
    expect(created.toolCalls).toEqual([])
    expect(created.guardViolations).toEqual([])

    const loaded = await store.load('run-1')
    expect(loaded).toBeDefined()
    expect(loaded!.runId).toBe('run-1')
    expect(loaded!.sessionId).toBe('sess-1')
    expect(loaded!.status).toBe('running')
  })

  it('should return undefined for non-existent run', async () => {
    const loaded = await store.load('no-such-run')
    expect(loaded).toBeUndefined()
  })

  it('should update run fields', async () => {
    await store.create(makeRun({ runId: 'run-2' }))

    const updated = await store.update('run-2', {
      status: 'completed',
      endedAt: Date.now(),
      finalReply: 'Done.',
    })

    expect(updated.status).toBe('completed')
    expect(updated.endedAt).toBeDefined()
    expect(updated.finalReply).toBe('Done.')
    expect(updated.runId).toBe('run-2') // runId must not change
  })

  it('should throw when updating non-existent run', async () => {
    await expect(store.update('ghost', { status: 'failed' })).rejects.toThrow(
      'Run not found: ghost',
    )
  })

  it('should list runs by session', async () => {
    await store.create(makeRun({ runId: 'r1', sessionId: 'sess-a' }))
    await store.create(makeRun({ runId: 'r2', sessionId: 'sess-a' }))
    await store.create(makeRun({ runId: 'r3', sessionId: 'sess-b' }))

    const sessA = await store.listBySession('sess-a')
    const sessB = await store.listBySession('sess-b')

    expect(sessA).toHaveLength(2)
    expect(sessB).toHaveLength(1)
  })

  it('should list runs by task', async () => {
    await store.create(makeRun({ runId: 'r1', taskId: 'task-x' }))
    await store.create(makeRun({ runId: 'r2', taskId: 'task-x' }))
    await store.create(makeRun({ runId: 'r3', taskId: 'task-y' }))

    const taskX = await store.listByTask('task-x')
    expect(taskX).toHaveLength(2)
  })

  it('should return empty list when no runs exist', async () => {
    const runs = await store.listBySession('empty')
    expect(runs).toEqual([])
  })

  it('should append tool call to run', async () => {
    await store.create(makeRun({ runId: 'r-tc' }))

    const toolCall: ToolCallRecord = {
      id: 'tc-1',
      name: 'read_file',
      startedAt: Date.now(),
      endedAt: Date.now() + 100,
      status: 'ok',
      summary: 'Read 42 lines',
      durationMs: 100,
    }

    await store.appendToolCall('r-tc', toolCall)

    const loaded = await store.load('r-tc')
    expect(loaded!.toolCalls).toHaveLength(1)
    expect(loaded!.toolCalls[0].name).toBe('read_file')
    expect(loaded!.toolCalls[0].summary).toBe('Read 42 lines')
  })

  it('should append multiple tool calls', async () => {
    await store.create(makeRun({ runId: 'r-multi' }))

    await store.appendToolCall('r-multi', {
      id: 'tc-1',
      name: 'read_file',
      startedAt: Date.now(),
      status: 'ok',
    })
    await store.appendToolCall('r-multi', {
      id: 'tc-2',
      name: 'write_file',
      startedAt: Date.now(),
      status: 'ok',
    })

    const loaded = await store.load('r-multi')
    expect(loaded!.toolCalls).toHaveLength(2)
  })

  it('should throw when appending tool call to non-existent run', async () => {
    await expect(
      store.appendToolCall('ghost', {
        id: 'tc-1',
        name: 'x',
        startedAt: Date.now(),
        status: 'ok',
      }),
    ).rejects.toThrow('Run not found: ghost')
  })

  it('should append guard violation to run', async () => {
    await store.create(makeRun({ runId: 'r-gv' }))

    const violation: GuardViolation = {
      type: 'promise_without_action',
      message: 'Model promised but did not act',
      timestamp: Date.now(),
      resolution: 'blocked',
    }

    await store.appendGuardViolation('r-gv', violation)

    const loaded = await store.load('r-gv')
    expect(loaded!.guardViolations).toHaveLength(1)
    expect(loaded!.guardViolations[0].type).toBe('promise_without_action')
  })

  it('should throw when appending violation to non-existent run', async () => {
    await expect(
      store.appendGuardViolation('ghost', {
        type: 'no_evidence',
        message: 'test',
        timestamp: Date.now(),
        resolution: 'blocked',
      }),
    ).rejects.toThrow('Run not found: ghost')
  })

  it('should allow sessionId to be undefined (Phase 1A)', async () => {
    const run = await store.create(makeRun({ runId: 'r-no-sess' }))
    expect(run.sessionId).toBeUndefined()

    const loaded = await store.load('r-no-sess')
    expect(loaded!.sessionId).toBeUndefined()
  })

  it('should preserve all fields through update', async () => {
    await store.create(makeRun({ runId: 'r-full', sessionId: 's1', taskId: 't1', model: 'gpt-4' }))
    await store.appendToolCall('r-full', {
      id: 'tc-1',
      name: 'bash',
      startedAt: Date.now(),
      status: 'ok',
    })

    const updated = await store.update('r-full', { status: 'completed' })
    expect(updated.sessionId).toBe('s1')
    expect(updated.taskId).toBe('t1')
    expect(updated.model).toBe('gpt-4')
    expect(updated.toolCalls).toHaveLength(1)
  })
})
