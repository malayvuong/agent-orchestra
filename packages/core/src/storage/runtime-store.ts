/**
 * Store interfaces for runtime persistence.
 *
 * Phase 1A: RunStore, TaskStore
 * Phase 1B: SessionStore, TranscriptStore
 *
 * These are independent of the debate-specific JobStore and RoundStore.
 */

import type {
  RunRecord,
  ToolCallRecord,
  GuardViolation,
  TaskState,
  TaskStatus,
  SessionState,
  TranscriptEntry,
} from '../types/runtime.js'

export interface RunStore {
  /** Create a new run. toolCalls and guardViolations are initialized as empty arrays. */
  create(run: Omit<RunRecord, 'toolCalls' | 'guardViolations'>): Promise<RunRecord>

  /** Load a run by ID. Returns undefined if not found. */
  load(runId: string): Promise<RunRecord | undefined>

  /** Update run fields. Only provided fields are overwritten. */
  update(runId: string, patch: Partial<RunRecord>): Promise<RunRecord>

  /** List all runs for a session. */
  listBySession(sessionId: string): Promise<RunRecord[]>

  /** List all runs for a task. */
  listByTask(taskId: string): Promise<RunRecord[]>

  /** Append a tool call record to an existing run. */
  appendToolCall(runId: string, toolCall: ToolCallRecord): Promise<void>

  /** Append a guard violation to an existing run. */
  appendGuardViolation(runId: string, violation: GuardViolation): Promise<void>
}

export interface TaskStore {
  /** Create a new task with generated ID and timestamps. */
  create(task: Omit<TaskState, 'taskId' | 'createdAt' | 'updatedAt'>): Promise<TaskState>

  /** Load a task by ID. Returns undefined if not found. */
  load(taskId: string): Promise<TaskState | undefined>

  /** Update task fields. Only provided fields are overwritten. updatedAt is auto-set. */
  update(taskId: string, patch: Partial<TaskState>): Promise<TaskState>

  /** List all tasks for a session. */
  listBySession(sessionId: string): Promise<TaskState[]>

  /** List all tasks with a given status. */
  listByStatus(status: TaskStatus): Promise<TaskState[]>
}

// ─── Phase 1B ──────────────────────────────────────────────────────

export interface SessionStore {
  /** Create a new session with auto-set timestamps. */
  create(session: Omit<SessionState, 'createdAt' | 'lastActivityAt'>): Promise<SessionState>

  /** Load a session by ID. Returns undefined if not found. */
  load(sessionId: string): Promise<SessionState | undefined>

  /** Update session fields. Only provided fields are overwritten. */
  update(sessionId: string, patch: Partial<SessionState>): Promise<SessionState>

  /** List all sessions. */
  list(): Promise<SessionState[]>

  /** Update lastActivityAt to now. */
  touch(sessionId: string): Promise<void>
}

export interface TranscriptStore {
  /** Append an entry to a session's transcript. Returns the entry with generated ID. */
  append(sessionId: string, entry: Omit<TranscriptEntry, 'id'>): Promise<TranscriptEntry>

  /** Load transcript entries for a session with optional filters. */
  loadBySession(
    sessionId: string,
    options?: { limit?: number; afterTimestamp?: number },
  ): Promise<TranscriptEntry[]>

  /** Load transcript entries for a specific run. */
  loadByRun(runId: string): Promise<TranscriptEntry[]>
}
