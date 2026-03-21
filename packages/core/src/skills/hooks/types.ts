/**
 * Types for the plugin lifecycle hook system (Phase F — Task 4.2).
 *
 * Hooks allow plugin-type skills to execute at defined points in the
 * protocol pipeline: before/after rounds and before/after synthesis.
 */

import type { SkillArtifact } from '../executor/types.js'

// ---------------------------------------------------------------------------
// Lifecycle Points
// ---------------------------------------------------------------------------

/**
 * Lifecycle points where plugin hooks can fire.
 *
 * - `pre_round`      — Before ContextBuilder runs; prepare data, run preprocessors
 * - `post_round`     — After OutputNormalizer, before ScopeGuard; post-process findings
 * - `pre_synthesis`  — Before SynthesisEngine runs; inject additional analysis
 * - `post_synthesis` — After synthesis complete; generate reports, notifications
 */
export type LifecyclePoint = 'pre_round' | 'post_round' | 'pre_synthesis' | 'post_synthesis'

// ---------------------------------------------------------------------------
// Hook Context
// ---------------------------------------------------------------------------

/**
 * Context passed to plugin hooks at execution time.
 *
 * Contains the job/round/agent identifiers plus any output data
 * available at the current lifecycle point.
 */
export type HookContext = {
  /** The orchestration job ID */
  jobId: string
  /** Current round index (0-based) */
  roundIndex: number
  /** The agent ID for the current round */
  agentId: string
  /** Absolute path to the workspace directory */
  workspacePath: string
  /** Available for post_round and later hooks — the agent's round output */
  roundOutput?: Record<string, unknown>
  /** Available for post_synthesis hooks — the synthesis result */
  synthesisOutput?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Hook Result
// ---------------------------------------------------------------------------

/**
 * Result of executing a single plugin hook.
 *
 * Contains the skill ID, execution status, collected artifacts,
 * timing information, and any error message on failure.
 */
export type HookResult = {
  /** The skill ID that produced this result */
  skillId: string
  /** Whether the hook executed successfully */
  success: boolean
  /** Artifacts produced by the hook (findings, reports, metrics) */
  artifacts: SkillArtifact[]
  /** Wall-clock execution time in milliseconds */
  durationMs: number
  /** Error message if the hook failed */
  error?: string
}
