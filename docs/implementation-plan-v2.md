# agent-orchestra Implementation Plan v2

> **From debate engine to general-purpose agent runtime**
>
> Based on 10 design principles review + architecture draft v1.
> Date: 2026-04-01

---

## Executive Summary
## Review Notes (practical)

### Overall assessment
This plan is strong and worth keeping as the main implementation direction.
It correctly identifies the 3 biggest gaps between the current debate engine and a general-purpose agent runtime:
- runtime execution guard
- isolated automation runner
- session + run visibility/resumability

### What is especially good
- phase breakdown is logical and mostly additive
- backward compatibility is treated seriously
- execution guard is placed at runtime, not only in prompts
- isolated automation is recognized as a separate execution lane
- observability is treated as a core requirement, not a nice-to-have

### Main concerns to address during implementation
1. **Phase 1 may be too large**
   - Consider splitting into:
     - Phase 1A: RunRecord + TaskState + stores needed for guard
     - Phase 1B: SessionState + TranscriptStore + richer trust model
   - This makes it easier to ship user-visible value earlier.

2. **Execution guard should not rely too heavily on regex promise detection**
   - Keep regex as MVP, but make task semantics primary.
   - Add explicit task-level concepts such as:
     - `executionRequired`
     - `allowedResponseModes`
   - Otherwise the system may overfit to phrasing instead of actual task type.

3. **BackgroundRunner is currently too thin for MVP expectations**
   - Either implement a real minimal background worker/supervised run path,
   - or clearly mark BackgroundRunner as a later sub-phase after AutomationRunner.

4. **Definition of evidence should be made explicit**
   - Clarify what counts as evidence:
     - tool output
     - file read result
     - command result
     - spawned run id
     - persisted artifact
   - This will reduce ambiguity in execution guard behavior.

5. **Resumption policy needs clearer rules**
   - When does runtime auto-resume?
   - What interrupts are resumable?
   - How are abandoned tasks detected beyond `lastActionAt`?

### Suggested implementation priority
If implementation speed matters, prioritize in this order:
1. RunRecord + ToolCallRecord + TaskState
2. Execution Guard
3. AutomationRunner
4. Runtime wrapper / intent routing
5. Role specialization + observability polish

### Keep unchanged
- keep existing debate flow as one protocol inside the future runtime
- keep the plan additive and backward-compatible
- keep observability as a first-class requirement

---


agent-orchestra hiện tại là một **code review debate engine** hoạt động tốt (architect vs reviewer, single-challenger protocol). Nhưng nó thiếu 3 thứ quan trọng để trở thành **general-purpose agent runtime**:

1. **Runtime execution guard** — chặn model "hứa mà không làm"
2. **Isolated automation runner** — cron/background không phụ thuộc chat session
3. **Session + RunRecord** — visibility và resumability

Plan này tổ chức thành **5 phases**, mỗi phase có thể ship độc lập.

---

## Table of Contents

- [Phase 1: Runtime Foundation](#phase-1-runtime-foundation) — Session, RunRecord, TaskState
- [Phase 2: Execution Guard](#phase-2-execution-guard) — Evidence-first validation
- [Phase 3: Isolated Automation](#phase-3-isolated-automation) — Background/cron runner
- [Phase 4: General Runtime Layer](#phase-4-general-runtime-layer) — Intent routing, workflow graph
- [Phase 5: Role Specialization + Observability](#phase-5-role-specialization--observability) — Agent roles, structured logging

---

## Dependency Graph

```
Phase 1 (Foundation)
  └── Phase 2 (Execution Guard) — depends on RunRecord + TaskState
  └── Phase 3 (Isolated Automation) — depends on Session + RunRecord
        └── Phase 4 (General Runtime) — depends on Phase 2 + 3
              └── Phase 5 (Roles + Observability) — depends on Phase 4
```

---

## Phase 1: Runtime Foundation

**Goal**: Thêm Session, RunRecord, TaskState — 3 building blocks cho mọi thứ phía sau.

> **Implementation note:** Consider shipping this in two substeps if velocity becomes a concern:
> - **Phase 1A**: `RunRecord`, `ToolCallRecord`, `TaskState`, `RunStore`, `TaskStore`
> - **Phase 1B**: `SessionState`, `TranscriptStore`, trust-level transcript model

**Principles addressed**: #2 (Session first-class), #10 (Observability), #5 (Trust boundary)

### 1.1 New types

**File**: `packages/core/src/types/runtime.ts`

```ts
// ─── Session ───────────────────────────────────────────────────────

export type SessionType = 'interactive' | 'cron' | 'subagent' | 'background'

export type SessionState = {
  sessionId: string
  sessionType: SessionType
  owner: string
  channel?: string            // 'cli' | 'api' | 'webhook'
  activeRunId?: string
  activeTaskId?: string
  modelConfig?: {
    provider: string
    model: string
  }
  policyContext?: string      // policy set name
  createdAt: number
  lastActivityAt: number
}

// ─── RunRecord ─────────────────────────────────────────────────────

export type RunSource = 'chat' | 'cron' | 'webhook' | 'system' | 'subagent'
export type RunStatus = 'running' | 'completed' | 'blocked' | 'failed' | 'cancelled'

export type RunRecord = {
  runId: string
  sessionId?: string           // optional in Phase 1A (no SessionStore yet); required after Phase 1B
  taskId?: string
  jobId?: string              // link to existing Job if applicable
  source: RunSource
  startedAt: number
  endedAt?: number
  status: RunStatus
  model?: string
  toolCalls: ToolCallRecord[]
  finalReply?: string
  failureReason?: string
  guardViolations: GuardViolation[]  // Phase 2 will populate this
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
  sessionId: string        // In Phase 1A this may be a caller-provided raw session key, even before SessionStore is fully introduced
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

// ─── TranscriptEntry ───────────────────────────────────────────────

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
```

**Rationale**: Tất cả type mới nằm trong 1 file. Không break existing types. `Job`, `Round`, `AgentContext` etc. vẫn giữ nguyên cho debate flows.

### 1.2 Store interfaces

**File**: `packages/core/src/storage/runtime-store.ts`

```ts
import type { SessionState, RunRecord, TaskState, TranscriptEntry } from '../types/runtime.js'

export interface SessionStore {
  create(session: Omit<SessionState, 'createdAt' | 'lastActivityAt'>): Promise<SessionState>
  load(sessionId: string): Promise<SessionState | undefined>
  update(sessionId: string, patch: Partial<SessionState>): Promise<SessionState>
  list(): Promise<SessionState[]>
  touch(sessionId: string): Promise<void>  // update lastActivityAt
}

export interface RunStore {
  create(run: Omit<RunRecord, 'toolCalls' | 'guardViolations'>): Promise<RunRecord>
  load(runId: string): Promise<RunRecord | undefined>
  update(runId: string, patch: Partial<RunRecord>): Promise<RunRecord>
  listBySession(sessionId: string): Promise<RunRecord[]>
  listByTask(taskId: string): Promise<RunRecord[]>
  appendToolCall(runId: string, toolCall: ToolCallRecord): Promise<void>
  appendGuardViolation(runId: string, violation: GuardViolation): Promise<void>
}

export interface TaskStore {
  create(task: Omit<TaskState, 'taskId' | 'createdAt' | 'updatedAt'>): Promise<TaskState>
  load(taskId: string): Promise<TaskState | undefined>
  update(taskId: string, patch: Partial<TaskState>): Promise<TaskState>
  listBySession(sessionId: string): Promise<TaskState[]>
  listByStatus(status: TaskState['status']): Promise<TaskState[]>
}

export interface TranscriptStore {
  append(sessionId: string, entry: Omit<TranscriptEntry, 'id'>): Promise<TranscriptEntry>
  loadBySession(sessionId: string, options?: {
    limit?: number
    afterTimestamp?: number
  }): Promise<TranscriptEntry[]>
  loadByRun(runId: string): Promise<TranscriptEntry[]>
}
```

### 1.3 File-based store implementations

**Directory**: `packages/core/src/storage/`

| File | Purpose | Storage layout |
|------|---------|---------------|
| `session-store.ts` | `FileSessionStore` | `.agent-orchestra/sessions/{sessionId}.json` |
| `run-store.ts` | `FileRunStore` | `.agent-orchestra/runs/{runId}.json` |
| `task-store.ts` | `FileTaskStore` | `.agent-orchestra/tasks/{taskId}.json` |
| `transcript-store.ts` | `FileTranscriptStore` | `.agent-orchestra/sessions/{sessionId}/transcript.jsonl` |

**Implementation pattern**: Same as existing `FileJobStore` and `FileRoundStore` — JSON on disk, UUID generation, timestamp management.

TranscriptStore uses JSONL (append-only) like existing `ToolAuditLogger`.

### 1.4 Export from core

**File**: `packages/core/src/types/index.ts` — add:
```ts
export type { SessionState, RunRecord, TaskState, ... } from './runtime.js'
```

**File**: `packages/core/src/storage/index.ts` — add:
```ts
export { FileSessionStore } from './session-store.js'
export { FileRunStore } from './run-store.js'
export { FileTaskStore } from './task-store.js'
export { FileTranscriptStore } from './transcript-store.js'
```

**File**: `packages/core/src/index.ts` — already re-exports `./storage/index.js`, so these will be available.

### 1.5 Tests

**Directory**: `packages/core/src/storage/__tests__/`

| File | Tests |
|------|-------|
| `session-store.test.ts` | CRUD, touch, list |
| `run-store.test.ts` | CRUD, appendToolCall, appendGuardViolation, listBySession/Task |
| `task-store.test.ts` | CRUD, listBySession, listByStatus |
| `transcript-store.test.ts` | append, loadBySession (limit, afterTimestamp), loadByRun |

### 1.6 Deliverables checklist

- [x] `packages/core/src/types/runtime.ts` — all new types
- [x] `packages/core/src/storage/runtime-store.ts` — store interfaces
- [x] `packages/core/src/storage/session-store.ts` — FileSessionStore
- [x] `packages/core/src/storage/run-store.ts` — FileRunStore
- [x] `packages/core/src/storage/task-store.ts` — FileTaskStore
- [x] `packages/core/src/storage/transcript-store.ts` — FileTranscriptStore
- [x] Update `types/index.ts` and `storage/index.ts` exports
- [x] 4 test files with full coverage
- [x] Zero breaking changes to existing code

### 1.7 Integration with existing code

Existing `JobStore` và `RoundStore` **giữ nguyên**. Chúng phục vụ debate protocol. Các store mới phục vụ general runtime.

Khi Phase 4 tích hợp, một `Job` có thể được link tới `RunRecord` qua `runRecord.jobId`. Nhưng Phase 1 không yêu cầu thay đổi Job/Round types.

---

## Phase 2: Execution Guard

**Goal**: Chặn model "hứa mà không làm" ở runtime level.

**Principles addressed**: #7 (Execution guard at runtime)

**Depends on**: Phase 1 (RunRecord, TaskState, GuardViolation types)

### 2.1 Guard module

**File**: `packages/core/src/guard/execution-guard.ts`

```ts
import type { TaskState, RunRecord, ToolCallRecord, GuardViolation } from '../types/runtime.js'

export type TurnOutput = {
  text: string
  toolCalls: ToolCallRecord[]
  task?: TaskState
  evidence?: Array<{
    type: 'tool_output' | 'file_read' | 'command_result' | 'spawned_run' | 'artifact'
    summary: string
  }>
}

export type GuardResult = {
  allowed: boolean
  violations: GuardViolation[]
  suggestedAction?: 'force_replan' | 'require_tool_call' | 'require_blocker' | 'pass'
}

export type GuardConfig = {
  enabled: boolean
  promisePatterns: RegExp[]            // detect "I'll do it", "con làm ngay"
  evidenceRequired: boolean            // require tool output before reply
  maxPromiseWithoutAction: number      // how many promise-style turns before hard block
  allowedExceptions: string[]          // task types that don't need action (e.g., 'question')
}

export const DEFAULT_GUARD_CONFIG: GuardConfig = {
  enabled: true,
  promisePatterns: [
    /I['']ll do it/i,
    /I['']ll .+ now/i,
    /Let me .+ right away/i,
    /con làm/i,
    /con kiểm tra/i,
    /con sẽ/i,
    /để con/i,
  ],
  evidenceRequired: true,
  maxPromiseWithoutAction: 1,
  allowedExceptions: ['question', 'explanation', 'clarification'],
}
```

### 2.2 Guard implementation

**File**: `packages/core/src/guard/execution-guard.ts` (continued)

```ts
export class ExecutionGuard {
  private config: GuardConfig

  constructor(config?: Partial<GuardConfig>) {
    this.config = { ...DEFAULT_GUARD_CONFIG, ...config }
  }

  validate(turn: TurnOutput): GuardResult {
    if (!this.config.enabled) {
      return { allowed: true, violations: [] }
    }

    const violations: GuardViolation[] = []

    // Rule 1: Task is actionable but no tool calls in this turn
    if (turn.task?.executionRequired && turn.toolCalls.length === 0) {
      // Check if reply contains promise language
      const hasPromise = this.config.promisePatterns.some(p => p.test(turn.text))

      if (hasPromise) {
        violations.push({
          type: 'promise_without_action',
          message: 'Model promised action but no tool was called in this turn',
          timestamp: Date.now(),
          resolution: 'blocked',
        })
      }

      // Check if evidence-first mode requires tool output
      if (this.config.evidenceRequired && !this.hasEvidence(turn)) {
        violations.push({
          type: 'no_evidence',
          message: 'Actionable task reply has no evidence (tool output, file read, command result)',
          timestamp: Date.now(),
          resolution: 'blocked',
        })
      }
    }

    // Rule 2: Task was running but no recent action
    if (turn.task?.status === 'running' && !turn.task.lastActionAt) {
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

  // Check if turn has any form of evidence
  private hasEvidence(turn: TurnOutput): boolean {
    // Has tool calls = has evidence
    if (turn.toolCalls.length > 0) return true

    // Turn has explicit collected evidence
    if (turn.evidence && turn.evidence.length > 0) return true

    // Task has recorded evidence from previous action in same run
    if (turn.task?.lastEvidence) return true

    return false
  }

  private decideSuggestedAction(violations: GuardViolation[]): GuardResult['suggestedAction'] {
    if (violations.length === 0) return 'pass'
    if (violations.some(v => v.type === 'promise_without_action')) return 'require_tool_call'
    if (violations.some(v => v.type === 'no_evidence')) return 'require_blocker'
    if (violations.some(v => v.type === 'task_abandoned')) return 'force_replan'
    return 'force_replan'
  }
}
```

### 2.3 Task classifier (bridge for Phase 2→4)

The execution guard's primary decision depends on `task.executionRequired`, but the full `IntentClassifier` doesn't arrive until Phase 4. To avoid a 2-phase gap, Phase 2 ships a lightweight `TaskClassifier` alongside the guard.

**File**: `packages/core/src/guard/task-classifier.ts`

```ts
export type TaskClassification = {
  executionRequired: boolean
  allowedResponseModes: Array<'action' | 'explanation' | 'question' | 'blocker'>
}

export class TaskClassifier {
  private actionVerbs = /\b(fix|create|deploy|run|update|build|delete|move|rename|install|add|remove|write|edit|send|schedule|stop|start|restart)\b/i
  private questionPatterns = /\b(what is|explain|why|how does|describe|show me|tell me|list)\b/i

  classify(message: string): TaskClassification {
    if (this.questionPatterns.test(message)) {
      return { executionRequired: false, allowedResponseModes: ['explanation', 'question'] }
    }
    if (this.actionVerbs.test(message)) {
      return { executionRequired: true, allowedResponseModes: ['action', 'blocker'] }
    }
    // Default: not actionable (safe fallback)
    return { executionRequired: false, allowedResponseModes: ['explanation', 'action', 'question'] }
  }
}
```

This classifier is intentionally simple (regex-based) and will be superseded by the full `IntentClassifier` in Phase 4. Its only job is to set `executionRequired` so the guard can make the right decision.

### 2.4 Evidence collector helper

The guard validates evidence but something upstream must construct it. To keep the guard self-contained in Phase 2, ship a helper that inspects tool call results and creates evidence entries.

**File**: `packages/core/src/guard/evidence-collector.ts`

```ts
import type { ToolCallRecord } from '../types/runtime.js'

export type Evidence = {
  type: 'tool_output' | 'file_read' | 'command_result' | 'spawned_run' | 'artifact'
  summary: string
}

export function collectEvidence(toolCalls: ToolCallRecord[]): Evidence[] {
  return toolCalls
    .filter(tc => tc.status === 'ok' && tc.summary)
    .map(tc => ({
      type: inferEvidenceType(tc.name),
      summary: tc.summary!,
    }))
}

function inferEvidenceType(toolName: string): Evidence['type'] {
  if (toolName.startsWith('read') || toolName.includes('file_read')) return 'file_read'
  if (toolName.startsWith('exec') || toolName.includes('command') || toolName.includes('bash')) return 'command_result'
  if (toolName.includes('spawn') || toolName.includes('background')) return 'spawned_run'
  return 'tool_output'
}
```

Guard consumers call `collectEvidence(run.toolCalls)` to populate `TurnOutput.evidence` without manual assembly.

### 2.5 Definition of evidence

For Phase 2, runtime should treat the following as valid evidence:
- successful tool call output
- file read result used to answer a request
- command result / exit output
- spawned background run id
- persisted artifact summary

Plain assistant text should not count as evidence for actionable tasks unless the task is explicitly classified as explanation-only or question-only.

### 2.6 Guard integration point

> **Important clarification**: The execution guard is a **response filter**, not an execution preventer. It sits after model output and catches "model said it would do X but didn't do X in this turn." It does NOT prevent the model from starting tool calls. If the model made tool calls and also promised more, the guard sees the tool calls as evidence and allows the response. The guard blocks responses that contain promises but zero actions.

Guard does NOT live inside the model call. It sits **between model output and response delivery**.

**Integration in runtime** (Phase 4 will fully wire this, but the guard module is usable standalone):

```
model generates response
  → parse tool calls
  → ExecutionGuard.validate({ text, toolCalls, task })
  → if blocked:
      → log GuardViolation to RunRecord
      → inject system message: "Your response was blocked because..."
      → re-prompt model with action requirement
  → if allowed:
      → deliver response
```

### 2.7 Guard for existing debate flow

The guard is **not needed** for the existing single-challenger debate protocol because that flow is deterministic (architect analyzes → reviewer reviews → architect rebuts). The model doesn't "promise and not deliver" in a structured debate.

The guard is critical for **interactive/automation runs** where the model has freedom to choose whether to act.

### 2.8 Tests

**File**: `packages/core/src/guard/__tests__/execution-guard.test.ts`

Test cases:
- Promise detected with no tool calls → blocked
- Promise detected with tool calls → allowed
- Actionable task with tool output → allowed
- Non-actionable task (question) → always allowed
- Evidence-first: reply without evidence on actionable task → blocked
- Task abandoned detection
- Config override: disabled guard → always allowed
- Custom promise patterns
- Vietnamese promise patterns
- TaskClassifier: action verbs → executionRequired true
- TaskClassifier: question patterns → executionRequired false
- collectEvidence: maps tool calls to evidence entries

### 2.9 Deliverables checklist

- [x] `packages/core/src/guard/execution-guard.ts` — guard config + implementation
- [x] `packages/core/src/guard/task-classifier.ts` — lightweight task classification (bridges Phase 2→4)
- [x] `packages/core/src/guard/evidence-collector.ts` — collectEvidence helper
- [x] `packages/core/src/guard/index.ts` — exports
- [x] `packages/core/src/guard/__tests__/execution-guard.test.ts`
- [x] `packages/core/src/guard/__tests__/task-classifier.test.ts`
- [x] `packages/core/src/guard/__tests__/evidence-collector.test.ts`
- [x] Update `packages/core/src/index.ts` to export guard module
- [x] Zero breaking changes

---

## Phase 3: Isolated Automation

**Goal**: Cron/background jobs chạy isolated, không phụ thuộc main chat session.

**Principles addressed**: #8 (Isolated automation), #1 (Entrypoint separation)

**Depends on**: Phase 1 (Session, RunRecord, TaskState stores)

### 3.1 Runner interfaces

**File**: `packages/core/src/runner/types.ts`

```ts
import type { RunRequest, RunRecord, RunMode, SessionState } from '../types/runtime.js'

export type RunnerResult = {
  runRecord: RunRecord
  output?: string
  artifacts?: Array<{ name: string; content: string }>
  error?: string
}

export interface Runner {
  readonly mode: RunMode
  execute(request: RunRequest, session: SessionState): Promise<RunnerResult>
  cancel(runId: string): Promise<void>
}

// ─── Automation-specific types ─────────────────────────────────────

export type AutomationJobDefinition = {
  id: string
  name: string
  description?: string
  schedule?: string                  // cron expression, e.g. "0 9 * * 1-5"
  trigger?: 'cron' | 'webhook' | 'watch'
  workflow: WorkflowStep[]
  notify?: NotifyConfig
  enabled: boolean
  createdAt: number
  lastRunAt?: number
  lastRunStatus?: 'ok' | 'failed'
}

export type WorkflowStep = {
  id: string
  type: 'tool_call' | 'model_prompt' | 'script' | 'conditional'
  name: string
  config: Record<string, unknown>
  dependsOn?: string[]               // step ids
  timeoutMs?: number
  retryCount?: number
}

export type NotifyConfig = {
  onSuccess?: NotifyTarget[]
  onFailure?: NotifyTarget[]
  onTimeout?: NotifyTarget[]
}

export type NotifyTarget = {
  type: 'console' | 'file' | 'webhook' | 'telegram'
  destination: string
}
```

### 3.2 Automation runner

**File**: `packages/core/src/runner/automation-runner.ts`

Core responsibilities:
1. Create isolated `RunRecord` — not linked to any chat session
2. Execute `WorkflowStep[]` sequentially (with dependency resolution)
3. Log each step to `RunRecord.toolCalls`
4. On completion: persist result, optionally notify
5. On failure: persist error, optionally notify, mark RunRecord failed

```ts
import type { Runner, RunnerResult, WorkflowStep } from './types.js'
import type { RunRequest, SessionState, RunRecord, ToolCallRecord } from '../types/runtime.js'
import type { RunStore, TaskStore } from '../storage/runtime-store.js'

export class AutomationRunner implements Runner {
  readonly mode = 'automation' as const

  constructor(
    private runStore: RunStore,
    private taskStore: TaskStore,
    private stepExecutors: Map<string, StepExecutor>,
  ) {}

  async execute(request: RunRequest, session: SessionState): Promise<RunnerResult> {
    // 1. Create RunRecord
    const run = await this.runStore.create({
      runId: crypto.randomUUID(),
      sessionId: session.sessionId,
      taskId: request.trustedMeta.taskId as string | undefined,
      source: request.source,
      startedAt: Date.now(),
      status: 'running',
      model: session.modelConfig?.model,
    })

    try {
      // 2. Parse workflow from request
      const workflow = request.trustedMeta.workflow as WorkflowStep[]

      // 3. Execute steps
      const artifacts: Array<{ name: string; content: string }> = []

      for (const step of this.resolveOrder(workflow)) {
        const executor = this.stepExecutors.get(step.type)
        if (!executor) {
          throw new Error(`No executor for step type: ${step.type}`)
        }

        const toolCall: ToolCallRecord = {
          id: crypto.randomUUID(),
          name: `${step.type}:${step.name}`,
          startedAt: Date.now(),
          status: 'ok',
        }

        try {
          const result = await executor.execute(step, { timeout: step.timeoutMs })
          toolCall.endedAt = Date.now()
          toolCall.durationMs = toolCall.endedAt - toolCall.startedAt
          toolCall.summary = result.summary

          if (result.artifact) {
            artifacts.push(result.artifact)
          }
        } catch (err) {
          toolCall.endedAt = Date.now()
          toolCall.durationMs = toolCall.endedAt - toolCall.startedAt
          toolCall.status = 'error'
          toolCall.summary = err instanceof Error ? err.message : String(err)

          // Retry with attempt tracking
          // NOTE: Implementation must track attemptCount per step.
          // The step is retried up to step.retryCount times.
          // After exhausting retries, fail-fast: mark step failed, stop workflow.
          // Partial resume (restart from failed step) is deferred to Phase 4.
          throw err
        }

        await this.runStore.appendToolCall(run.runId, toolCall)
      }

      // 4. Mark complete
      await this.runStore.update(run.runId, {
        status: 'completed',
        endedAt: Date.now(),
      })

      return {
        runRecord: (await this.runStore.load(run.runId))!,
        artifacts,
      }
    } catch (err) {
      // 5. Mark failed
      await this.runStore.update(run.runId, {
        status: 'failed',
        endedAt: Date.now(),
        failureReason: err instanceof Error ? err.message : String(err),
      })

      return {
        runRecord: (await this.runStore.load(run.runId))!,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  async cancel(runId: string): Promise<void> {
    await this.runStore.update(runId, {
      status: 'cancelled',
      endedAt: Date.now(),
    })
  }

  // Topological sort of workflow steps based on dependsOn
  private resolveOrder(steps: WorkflowStep[]): WorkflowStep[] {
    // Simple topological sort implementation
    // Steps without dependsOn come first
    const resolved: WorkflowStep[] = []
    const pending = [...steps]
    const resolvedIds = new Set<string>()

    while (pending.length > 0) {
      const next = pending.findIndex(s =>
        !s.dependsOn || s.dependsOn.every(dep => resolvedIds.has(dep))
      )

      if (next === -1) {
        throw new Error('Circular dependency in workflow steps')
      }

      const step = pending.splice(next, 1)[0]
      resolved.push(step)
      resolvedIds.add(step.id)
    }

    return resolved
  }
}

// Step executor interface — each step type implements this
export interface StepExecutor {
  execute(step: WorkflowStep, options: { timeout?: number }): Promise<{
    summary: string
    artifact?: { name: string; content: string }
  }>
}
```

### 3.3 Background runner — DEFERRED

> **Decision**: BackgroundRunner is removed from Phase 3 scope. The placeholder implementation (create RunRecord, return immediately, no actual background execution) provides no real value and risks being mistaken for working background support.
>
> **When**: BackgroundRunner will be implemented in Phase 4 or later, with real `child_process.fork()` or worker-thread based execution, status polling, and graceful shutdown.
>
> Phase 3 focuses exclusively on `AutomationRunner` + `Scheduler` — deterministic, sequential workflow execution that works reliably.

### 3.4 Scheduler

**File**: `packages/core/src/runner/scheduler.ts`

```ts
import type { AutomationJobDefinition } from './types.js'

export interface SchedulerConfig {
  storageDir: string
  checkIntervalMs?: number  // default 60_000
}

export class Scheduler {
  private jobs: Map<string, AutomationJobDefinition> = new Map()
  private timers: Map<string, NodeJS.Timeout> = new Map()

  constructor(
    private config: SchedulerConfig,
    private runAutomation: (job: AutomationJobDefinition) => Promise<void>,
  ) {}

  register(job: AutomationJobDefinition): void {
    this.jobs.set(job.id, job)
    if (job.enabled && job.schedule) {
      this.scheduleNext(job)
    }
  }

  unregister(jobId: string): void {
    this.jobs.delete(jobId)
    const timer = this.timers.get(jobId)
    if (timer) {
      clearTimeout(timer)
      this.timers.delete(jobId)
    }
  }

  // Parse cron and schedule next execution
  private scheduleNext(job: AutomationJobDefinition): void {
    // Use a lightweight cron parser
    // For MVP, support simple intervals: "every 5m", "every 1h", "every day at 9:00"
    const nextMs = this.calculateNextRunMs(job.schedule!)
    if (nextMs <= 0) return

    const timer = setTimeout(async () => {
      try {
        await this.runAutomation(job)
        job.lastRunAt = Date.now()
        job.lastRunStatus = 'ok'
      } catch {
        job.lastRunStatus = 'failed'
      }
      // Re-schedule
      this.scheduleNext(job)
    }, nextMs)

    this.timers.set(job.id, timer)
  }

  private calculateNextRunMs(schedule: string): number {
    // MVP: simple interval parsing
    // Known limitation: interval drift — execution time is not subtracted from interval.
    // E.g., "every 5m" with 30s execution → actual period is ~5m30s.
    // Fix in later phase: calculate absolute next-run-time instead of fixed delay.
    // Full cron parsing can be added later via a dependency
    const match = schedule.match(/^every\s+(\d+)\s*(m|min|h|hour|d|day)s?$/i)
    if (!match) return 0

    const value = parseInt(match[1])
    const unit = match[2].toLowerCase()

    switch (unit) {
      case 'm': case 'min': return value * 60_000
      case 'h': case 'hour': return value * 3_600_000
      case 'd': case 'day': return value * 86_400_000
      default: return 0
    }
  }

  listJobs(): AutomationJobDefinition[] {
    return [...this.jobs.values()]
  }

  shutdown(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer)
    }
    this.timers.clear()
  }
}
```

### 3.5 Automation job storage

**File**: `packages/core/src/storage/automation-store.ts`

Storage layout: `.agent-orchestra/automation/{jobId}.json`

```ts
export interface AutomationStore {
  save(job: AutomationJobDefinition): Promise<void>
  load(jobId: string): Promise<AutomationJobDefinition | undefined>
  list(): Promise<AutomationJobDefinition[]>
  delete(jobId: string): Promise<void>
}
```

### 3.6 CLI integration

**File**: `apps/cli/src/commands/automation.ts` (new command)

```
ao automation list                    # list registered automation jobs
ao automation add <file>              # register from YAML definition
ao automation run <jobId>             # run immediately (isolated)
ao automation enable/disable <jobId>  # toggle
ao automation logs <jobId>            # show run history
ao automation start                   # start scheduler daemon
ao automation stop                    # stop scheduler daemon
```

### 3.7 Tests

| File | Tests |
|------|-------|
| `runner/__tests__/automation-runner.test.ts` | Execute workflow, step failure, retry, topological sort |
| `runner/__tests__/scheduler.test.ts` | Register/unregister, interval parsing, re-schedule |
| `storage/__tests__/automation-store.test.ts` | CRUD |

### 3.8 Deliverables checklist

- [x] `packages/core/src/runner/types.ts` — runner interfaces, automation types
- [x] `packages/core/src/runner/automation-runner.ts` — isolated workflow execution
- [x] `packages/core/src/runner/scheduler.ts` — cron/interval scheduler
- [x] `packages/core/src/storage/automation-store.ts` — automation job persistence
- [x] `packages/core/src/runner/index.ts` — exports
- [x] `apps/cli/src/commands/automation.ts` — CLI commands
- [x] 3 test files (automation-runner, scheduler, automation-store)
- [x] Zero breaking changes to existing run command
- [x] BackgroundRunner deferred (see 3.3)

---

## Phase 4: General Runtime Layer

**Goal**: Tách runtime thành general-purpose layer. Debate flow trở thành một protocol trong nhiều protocols.

**Principles addressed**: #1 (4-layer separation), #4 (Task graph), #6 (Context builder)

**Depends on**: Phase 1, 2, 3

### 4.1 Runtime class

**File**: `packages/core/src/runtime/runtime.ts`

This is the new heart of the system. It sits above `Orchestrator` (debate) and `AutomationRunner`.

```ts
import type { RunRequest, RunMode, SessionState, RunRecord } from '../types/runtime.js'
import type { Runner, RunnerResult } from '../runner/types.js'
import type { ExecutionGuard, GuardResult } from '../guard/execution-guard.js'
import type { SessionStore, RunStore, TaskStore, TranscriptStore } from '../storage/runtime-store.js'

export class Runtime {
  private runners: Map<RunMode, Runner> = new Map()

  constructor(
    private sessionStore: SessionStore,
    private runStore: RunStore,
    private taskStore: TaskStore,
    private transcriptStore: TranscriptStore,
    private executionGuard: ExecutionGuard,
  ) {}

  registerRunner(runner: Runner): void {
    this.runners.set(runner.mode, runner)
  }

  async handleRequest(request: RunRequest): Promise<RunnerResult> {
    // 1. Get or create session
    let session = await this.sessionStore.load(request.sessionId)
    if (!session) {
      session = await this.sessionStore.create({
        sessionId: request.sessionId,
        sessionType: this.mapSourceToSessionType(request.source),
        owner: request.actorId,
        channel: request.source,
      })
    }

    // 2. Log inbound to transcript
    if (request.userMessage) {
      await this.transcriptStore.append(session.sessionId, {
        role: 'user',
        timestamp: Date.now(),
        trustLevel: 'user_input',
        content: request.userMessage,
      })
    }
    if (request.systemEvent) {
      await this.transcriptStore.append(session.sessionId, {
        role: 'system',
        timestamp: Date.now(),
        trustLevel: request.source === 'cron' ? 'automation' : 'system',
        content: request.systemEvent,
      })
    }

    // 3. Route to appropriate runner
    const runner = this.runners.get(request.requestedMode)
    if (!runner) {
      throw new Error(`No runner registered for mode: ${request.requestedMode}`)
    }

    // 4. Execute
    const result = await runner.execute(request, session)

    // 5. Apply execution guard (for interactive mode)
    if (request.requestedMode === 'interactive' && result.output) {
      const task = result.runRecord.taskId
        ? await this.taskStore.load(result.runRecord.taskId)
        : undefined

      const guardResult = this.executionGuard.validate({
        text: result.output,
        toolCalls: result.runRecord.toolCalls,
        task: task ?? undefined,
      })

      if (!guardResult.allowed) {
        // Log violations
        for (const violation of guardResult.violations) {
          await this.runStore.appendGuardViolation(result.runRecord.runId, violation)
        }

        // Log to transcript
        await this.transcriptStore.append(session.sessionId, {
          role: 'system',
          timestamp: Date.now(),
          trustLevel: 'system',
          content: {
            type: 'guard_violation',
            violations: guardResult.violations,
            suggestedAction: guardResult.suggestedAction,
          },
        })

        // Mark result as blocked
        result.runRecord = await this.runStore.update(result.runRecord.runId, {
          status: 'blocked',
          failureReason: `Execution guard: ${guardResult.violations.map(v => v.type).join(', ')}`,
        })
      }
    }

    // 6. Log output to transcript
    if (result.output) {
      await this.transcriptStore.append(session.sessionId, {
        role: 'assistant',
        timestamp: Date.now(),
        trustLevel: 'system',  // assistant output is trusted
        content: result.output,
      })
    }

    // 7. Touch session
    await this.sessionStore.touch(session.sessionId)

    return result
  }

  private mapSourceToSessionType(source: RunRequest['source']): SessionState['sessionType'] {
    switch (source) {
      case 'cron': return 'cron'
      case 'system': case 'subagent': return 'subagent'
      default: return 'interactive'
    }
  }
}
```

### 4.2 Intent classifier

This classifier should eventually become the main place that decides whether a task is:
- actionable now
- explanation-only
- permission-gated
- background-worthy
- automation-only

That is important because execution guard should depend more on task semantics than wording patterns.

**File**: `packages/core/src/runtime/intent-classifier.ts`

Lightweight intent classification to route requests to the right runner mode.

```ts
export type Intent =
  | 'code_review'        // → debate protocol (existing)
  | 'code_task'          // → interactive runner
  | 'question'           // → interactive runner (no execution required)
  | 'automation_setup'   // → automation runner
  | 'background_task'    // → background runner
  | 'verification'       // → verification runner

export class IntentClassifier {
  classify(request: RunRequest): Intent {
    // Rule-based for MVP
    if (request.source === 'cron') return 'automation_setup'
    if (request.requestedMode === 'background') return 'background_task'
    if (request.requestedMode === 'verification') return 'verification'
    if (request.requestedMode === 'automation') return 'automation_setup'

    // For interactive requests, classify by content
    if (request.userMessage) {
      const msg = request.userMessage.toLowerCase()
      if (msg.includes('review') || msg.includes('check this code')) return 'code_review'
      if (msg.includes('schedule') || msg.includes('every') || msg.includes('cron')) return 'automation_setup'
    }

    return 'code_task'
  }

  // Map intent to RunMode
  intentToMode(intent: Intent): RunMode {
    switch (intent) {
      case 'code_review': return 'interactive'
      case 'code_task': return 'interactive'
      case 'question': return 'interactive'
      case 'automation_setup': return 'automation'
      case 'background_task': return 'background'
      case 'verification': return 'verification'
    }
  }
}
```

### 4.3 Interactive runner (wraps existing debate + general tasks)

**File**: `packages/core/src/runner/interactive-runner.ts`

```ts
export class InteractiveRunner implements Runner {
  readonly mode = 'interactive' as const

  constructor(
    private orchestrator: Orchestrator,      // existing debate orchestrator
    private runStore: RunStore,
    private taskStore: TaskStore,
    private intentClassifier: IntentClassifier,
    private taskClassifier: TaskClassifier,
    private providerResolver: ProviderResolver,
    private contextBuilder: ContextBuilder,
    private toolRegistry?: ToolRegistry,
    private allTools: ToolSpec[] = [],
  ) {}

  // Implementation note:
  // `executeDirectFlow()` assumes the following collaborators exist and are injected:
  // - TaskClassifier
  // - ProviderResolver
  // - ContextBuilder
  // - ToolRegistry or fallback allTools
  // - executeToolCall(...) helper on this runner or a delegated tool executor

  async execute(request: RunRequest, session: SessionState): Promise<RunnerResult> {
    const intent = this.intentClassifier.classify(request)

    if (intent === 'code_review') {
      // Delegate to existing Orchestrator for debate flow
      return this.executeDebateFlow(request, session)
    }

    // For other interactive intents: direct model call with tool access
    return this.executeDirectFlow(request, session)
  }

  private async executeDebateFlow(request: RunRequest, session: SessionState): Promise<RunnerResult> {
    // Bridge: create RunRecord, then delegate to existing Orchestrator
    // The existing orchestrator creates its own Job/Rounds
    // We just wrap it in a RunRecord for observability
    const run = await this.runStore.create({
      runId: crypto.randomUUID(),
      sessionId: session.sessionId,
      source: request.source,
      startedAt: Date.now(),
      status: 'running',
    })

    // ... delegate to orchestrator, capture result, update RunRecord
    return { runRecord: run }
  }

  private async executeDirectFlow(request: RunRequest, session: SessionState): Promise<RunnerResult> {
    // Direct model call flow for general interactive tasks.
    // This is the core of non-debate interactive execution.

    // 1. Create RunRecord
    const run = await this.runStore.create({
      runId: crypto.randomUUID(),
      sessionId: session.sessionId,
      source: request.source,
      startedAt: Date.now(),
      status: 'running',
    })

    // 2. Classify task
    const classification = this.taskClassifier.classify(request.userMessage ?? '')

    // 3. Create or update TaskState
    const task = await this.taskStore.create({
      sessionId: session.sessionId,
      runId: run.runId,
      origin: 'user',
      status: 'running',
      title: request.userMessage?.slice(0, 80) ?? 'Direct task',
      objective: request.userMessage ?? '',
      executionRequired: classification.executionRequired,
    })

    // 4. Resolve provider + tools
    //    - Provider: use session.modelConfig or fall back to default
    //    - Tools: filter by role (no role restriction in direct flow — full tool access)
    //    - Tool list comes from ToolRegistry.listForRole('executor') in Phase 5,
    //      or all registered tools in Phase 4.
    const provider = this.providerResolver.resolve(session.modelConfig)
    const tools = this.toolRegistry?.listForRole('executor') ?? this.allTools

    // 5. Single-turn model call with tool access
    //    - Send: system context + user message + available tools
    //    - Receive: text + tool_calls
    //    - Execute tool calls, collect results
    //    - This is single-turn for MVP. Multi-turn agentic loop is Phase 5+.
    const modelResult = await provider.call({
      messages: [
        { role: 'system', content: this.contextBuilder.buildInteractiveContext(session, task) },
        { role: 'user', content: request.userMessage },
      ],
      tools,
    })

    // 6. Execute any tool calls returned by model
    const toolCallRecords: ToolCallRecord[] = []
    for (const tc of modelResult.toolCalls ?? []) {
      const record = await this.executeToolCall(tc, run.runId)
      toolCallRecords.push(record)
      await this.runStore.appendToolCall(run.runId, record)
    }

    // 7. Update task with evidence
    const evidence = collectEvidence(toolCallRecords)
    if (evidence.length > 0) {
      await this.taskStore.update(task.taskId, {
        lastActionAt: Date.now(),
        lastEvidence: evidence[0].summary,
      })
    }

    // 8. Complete run
    await this.runStore.update(run.runId, {
      status: 'completed',
      endedAt: Date.now(),
      finalReply: modelResult.text,
    })

    return {
      runRecord: (await this.runStore.load(run.runId))!,
      output: modelResult.text,
    }
  }

  // NOTE on multi-turn execution:
  // Phase 4 MVP is single-turn: model gets one chance to call tools and reply.
  // Multi-turn agentic loop (model calls tools → gets results → calls more tools → ...)
  // is a Phase 5 feature that requires loop termination policies, token budget management,
  // and deeper integration with the execution guard (guard runs per-turn, not per-request).
  

  async cancel(runId: string): Promise<void> {
    await this.runStore.update(runId, { status: 'cancelled', endedAt: Date.now() })
  }
}
```

### 4.4 Context builder expansion

**File**: `packages/core/src/context/context-builder.ts` — extend existing class

Add new methods alongside existing `buildFor()`:

```ts
// Existing method stays
buildFor(agent, job, options): AgentContext { /* ... */ }

// New methods
buildInteractiveContext(session: SessionState, task?: TaskState): InteractiveContext {
  return {
    sessionType: session.sessionType,
    taskState: task,
    recentTranscript: [],  // loaded from TranscriptStore
    toolAvailability: [],  // loaded from tool registry
    policyFlags: session.policyContext,
    environmentFacts: this.gatherEnvironmentFacts(),
  }
}

buildAutomationContext(job: AutomationJobDefinition): AutomationContext {
  return {
    jobId: job.id,
    workflow: job.workflow,
    lastRunStatus: job.lastRunStatus,
    schedule: job.schedule,
  }
}

buildVerificationContext(task: TaskState, run: RunRecord): VerificationContext {
  return {
    taskId: task.taskId,
    objective: task.objective,
    toolCalls: run.toolCalls,
    lastEvidence: task.lastEvidence,
    expectedOutcome: task.objective,
  }
}
```

### 4.5 Deliverables checklist

- [x] `packages/core/src/runtime/runtime.ts` — main Runtime class
- [x] `packages/core/src/runtime/intent-classifier.ts` — request classification
- [x] `packages/core/src/runner/interactive-runner.ts` — wraps debate + direct flows
- [x] Extend `packages/core/src/context/context-builder.ts` — new context modes
- [x] `packages/core/src/runtime/index.ts` — exports
- [x] Tests for Runtime, IntentClassifier, InteractiveRunner
- [x] Update CLI `run` command to optionally use new Runtime
- [x] Backward compatible: existing `ao run` behavior unchanged

---

## Phase 5: Role Specialization + Observability

**Goal**: Extend agent roles beyond debate. Add structured logging.

**Principles addressed**: #9 (Role specialization), #10 (Observability), #3 (Tool registry)

**Depends on**: Phase 4

### 5.1 Extended agent roles

**File**: `packages/core/src/types/agent.ts` — extend existing

```ts
// Existing roles stay
export type DebateRole = 'architect' | 'reviewer' | 'builder'

// New general roles
export type GeneralRole = 'planner' | 'executor' | 'verifier' | 'researcher' | 'operator'

// Union
export type AgentRole = DebateRole | GeneralRole
```

### 5.2 Role definitions with output contracts

**File**: `packages/core/src/roles/role-definitions.ts`

```ts
export type OutputContract = {
  requiredFields: string[]
  format: 'findings' | 'plan' | 'evidence' | 'summary' | 'freeform'
  maxLength?: number
}

export type RoleDefinition = {
  role: AgentRole
  description: string
  allowedToolCategories: Array<'read' | 'write' | 'exec' | 'external' | 'message'>
  canMutateState: boolean
  canAccessExternal: boolean
  outputContract: OutputContract
  defaultTimeoutMs: number
}

export const ROLE_DEFINITIONS: Record<string, RoleDefinition> = {
  planner: {
    role: 'planner',
    description: 'Decomposes tasks, decides delegation. No risky actions.',
    allowedToolCategories: ['read'],
    canMutateState: false,
    canAccessExternal: false,
    outputContract: {
      requiredFields: ['steps', 'delegations'],
      format: 'plan',
    },
    defaultTimeoutMs: 30_000,
  },
  executor: {
    role: 'executor',
    description: 'Runs tools, edits files, executes commands.',
    allowedToolCategories: ['read', 'write', 'exec'],
    canMutateState: true,
    canAccessExternal: false,
    outputContract: {
      requiredFields: ['actions', 'evidence'],
      format: 'evidence',
    },
    defaultTimeoutMs: 120_000,
  },
  verifier: {
    role: 'verifier',
    description: 'Checks whether work happened. Confirms outputs.',
    allowedToolCategories: ['read'],
    canMutateState: false,
    canAccessExternal: false,
    outputContract: {
      requiredFields: ['verified', 'evidence', 'issues'],
      format: 'evidence',
    },
    defaultTimeoutMs: 30_000,
  },
  researcher: {
    role: 'researcher',
    description: 'Fetches docs/web info. Mostly read-only.',
    allowedToolCategories: ['read', 'external'],
    canMutateState: false,
    canAccessExternal: true,
    outputContract: {
      requiredFields: ['findings', 'sources'],
      format: 'summary',
    },
    defaultTimeoutMs: 60_000,
  },
  operator: {
    role: 'operator',
    description: 'Handles cron/background jobs. Deterministic, low-chatter.',
    allowedToolCategories: ['read', 'write', 'exec', 'external'],
    canMutateState: true,
    canAccessExternal: true,
    outputContract: {
      requiredFields: ['status', 'result'],
      format: 'evidence',
    },
    defaultTimeoutMs: 300_000,
  },
}
```

### 5.3 Tool registry with metadata

**File**: `packages/core/src/tools/tool-registry.ts`

```ts
export type ToolCategory = 'read' | 'write' | 'exec' | 'external' | 'message'

export type ToolSpec = {
  name: string
  description: string
  category: ToolCategory
  mutatesState: boolean
  externalSideEffect: boolean
  requiresApproval: boolean
  allowedRoles: AgentRole[]
  timeoutMs: number
  inputSchema?: Record<string, unknown>
  outputSchema?: Record<string, unknown>
}

export class ToolRegistry {
  private tools: Map<string, ToolSpec> = new Map()

  register(tool: ToolSpec): void {
    this.tools.set(tool.name, tool)
  }

  get(name: string): ToolSpec | undefined {
    return this.tools.get(name)
  }

  listForRole(role: AgentRole): ToolSpec[] {
    return [...this.tools.values()].filter(t => t.allowedRoles.includes(role))
  }

  listByCategory(category: ToolCategory): ToolSpec[] {
    return [...this.tools.values()].filter(t => t.category === category)
  }

  isAllowed(toolName: string, role: AgentRole): boolean {
    const tool = this.tools.get(toolName)
    if (!tool) return false
    return tool.allowedRoles.includes(role)
  }
}
```

### 5.4 Structured logging

**File**: `packages/core/src/observability/logger.ts`

```ts
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type LogEntry = {
  timestamp: string
  level: LogLevel
  runId?: string
  sessionId?: string
  component: string
  message: string
  data?: Record<string, unknown>
}

export interface Logger {
  debug(component: string, message: string, data?: Record<string, unknown>): void
  info(component: string, message: string, data?: Record<string, unknown>): void
  warn(component: string, message: string, data?: Record<string, unknown>): void
  error(component: string, message: string, data?: Record<string, unknown>): void
  child(context: { runId?: string; sessionId?: string }): Logger
}

export class FileLogger implements Logger {
  private context: { runId?: string; sessionId?: string } = {}

  constructor(
    private logPath: string,
    private minLevel: LogLevel = 'info',
  ) {}

  child(context: { runId?: string; sessionId?: string }): Logger {
    const child = new FileLogger(this.logPath, this.minLevel)
    child.context = { ...this.context, ...context }
    return child
  }

  debug(component: string, message: string, data?: Record<string, unknown>): void {
    this.write('debug', component, message, data)
  }
  info(component: string, message: string, data?: Record<string, unknown>): void {
    this.write('info', component, message, data)
  }
  warn(component: string, message: string, data?: Record<string, unknown>): void {
    this.write('warn', component, message, data)
  }
  error(component: string, message: string, data?: Record<string, unknown>): void {
    this.write('error', component, message, data)
  }

  private write(level: LogLevel, component: string, message: string, data?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) return

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      ...this.context,
      component,
      message,
      data,
    }

    // Append to JSONL file
    const line = JSON.stringify(entry) + '\n'
    // fs.appendFileSync for simplicity; async version for production
    require('fs').appendFileSync(this.logPath, line)
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error']
    return levels.indexOf(level) >= levels.indexOf(this.minLevel)
  }
}
```

### 5.5 Persisted EventBus

Extend existing `EventBus` to optionally persist events:

**File**: `packages/core/src/events/persisted-event-bus.ts`

```ts
import { EventBus } from './event-bus.js'
import type { OrchestraEvent, EventType } from './types.js'

export class PersistedEventBus extends EventBus {
  constructor(private logPath: string) {
    super()
  }

  emit<T extends EventType>(type: T, event: EventMap[T]): void {
    // Persist before emitting
    const line = JSON.stringify({ type, ...event }) + '\n'
    require('fs').appendFileSync(this.logPath, line)

    // Then emit to in-memory listeners
    super.emit(type, event)
  }

  // Replay events from disk (for recovery)
  async replay(handler: (event: OrchestraEvent) => void): Promise<number> {
    const content = require('fs').readFileSync(this.logPath, 'utf-8')
    const lines = content.trim().split('\n').filter(Boolean)

    for (const line of lines) {
      const event = JSON.parse(line) as OrchestraEvent
      handler(event)
    }

    return lines.length
  }
}
```

### 5.6 Deliverables checklist

- [x] Extend `packages/core/src/types/agent.ts` — add GeneralRole
- [x] `packages/core/src/roles/role-definitions.ts` — role + output contracts
- [x] `packages/core/src/tools/tool-registry.ts` — ToolSpec + registry
- [x] `packages/core/src/observability/logger.ts` — structured Logger
- [x] `packages/core/src/events/persisted-event-bus.ts` — persistent events + replay
- [x] Tests for all new modules
- [x] Existing debate roles (architect/reviewer/builder) unchanged

---

## Cross-cutting: Trust Boundary (Principle #5)

This is embedded across phases rather than being its own phase:

- **Phase 1**: `TranscriptEntry.trustLevel` field distinguishes trusted/untrusted content
- **Phase 2**: Execution guard operates only on `user_input` trust level tasks
- **Phase 3**: Automation events get `automation` trust level
- **Phase 4**: Runtime tags all inbound content with appropriate trust level
- **Phase 5**: Tool registry `externalSideEffect` flag for external data marking

---

## File Structure Summary (all new files)

```
packages/core/src/
├── types/
│   └── runtime.ts                       # Phase 1: Session, Run, Task, Transcript types
├── storage/
│   ├── runtime-store.ts                 # Phase 1: store interfaces
│   ├── session-store.ts                 # Phase 1: FileSessionStore
│   ├── run-store.ts                     # Phase 1: FileRunStore
│   ├── task-store.ts                    # Phase 1: FileTaskStore
│   ├── transcript-store.ts             # Phase 1: FileTranscriptStore
│   └── automation-store.ts             # Phase 3: FileAutomationStore
├── guard/
│   ├── execution-guard.ts              # Phase 2: guard logic + config
│   ├── task-classifier.ts              # Phase 2: lightweight task classification
│   ├── evidence-collector.ts           # Phase 2: collectEvidence helper
│   └── index.ts                         # Phase 2: exports
├── runner/
│   ├── types.ts                         # Phase 3: Runner interface, workflow types
│   ├── automation-runner.ts            # Phase 3: isolated workflow execution
│   ├── interactive-runner.ts           # Phase 4: wraps debate + direct flows
│   ├── background-runner.ts            # Phase 4+: deferred from Phase 3
│   ├── scheduler.ts                     # Phase 3: cron scheduler
│   └── index.ts                         # Phase 3: exports
├── runtime/
│   ├── runtime.ts                       # Phase 4: main Runtime class
│   ├── intent-classifier.ts            # Phase 4: request routing
│   └── index.ts                         # Phase 4: exports
├── roles/
│   └── role-definitions.ts             # Phase 5: role + output contracts
├── tools/
│   └── tool-registry.ts                # Phase 5: ToolSpec registry
├── observability/
│   └── logger.ts                        # Phase 5: structured logging
└── events/
    └── persisted-event-bus.ts          # Phase 5: persistent EventBus

apps/cli/src/commands/
└── automation.ts                        # Phase 3: CLI for automation jobs
```

---

## Migration Strategy

### Backward compatibility

Every phase is **additive**. No existing code is modified in breaking ways.

- Phase 1-3: Pure additions. Existing `ao run` works identically.
- Phase 4: Existing `Orchestrator` becomes one runner inside `Runtime`. `ao run` can optionally use new `Runtime` via `--runtime v2` flag.
- Phase 5: Agent role union type extends, existing debate roles unaffected.

### Transition path

1. **Phase 1-2** can ship together (2-3 days). Foundation + guard.
2. **Phase 3** ships independently (2-3 days). Automation runner + CLI.
3. **Phase 4** is the largest change (3-5 days). Runtime integration.
4. **Phase 5** is incremental (2-3 days). Roles + observability.

After Phase 4: deprecate direct `Orchestrator` usage in CLI. Route everything through `Runtime`.

---

## What This Does NOT Cover (Intentional Scope Cuts)

1. **Web dashboard/GUI** — not in scope. CLI-first.
2. **Docker sandbox** — existing sandbox types stay as-is. Not needed for MVP.
3. **Artifact signing** — existing provenance types stay. Not needed for MVP.
4. **Remote skill marketplace** — existing registry client stays. Not needed for MVP.
5. **Wave protocol (multi-reviewer)** — separate feature, not part of this runtime evolution.
6. **Full cron expression parsing** — MVP uses simple intervals. Full cron can be added via dependency later.

---

## Resumption Policy

### Phase 3 (Automation)
- **Fail-fast**: If a workflow step fails after exhausting retries, the entire workflow stops. No partial resume.
- **Re-run**: User can re-run the full automation job via `ao automation run <jobId>`. A new RunRecord is created.
- **Abandoned detection**: If a RunRecord has `status: 'running'` and `lastActionAt` is older than `2 * step.timeoutMs`, scheduler marks it as `failed` with reason `'timeout_abandoned'`.

### Phase 4+ (Interactive / Background)
- **Resumable interruptions**: SIGINT during interactive run → task stays `status: 'blocked'` with `resumeHint`. Next session can pick it up.
- **Non-resumable**: Process crash, OOM → task stays `status: 'running'` forever. Stale detection (on next startup, scan for `running` tasks older than X) marks them `failed`.
- **Auto-resume**: Not in MVP. User explicitly resumes via `ao task resume <taskId>`.
- **Linking**: Resumed task creates a new RunRecord with same `taskId`. History is preserved via `RunStore.listByTask(taskId)`.

## Success Criteria

After all 5 phases:

1. `ao run` still works for code review (backward compatible)
2. `ao automation` works for isolated background jobs
3. Every run produces a `RunRecord` with timing + tool trace
4. Model "promises without action" are caught and blocked at runtime
5. Automation jobs don't depend on main chat session
6. Agent roles have clear tool access boundaries
7. All events are persisted (not just in-memory)
8. Papa can debug any failure by reading run logs

---

## One-Sentence Summary

This plan transforms agent-orchestra from a code review debate tool into a disciplined operations runtime — one phase at a time, without breaking what already works.
