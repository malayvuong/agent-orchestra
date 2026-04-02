import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Runtime } from '../runtime.js'
import type { RunRequest, RunRecord, SessionState, RunMode } from '../../types/runtime.js'
import type { Runner, RunnerResult } from '../../runner/types.js'
import type {
  SessionStore,
  RunStore,
  TaskStore,
  TranscriptStore,
} from '../../storage/runtime-store.js'
import type { ExecutionGuard, GuardResult } from '../../guard/execution-guard.js'

// ─── Mock factories ─────────────────────────────────────────────

function makeSessionStore(overrides?: Partial<SessionStore>): SessionStore {
  return {
    create: vi.fn(async (input) => ({
      ...input,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    })),
    load: vi.fn(async () => undefined),
    update: vi.fn(async (id, patch) => ({ sessionId: id, ...patch }) as SessionState),
    list: vi.fn(async () => []),
    touch: vi.fn(async () => {}),
    ...overrides,
  }
}

function makeRunStore(overrides?: Partial<RunStore>): RunStore {
  return {
    create: vi.fn(async (input) => ({ ...input, toolCalls: [], guardViolations: [] }) as RunRecord),
    load: vi.fn(async () => undefined),
    update: vi.fn(
      async (id, patch) =>
        ({ runId: id, ...patch, toolCalls: [], guardViolations: [] }) as RunRecord,
    ),
    listBySession: vi.fn(async () => []),
    listByTask: vi.fn(async () => []),
    appendToolCall: vi.fn(async () => {}),
    appendGuardViolation: vi.fn(async () => {}),
    ...overrides,
  }
}

function makeTaskStore(overrides?: Partial<TaskStore>): TaskStore {
  return {
    create: vi.fn(async (input) => ({
      ...input,
      taskId: 'task-1',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })),
    load: vi.fn(async () => undefined),
    update: vi.fn(async (id, patch) => ({ taskId: id, ...patch })),
    listBySession: vi.fn(async () => []),
    listByStatus: vi.fn(async () => []),
    ...overrides,
  } as unknown as TaskStore
}

function makeTranscriptStore(overrides?: Partial<TranscriptStore>): TranscriptStore {
  return {
    append: vi.fn(async (_sid, entry) => ({ ...entry, id: `tx-${Date.now()}` })),
    loadBySession: vi.fn(async () => []),
    loadByRun: vi.fn(async () => []),
    ...overrides,
  }
}

function makeGuard(overrides?: Partial<ExecutionGuard>): ExecutionGuard {
  return {
    validate: vi.fn(
      (): GuardResult => ({
        allowed: true,
        violations: [],
        suggestedAction: 'pass',
      }),
    ),
    ...overrides,
  } as unknown as ExecutionGuard
}

function makeRunner(mode: RunMode, result?: Partial<RunnerResult>): Runner {
  const defaultResult: RunnerResult = {
    runRecord: {
      runId: 'run-1',
      sessionId: 'sess-1',
      source: 'chat',
      startedAt: Date.now(),
      status: 'completed',
      toolCalls: [],
      guardViolations: [],
    },
    output: 'Done.',
    ...result,
  }
  return {
    mode,
    execute: vi.fn(async () => defaultResult),
    cancel: vi.fn(async () => {}),
  }
}

function makeRequest(overrides?: Partial<RunRequest>): RunRequest {
  return {
    source: 'chat',
    sessionId: 'sess-1',
    actorId: 'user-1',
    trustedMeta: {},
    requestedMode: 'interactive',
    ...overrides,
  }
}

const makeSession = (): SessionState => ({
  sessionId: 'sess-1',
  sessionType: 'interactive',
  owner: 'user-1',
  createdAt: Date.now(),
  lastActivityAt: Date.now(),
})

// ─── Tests ──────────────────────────────────────────────────────

describe('Runtime', () => {
  let sessionStore: SessionStore
  let runStore: RunStore
  let taskStore: TaskStore
  let transcriptStore: TranscriptStore
  let guard: ExecutionGuard
  let runtime: Runtime

  beforeEach(() => {
    sessionStore = makeSessionStore()
    runStore = makeRunStore()
    taskStore = makeTaskStore()
    transcriptStore = makeTranscriptStore()
    guard = makeGuard()
    runtime = new Runtime(sessionStore, runStore, taskStore, transcriptStore, guard)
  })

  // ─── Runner dispatch ────────────────────────────────────────

  it('should route request to the correct runner by mode', async () => {
    const interactiveRunner = makeRunner('interactive')
    const automationRunner = makeRunner('automation')
    runtime.registerRunner(interactiveRunner)
    runtime.registerRunner(automationRunner)

    await runtime.handleRequest(makeRequest({ requestedMode: 'interactive' }))
    expect(interactiveRunner.execute).toHaveBeenCalledTimes(1)
    expect(automationRunner.execute).not.toHaveBeenCalled()
  })

  it('should route automation requests to automation runner', async () => {
    const automationRunner = makeRunner('automation')
    runtime.registerRunner(automationRunner)

    await runtime.handleRequest(makeRequest({ requestedMode: 'automation' }))
    expect(automationRunner.execute).toHaveBeenCalledTimes(1)
  })

  it('should throw when no runner is registered for the requested mode', async () => {
    await expect(
      runtime.handleRequest(makeRequest({ requestedMode: 'background' })),
    ).rejects.toThrow('No runner registered for mode: background')
  })

  // ─── Session management ─────────────────────────────────────

  it('should create a session when one does not exist', async () => {
    const runner = makeRunner('interactive')
    runtime.registerRunner(runner)

    await runtime.handleRequest(makeRequest({ sessionId: 'new-sess' }))

    expect(sessionStore.load).toHaveBeenCalledWith('new-sess')
    expect(sessionStore.create).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'new-sess',
        sessionType: 'interactive',
        owner: 'user-1',
      }),
    )
  })

  it('should reuse existing session when found', async () => {
    const existing = makeSession()
    sessionStore = makeSessionStore({
      load: vi.fn(async () => existing),
    })
    runtime = new Runtime(sessionStore, runStore, taskStore, transcriptStore, guard)

    const runner = makeRunner('interactive')
    runtime.registerRunner(runner)

    await runtime.handleRequest(makeRequest())

    expect(sessionStore.load).toHaveBeenCalledWith('sess-1')
    expect(sessionStore.create).not.toHaveBeenCalled()
  })

  it('should map cron source to cron session type', async () => {
    const runner = makeRunner('automation')
    runtime.registerRunner(runner)

    await runtime.handleRequest(
      makeRequest({
        source: 'cron',
        requestedMode: 'automation',
      }),
    )

    expect(sessionStore.create).toHaveBeenCalledWith(
      expect.objectContaining({ sessionType: 'cron' }),
    )
  })

  it('should map subagent source to subagent session type', async () => {
    const runner = makeRunner('interactive')
    runtime.registerRunner(runner)

    await runtime.handleRequest(makeRequest({ source: 'subagent' }))

    expect(sessionStore.create).toHaveBeenCalledWith(
      expect.objectContaining({ sessionType: 'subagent' }),
    )
  })

  it('should map system source to subagent session type', async () => {
    const runner = makeRunner('interactive')
    runtime.registerRunner(runner)

    await runtime.handleRequest(makeRequest({ source: 'system' }))

    expect(sessionStore.create).toHaveBeenCalledWith(
      expect.objectContaining({ sessionType: 'subagent' }),
    )
  })

  // ─── Transcript logging ─────────────────────────────────────

  it('should log userMessage to transcript with user_input trust', async () => {
    const runner = makeRunner('interactive')
    runtime.registerRunner(runner)

    await runtime.handleRequest(makeRequest({ userMessage: 'hello' }))

    expect(transcriptStore.append).toHaveBeenCalledWith(
      'sess-1',
      expect.objectContaining({
        role: 'user',
        trustLevel: 'user_input',
        content: 'hello',
      }),
    )
  })

  it('should log systemEvent to transcript with system trust', async () => {
    const runner = makeRunner('interactive')
    runtime.registerRunner(runner)

    await runtime.handleRequest(
      makeRequest({
        systemEvent: 'deployment complete',
        source: 'webhook',
      }),
    )

    expect(transcriptStore.append).toHaveBeenCalledWith(
      'sess-1',
      expect.objectContaining({
        role: 'system',
        trustLevel: 'system',
        content: 'deployment complete',
      }),
    )
  })

  it('should log cron systemEvent with automation trust', async () => {
    const runner = makeRunner('automation')
    runtime.registerRunner(runner)

    await runtime.handleRequest(
      makeRequest({
        source: 'cron',
        requestedMode: 'automation',
        systemEvent: 'scheduled trigger',
      }),
    )

    expect(transcriptStore.append).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        role: 'system',
        trustLevel: 'automation',
        content: 'scheduled trigger',
      }),
    )
  })

  it('should log assistant output to transcript', async () => {
    const runner = makeRunner('interactive', { output: 'Here is the result.' })
    runtime.registerRunner(runner)

    await runtime.handleRequest(makeRequest())

    expect(transcriptStore.append).toHaveBeenCalledWith(
      'sess-1',
      expect.objectContaining({
        role: 'assistant',
        trustLevel: 'system',
        content: 'Here is the result.',
      }),
    )
  })

  it('should not log userMessage when undefined', async () => {
    const runner = makeRunner('interactive')
    runtime.registerRunner(runner)

    await runtime.handleRequest(makeRequest({ userMessage: undefined }))

    const appendCalls = (transcriptStore.append as ReturnType<typeof vi.fn>).mock.calls
    const userCalls = appendCalls.filter(
      (args: unknown[]) => (args[1] as { role: string }).role === 'user',
    )
    expect(userCalls).toHaveLength(0)
  })

  // ─── Session touch ──────────────────────────────────────────

  it('should touch session after handling request', async () => {
    const runner = makeRunner('interactive')
    runtime.registerRunner(runner)

    await runtime.handleRequest(makeRequest())

    expect(sessionStore.touch).toHaveBeenCalledWith('sess-1')
  })

  // ─── Execution guard ───────────────────────────────────────

  it('should apply guard for interactive mode with output', async () => {
    const runner = makeRunner('interactive', { output: "I'll fix it now" })
    runtime.registerRunner(runner)

    await runtime.handleRequest(makeRequest())

    expect(guard.validate).toHaveBeenCalledTimes(1)
  })

  it('should block response when guard returns violations', async () => {
    guard = makeGuard({
      validate: vi.fn(
        (): GuardResult => ({
          allowed: false,
          violations: [
            {
              type: 'promise_without_action',
              message: 'Promised but did nothing',
              timestamp: Date.now(),
              resolution: 'blocked',
            },
          ],
          suggestedAction: 'require_tool_call',
        }),
      ),
    })
    runtime = new Runtime(sessionStore, runStore, taskStore, transcriptStore, guard)

    const runner = makeRunner('interactive', { output: "I'll do it now" })
    runtime.registerRunner(runner)

    await runtime.handleRequest(makeRequest())

    // Guard violation should be appended to run store
    expect(runStore.appendGuardViolation).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ type: 'promise_without_action' }),
    )

    // Run should be marked as blocked
    expect(runStore.update).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'blocked' }),
    )

    // Guard violation should be logged to transcript
    expect(transcriptStore.append).toHaveBeenCalledWith(
      'sess-1',
      expect.objectContaining({
        role: 'system',
        trustLevel: 'system',
        content: expect.objectContaining({ type: 'guard_violation' }),
      }),
    )
  })

  it('should not apply guard for automation mode', async () => {
    const runner = makeRunner('automation', { output: "I'll run the workflow" })
    runtime.registerRunner(runner)

    await runtime.handleRequest(makeRequest({ requestedMode: 'automation' }))

    expect(guard.validate).not.toHaveBeenCalled()
  })

  it('should not apply guard for background mode', async () => {
    const runner = makeRunner('background', { output: 'Task started' })
    runtime.registerRunner(runner)

    await runtime.handleRequest(makeRequest({ requestedMode: 'background' }))

    expect(guard.validate).not.toHaveBeenCalled()
  })

  it('should not apply guard when runner produces no output', async () => {
    const runner = makeRunner('interactive', { output: undefined })
    runtime.registerRunner(runner)

    await runtime.handleRequest(makeRequest())

    expect(guard.validate).not.toHaveBeenCalled()
  })

  it('should load task for guard validation when taskId is present', async () => {
    const taskState = {
      taskId: 'task-42',
      origin: 'user' as const,
      status: 'running' as const,
      title: 'Fix bug',
      objective: 'Fix the login bug',
      executionRequired: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    taskStore = makeTaskStore({
      load: vi.fn(async () => taskState),
    })
    runtime = new Runtime(sessionStore, runStore, taskStore, transcriptStore, guard)

    const runRecord: RunRecord = {
      runId: 'run-1',
      sessionId: 'sess-1',
      source: 'chat',
      startedAt: Date.now(),
      status: 'completed',
      taskId: 'task-42',
      toolCalls: [],
      guardViolations: [],
    }
    const runner = makeRunner('interactive', { runRecord, output: 'Done.' })
    runtime.registerRunner(runner)

    await runtime.handleRequest(makeRequest())

    expect(taskStore.load).toHaveBeenCalledWith('task-42')
    expect(guard.validate).toHaveBeenCalledWith(expect.objectContaining({ task: taskState }))
  })

  // ─── Store failure resilience ─────────────────────────────

  it('should continue when sessionStore.load throws', async () => {
    sessionStore = makeSessionStore({
      load: vi.fn(async () => {
        throw new Error('DB down')
      }),
      create: vi.fn(async () => {
        throw new Error('DB down')
      }),
    })
    runtime = new Runtime(sessionStore, runStore, taskStore, transcriptStore, guard)

    const runner = makeRunner('interactive')
    runtime.registerRunner(runner)

    // Should not throw — falls back to inline session
    const result = await runtime.handleRequest(makeRequest())
    expect(result).toBeDefined()
    expect(runner.execute).toHaveBeenCalledTimes(1)
  })

  it('should continue when transcriptStore.append throws', async () => {
    transcriptStore = makeTranscriptStore({
      append: vi.fn(async () => {
        throw new Error('Write failed')
      }),
    })
    runtime = new Runtime(sessionStore, runStore, taskStore, transcriptStore, guard)

    const runner = makeRunner('interactive')
    runtime.registerRunner(runner)

    // Should not throw
    const result = await runtime.handleRequest(makeRequest({ userMessage: 'hello' }))
    expect(result).toBeDefined()
  })

  it('should continue when sessionStore.touch throws', async () => {
    sessionStore = makeSessionStore({
      touch: vi.fn(async () => {
        throw new Error('Touch failed')
      }),
    })
    runtime = new Runtime(sessionStore, runStore, taskStore, transcriptStore, guard)

    const runner = makeRunner('interactive')
    runtime.registerRunner(runner)

    const result = await runtime.handleRequest(makeRequest())
    expect(result).toBeDefined()
  })

  // ─── Return value ─────────────────────────────────────────

  it('should return the runner result', async () => {
    const expected: RunnerResult = {
      runRecord: {
        runId: 'run-42',
        sessionId: 'sess-1',
        source: 'chat',
        startedAt: Date.now(),
        status: 'completed',
        toolCalls: [],
        guardViolations: [],
      },
      output: 'All done.',
    }
    const runner = makeRunner('interactive', expected)
    runtime.registerRunner(runner)

    const result = await runtime.handleRequest(makeRequest())
    expect(result.runRecord.runId).toBe('run-42')
    expect(result.output).toBe('All done.')
  })

  it('should pass session to runner.execute', async () => {
    const existing = makeSession()
    sessionStore = makeSessionStore({
      load: vi.fn(async () => existing),
    })
    runtime = new Runtime(sessionStore, runStore, taskStore, transcriptStore, guard)

    const runner = makeRunner('interactive')
    runtime.registerRunner(runner)

    await runtime.handleRequest(makeRequest())

    expect(runner.execute).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ sessionId: 'sess-1' }),
    )
  })
})
