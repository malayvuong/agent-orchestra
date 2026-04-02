import { describe, it, expect } from 'vitest'
import { ExecutionGuard } from '../execution-guard.js'
import type { TurnOutput } from '../execution-guard.js'
import type { TaskState, ToolCallRecord } from '../../types/runtime.js'

describe('ExecutionGuard', () => {
  const guard = new ExecutionGuard()

  const makeTask = (overrides?: Partial<TaskState>): TaskState => ({
    taskId: 'task-1',
    origin: 'user',
    status: 'queued',
    title: 'Test',
    objective: 'Test objective',
    executionRequired: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  })

  const makeToolCall = (overrides?: Partial<ToolCallRecord>): ToolCallRecord => ({
    id: 'tc-1',
    name: 'bash',
    startedAt: Date.now(),
    status: 'ok',
    summary: 'Ran command',
    ...overrides,
  })

  // ─── Promise detection ─────────────────────────────────────────

  it('should block promise-without-action on actionable task', () => {
    const turn: TurnOutput = {
      text: "I'll do it now — updating the config file.",
      toolCalls: [],
      task: makeTask({ executionRequired: true }),
    }
    const result = guard.validate(turn)

    expect(result.allowed).toBe(false)
    expect(result.violations.length).toBeGreaterThan(0)
    expect(result.violations.some((v) => v.type === 'promise_without_action')).toBe(true)
    expect(result.suggestedAction).toBe('require_tool_call')
  })

  it('should allow promise with tool calls present', () => {
    const turn: TurnOutput = {
      text: "I'll fix this by editing the file.",
      toolCalls: [makeToolCall()],
      task: makeTask({ executionRequired: true }),
    }
    const result = guard.validate(turn)
    expect(result.allowed).toBe(true)
  })

  it('should detect Vietnamese promise patterns', () => {
    const patterns = ['con làm ngay', 'con kiểm tra file', 'con sẽ sửa', 'để con xem']
    for (const text of patterns) {
      const turn: TurnOutput = {
        text,
        toolCalls: [],
        task: makeTask({ executionRequired: true }),
      }
      const result = guard.validate(turn)
      expect(result.allowed).toBe(false)
      expect(result.violations.some((v) => v.type === 'promise_without_action')).toBe(true)
    }
  })

  it('should detect English promise patterns', () => {
    const patterns = [
      "I'll do it",
      "I'll fix that now",
      'Let me update that right away',
      "I'm going to deploy",
      'I will restart immediately',
    ]
    for (const text of patterns) {
      const turn: TurnOutput = {
        text,
        toolCalls: [],
        task: makeTask({ executionRequired: true }),
      }
      const result = guard.validate(turn)
      expect(result.allowed).toBe(false)
    }
  })

  // ─── Evidence-first ────────────────────────────────────────────

  it('should block actionable task reply with no evidence', () => {
    const turn: TurnOutput = {
      text: 'The file has been updated successfully.',
      toolCalls: [],
      task: makeTask({ executionRequired: true }),
    }
    const result = guard.validate(turn)
    expect(result.allowed).toBe(false)
    expect(result.violations.some((v) => v.type === 'no_evidence')).toBe(true)
  })

  it('should allow when evidence array is provided', () => {
    const turn: TurnOutput = {
      text: 'Done.',
      toolCalls: [],
      task: makeTask({ executionRequired: true }),
      evidence: [{ type: 'file_read', summary: 'Read config.json' }],
    }
    const result = guard.validate(turn)
    expect(result.allowed).toBe(true)
  })

  it('should allow when task has lastEvidence from prior action', () => {
    const turn: TurnOutput = {
      text: 'The change is applied.',
      toolCalls: [],
      task: makeTask({
        executionRequired: true,
        lastEvidence: 'Wrote 3 files',
      }),
    }
    const result = guard.validate(turn)
    expect(result.allowed).toBe(true)
  })

  // ─── Non-actionable tasks ──────────────────────────────────────

  it('should always allow non-actionable tasks', () => {
    const turn: TurnOutput = {
      text: "I'll explain how this works.",
      toolCalls: [],
      task: makeTask({ executionRequired: false }),
    }
    const result = guard.validate(turn)
    expect(result.allowed).toBe(true)
  })

  it('should allow when no task is attached', () => {
    const turn: TurnOutput = {
      text: "I'll do it now!",
      toolCalls: [],
    }
    const result = guard.validate(turn)
    expect(result.allowed).toBe(true)
  })

  // ─── Task abandoned ────────────────────────────────────────────

  it('should detect abandoned task (running but no lastActionAt)', () => {
    const turn: TurnOutput = {
      text: 'Working on it...',
      toolCalls: [makeToolCall()],
      task: makeTask({
        executionRequired: true,
        status: 'running',
        lastActionAt: undefined,
      }),
    }
    const result = guard.validate(turn)
    expect(result.allowed).toBe(false)
    expect(result.violations.some((v) => v.type === 'task_abandoned')).toBe(true)
    expect(result.suggestedAction).toBe('force_replan')
  })

  it('should allow running task with lastActionAt', () => {
    const turn: TurnOutput = {
      text: 'Still working.',
      toolCalls: [makeToolCall()],
      task: makeTask({
        executionRequired: true,
        status: 'running',
        lastActionAt: Date.now(),
      }),
    }
    const result = guard.validate(turn)
    expect(result.allowed).toBe(true)
  })

  // ─── Config ────────────────────────────────────────────────────

  it('should allow everything when guard is disabled', () => {
    const disabledGuard = new ExecutionGuard({ enabled: false })
    const turn: TurnOutput = {
      text: "I'll do it now!",
      toolCalls: [],
      task: makeTask({ executionRequired: true }),
    }
    const result = disabledGuard.validate(turn)
    expect(result.allowed).toBe(true)
    expect(result.violations).toEqual([])
  })

  it('should support custom promise patterns', () => {
    const custom = new ExecutionGuard({
      promisePatterns: [/gonna do it/i],
    })
    const turn: TurnOutput = {
      text: 'gonna do it right now',
      toolCalls: [],
      task: makeTask({ executionRequired: true }),
    }
    const result = custom.validate(turn)
    expect(result.violations.some((v) => v.type === 'promise_without_action')).toBe(true)
  })

  it('should not trigger promise detection on non-matching text', () => {
    const turn: TurnOutput = {
      text: 'Here is the answer to your question.',
      toolCalls: [],
      task: makeTask({ executionRequired: true }),
    }
    const result = guard.validate(turn)
    // no_evidence will still fire, but promise_without_action should not
    expect(result.violations.some((v) => v.type === 'promise_without_action')).toBe(false)
  })

  it('should allow evidence-first to be disabled', () => {
    const relaxed = new ExecutionGuard({ evidenceRequired: false })
    const turn: TurnOutput = {
      text: 'The file has been updated.',
      toolCalls: [],
      task: makeTask({ executionRequired: true }),
    }
    const result = relaxed.validate(turn)
    // No promise language, evidence not required → allowed
    expect(result.allowed).toBe(true)
  })
})
