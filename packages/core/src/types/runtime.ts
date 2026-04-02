/**
 * Runtime types for general-purpose agent execution.
 *
 * These types are independent of the debate protocol (Job/Round/Finding).
 * They provide the foundation for sessions, runs, tasks, and transcripts
 * needed by the execution guard, automation runner, and general runtime.
 *
 * Phase 1A: RunRecord, ToolCallRecord, TaskState, GuardViolation
 * Phase 1B: SessionState, TranscriptEntry
 */

// ─── RunRecord ─────────────────────────────────────────────────────

export type RunSource = 'chat' | 'cron' | 'webhook' | 'system' | 'subagent'
export type RunStatus = 'running' | 'completed' | 'blocked' | 'failed' | 'cancelled'

export type RunRecord = {
  runId: string
  sessionId?: string // optional in Phase 1A (no SessionStore yet); required after Phase 1B
  taskId?: string
  jobId?: string // link to existing Job if applicable
  source: RunSource
  startedAt: number
  endedAt?: number
  status: RunStatus
  model?: string
  toolCalls: ToolCallRecord[]
  finalReply?: string
  failureReason?: string
  guardViolations: GuardViolation[]
}

export type ToolCallRecord = {
  id: string
  name: string
  startedAt: number
  endedAt?: number
  status: 'ok' | 'error' | 'timeout' | 'denied'
  summary?: string
  durationMs?: number
}

export type GuardViolation = {
  type: 'promise_without_action' | 'no_evidence' | 'task_abandoned'
  message: string
  timestamp: number
  resolution: 'blocked' | 'forced_replan' | 'user_override'
}

// ─── TaskState ─────────────────────────────────────────────────────

export type TaskOrigin = 'user' | 'cron' | 'system' | 'subagent'
export type TaskStatus = 'queued' | 'running' | 'blocked' | 'waiting' | 'done' | 'failed'

export type TaskState = {
  taskId: string
  sessionId?: string
  runId?: string
  origin: TaskOrigin
  status: TaskStatus
  title: string
  objective: string
  executionRequired: boolean
  lastActionAt?: number
  lastEvidence?: string
  blocker?: string
  resumeHint?: string
  createdAt: number
  updatedAt: number
}

// ─── SessionState (Phase 1B) ───────────────────────────────────────

export type SessionType = 'interactive' | 'cron' | 'subagent' | 'background'

export type SessionState = {
  sessionId: string
  sessionType: SessionType
  owner: string
  channel?: string // 'cli' | 'api' | 'webhook'
  activeRunId?: string
  activeTaskId?: string
  modelConfig?: {
    provider: string
    model: string
  }
  policyContext?: string // policy set name
  createdAt: number
  lastActivityAt: number
}

// ─── TranscriptEntry (Phase 1B) ────────────────────────────────────

export type TrustLevel = 'system' | 'trusted_meta' | 'user_input' | 'external' | 'automation'

export type TranscriptEntry = {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  timestamp: number
  runId?: string
  taskId?: string
  toolName?: string
  trustLevel: TrustLevel
  content: string | Record<string, unknown>
}

// ─── RunRequest (entrypoint output) ────────────────────────────────

export type RunMode = 'interactive' | 'automation' | 'background' | 'verification'

export type RunRequest = {
  source: RunSource
  sessionId: string
  actorId: string
  trustedMeta: Record<string, unknown>
  userMessage?: string
  systemEvent?: string
  attachments?: Array<{ name: string; content: string; type: string }>
  requestedMode: RunMode
}
