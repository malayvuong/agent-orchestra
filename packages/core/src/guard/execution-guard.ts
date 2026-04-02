/**
 * Execution Guard (Phase 2).
 *
 * Runtime-level validation that sits between model output and response delivery.
 * Catches "model said it would do X but didn't do X in this turn."
 *
 * This is a RESPONSE FILTER, not an execution preventer:
 * - It does NOT prevent the model from starting tool calls.
 * - It blocks responses that contain promises but zero evidence of action.
 * - If the model made tool calls and also promised more, the guard sees the
 *   tool calls as evidence and allows the response.
 */

import type { TaskState, ToolCallRecord, GuardViolation } from '../types/runtime.js'
import type { Evidence } from './evidence-collector.js'

// ─── Types ─────────────────────────────────────────────────────────

export type TurnOutput = {
  text: string
  toolCalls: ToolCallRecord[]
  task?: TaskState
  evidence?: Evidence[]
}

export type GuardResult = {
  allowed: boolean
  violations: GuardViolation[]
  suggestedAction?: 'force_replan' | 'require_tool_call' | 'require_blocker' | 'pass'
}

export type GuardConfig = {
  /** Master switch. When false, guard always allows. */
  enabled: boolean
  /** Regex patterns that detect promise-style language. */
  promisePatterns: RegExp[]
  /** Require evidence (tool output) before allowing reply on actionable tasks. */
  evidenceRequired: boolean
  /** How many promise-without-action turns before hard block. */
  maxPromiseWithoutAction: number
  /** Task types that don't require action (guard skips these). */
  allowedExceptions: string[]
}

export const DEFAULT_GUARD_CONFIG: GuardConfig = {
  enabled: true,
  promisePatterns: [
    /I[''']ll do it/i,
    /I[''']ll .+ now/i,
    /Let me .+ right away/i,
    /I[''']m going to/i,
    /I will .+ immediately/i,
    /con làm/i,
    /con kiểm tra/i,
    /con sẽ/i,
    /để con/i,
  ],
  evidenceRequired: true,
  maxPromiseWithoutAction: 1,
  allowedExceptions: ['question', 'explanation', 'clarification'],
}

// ─── Guard ─────────────────────────────────────────────────────────

export class ExecutionGuard {
  private config: GuardConfig

  constructor(config?: Partial<GuardConfig>) {
    this.config = { ...DEFAULT_GUARD_CONFIG, ...config }
  }

  /**
   * Validate a turn output against execution guard rules.
   *
   * Returns allowed: true if the response can be delivered.
   * Returns allowed: false with violations if the response should be blocked.
   */
  validate(turn: TurnOutput): GuardResult {
    if (!this.config.enabled) {
      return { allowed: true, violations: [], suggestedAction: 'pass' }
    }

    // Skip guard for non-actionable tasks
    if (turn.task && !turn.task.executionRequired) {
      return { allowed: true, violations: [], suggestedAction: 'pass' }
    }

    // No task attached — can't determine actionability, allow
    if (!turn.task) {
      return { allowed: true, violations: [], suggestedAction: 'pass' }
    }

    const violations: GuardViolation[] = []

    // Rule 1: Task is actionable but no tool calls in this turn
    if (turn.task.executionRequired && turn.toolCalls.length === 0) {
      const hasPromise = this.detectPromise(turn.text)

      if (hasPromise) {
        violations.push({
          type: 'promise_without_action',
          message: 'Model promised action but no tool was called in this turn',
          timestamp: Date.now(),
          resolution: 'blocked',
        })
      }

      // Evidence-first: reply without evidence on actionable task
      if (this.config.evidenceRequired && !this.hasEvidence(turn)) {
        violations.push({
          type: 'no_evidence',
          message: 'Actionable task reply has no evidence (tool output, file read, command result)',
          timestamp: Date.now(),
          resolution: 'blocked',
        })
      }
    }

    // Rule 2: Task is running but has no recorded action at all
    if (turn.task.status === 'running' && !turn.task.lastActionAt) {
      violations.push({
        type: 'task_abandoned',
        message: 'Task is marked running but has no recorded action',
        timestamp: Date.now(),
        resolution: 'forced_replan',
      })
    }

    const allowed = violations.length === 0
    const suggestedAction = this.decideSuggestedAction(violations)

    return { allowed, violations, suggestedAction }
  }

  /** Check if text contains promise-style language. */
  private detectPromise(text: string): boolean {
    return this.config.promisePatterns.some((p) => p.test(text))
  }

  /** Check if turn has any form of evidence. */
  private hasEvidence(turn: TurnOutput): boolean {
    if (turn.toolCalls.length > 0) return true
    if (turn.evidence && turn.evidence.length > 0) return true
    if (turn.task?.lastEvidence) return true
    return false
  }

  private decideSuggestedAction(violations: GuardViolation[]): GuardResult['suggestedAction'] {
    if (violations.length === 0) return 'pass'
    if (violations.some((v) => v.type === 'promise_without_action')) return 'require_tool_call'
    if (violations.some((v) => v.type === 'no_evidence')) return 'require_blocker'
    if (violations.some((v) => v.type === 'task_abandoned')) return 'force_replan'
    return 'force_replan'
  }
}
