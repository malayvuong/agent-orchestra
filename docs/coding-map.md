# Coding Map: 3 Concepts into Current Codebase

> Generated: 2026-04-03 | All paths relative to `packages/core/src/`

---

## Concept #1 — Structured Conversation Log

### New files

```
types/message.ts               # AgentMessage + ContentBlock types
storage/conversation-store.ts  # FileConversationStore (append-only NDJSON)
storage/conversation-types.ts  # ConversationStore interface
```

### New types (`types/message.ts`)

```typescript
export type ContentBlock =
  | TextBlock
  | FindingBlock
  | ToolCallBlock
  | ToolResultBlock

export type TextBlock = {
  type: 'text'
  text: string
}

export type FindingBlock = {
  type: 'finding'
  finding: Finding  // re-uses existing Finding from types/finding.ts
}

export type ToolCallBlock = {
  type: 'tool_call'
  toolName: string
  input: Record<string, unknown>
}

export type ToolResultBlock = {
  type: 'tool_result'
  toolName: string
  output: string
  status: 'ok' | 'error'
}

export type AgentMessage = {
  id: string              // randomUUID()
  jobId: string
  roundIndex: number
  sender: string          // agent.id — e.g. "architect-1", "reviewer-1"
  role: AgentRole         // re-uses existing AgentRole
  state: RoundState       // analysis, review, rebuttal, etc.
  timestamp: string       // ISO 8601
  contentBlocks: ContentBlock[]
  findingCount: number    // pre-computed for fast filtering
  usage?: {               // pass-through from ProviderOutput
    inputTokens?: number
    outputTokens?: number
    latencyMs?: number
  }
}
```

### New interface (`storage/conversation-types.ts`)

```typescript
export interface ConversationStore {
  append(message: AgentMessage): Promise<void>
  loadByJob(jobId: string): Promise<AgentMessage[]>
  loadByJob(jobId: string, filter: {
    afterRound?: number
    role?: AgentRole
    sender?: string
    limit?: number
  }): Promise<AgentMessage[]>
}
```

### New store (`storage/conversation-store.ts`)

Append-only NDJSON file at `.agent-orchestra/jobs/{jobId}/conversation.jsonl`.
Same pattern as existing `FileTranscriptStore` (line-by-line JSON, read-filter-return).

### Target files to modify

| File | Line(s) | Change |
|---|---|---|
| `types/index.ts` | end | Add `export type { AgentMessage, ContentBlock, TextBlock, FindingBlock, ToolCallBlock, ToolResultBlock } from './message.js'` |
| `storage/index.ts` | end | Add `export { FileConversationStore } from './conversation-store.js'` and `export type { ConversationStore } from './conversation-types.js'` |
| `types/orchestrator.ts:12-24` | `ProtocolExecutionDeps` | Add `conversationStore: unknown` to the deps type |
| `output/normalizer.ts:37` | `normalize()` return | Add a `toMessages()` helper method that converts `AgentOutput` → `AgentMessage`. Not inside `normalize()` — called separately by the protocol runner after normalization. |
| `protocols/single-challenger.ts:108` | `debateHistory: string[]` | Replace with `const conversationStore = deps.conversationStore as ConversationStore` |
| `protocols/single-challenger.ts:148` | `debateHistory.push(...)` | Replace with `await conversationStore.append(this.toMessage(architectOutput, job.id, roundIndex, architect, 'analysis'))` |
| `protocols/single-challenger.ts:191` | `debateHistory.push(...)` | Same pattern — `conversationStore.append(...)` |
| `protocols/single-challenger.ts:226` | `buildDebateHistoryText()` call | Replace with `const history = await conversationStore.loadByJob(job.id); const historyText = this.formatConversationHistory(history)` |
| `protocols/single-challenger.ts:243` | `debateHistory.push(...)` in rebuttal | `conversationStore.append(...)` |
| `protocols/single-challenger.ts:302` | `debateHistory.push(...)` in follow-up | `conversationStore.append(...)` |
| `protocols/single-challenger.ts:312` | `debateHistory.push(...)` in follow-up | `conversationStore.append(...)` |
| `apps/cli/src/commands/run.ts:330-343` | deps wiring | Add `conversationStore: new FileConversationStore(baseDir)` to the deps object |

### Integration point

The conversation log plugs into `SingleChallengerRunner.runStep()` at the exact point where `debateHistory.push()` is called today (after normalization, after round save). The `runStep()` private method gets one new line at the end of its success path:

```typescript
// After line 852: await roundStore.save(round)
await conversationStore.append(
  this.agentOutputToMessage(agentOutput, job.id, roundIndex, agent, state)
)
```

A new private method `agentOutputToMessage()` converts `AgentOutput` → `AgentMessage`:
- `rawText` → `TextBlock`
- `findings[]` → `FindingBlock[]`
- `toolCalls[]` → `ToolCallBlock[]`

A new private method `formatConversationHistory(messages: AgentMessage[])` replaces `buildDebateHistoryText()`:
- Iterates messages, formats each as `## {role} ({state}, round {index})\n\n{text content}`
- Respects a char/token budget passed as parameter (preparation for concept #2)

### What stays untouched

- `Round` type and `RoundStore` — unchanged. Rounds still store `architectOutput`/`reviewerOutputs` for the CLI `ao job show` command and the server API.
- `AgentOutput` type — unchanged. It remains the normalization output; `AgentMessage` is a parallel representation, not a replacement.
- `Finding` type — unchanged. `FindingBlock` wraps it.
- All templates — unchanged. They still render prompts the same way.
- All CLI commands except `run.ts` — unchanged.
- Server — unchanged. It can optionally expose `/api/jobs/:id/conversation` later.
- Provider layer — unchanged.

### Backward compatibility

- `Round.architectOutput` and `Round.reviewerOutputs` remain populated. Any code reading round files still works.
- The conversation log is additive data. Old jobs without a `conversation.jsonl` file still load fine — `ConversationStore.loadByJob()` returns `[]`.
- `ProtocolExecutionDeps.conversationStore` is typed as `unknown` (same pattern as existing deps). Protocol runners that don't use it ignore it.

### Migration risk: **Low**

The only behavioral change is in `SingleChallengerRunner`: debate history switches from `string[]` to `ConversationStore`. If the store write fails, the protocol runner can catch and fall back to the old string approach. All other systems continue reading from `RoundStore`.

---

## Concept #2 — Real Context Budget Management

### New files

```
context/default-budget-manager.ts    # DefaultContextBudgetManager implementation
```

### New types

None new. Uses existing `ContextBudgetManager` interface (`interfaces/context-budget-manager.ts`), `AgentContext` (`types/context.ts`), and `TokenEstimator` (`interfaces/token-estimator.ts`).

One addition to `AgentContext`:

```typescript
// types/context.ts — add to AgentContext
export type AgentContext = {
  // ... existing fields ...
  conversationSummary?: string   // compressed older rounds
  recentMessages?: AgentMessage[] // kept intact (from concept #1)
}
```

### Target files to modify

| File | Line(s) | Change |
|---|---|---|
| `interfaces/context-budget-manager.ts:4-6` | interface | No change to the interface itself. Keep `fitToLimit(context, tokenLimit): AgentContext`. |
| `context/default-budget-manager.ts` | **new file** | Implements `ContextBudgetManager`. See logic below. |
| `context/context-builder.ts:17,76-77` | `buildFor()` | Replace pass-through comment with actual budget logic. Pass `conversationMessages` from concept #1 into context assembly. |
| `types/context.ts:32` | `AgentContext` | Add `conversationSummary?: string` and `recentMessages?: AgentMessage[]` fields |
| `protocols/single-challenger.ts:113` | `MAX_DEBATE_HISTORY_CHARS` | Remove. Budget is now managed by `ContextBudgetManager`. |
| `protocols/single-challenger.ts` | `buildDebateHistoryText()` calls | Remove. `ContextBuilder.buildFor()` now handles history inclusion via budget manager. |
| `protocols/single-challenger.ts:130-143` | `renderPrompt` in analysis step | Simplify: `ContextBuilder.buildFor()` already includes history in context. Template receives `context.conversationSummary` + `context.recentMessages` instead of raw `debate_history` string. |
| `apps/cli/src/commands/run.ts:268-269` | budgetManager wiring | Replace `{ fitToLimit: (context) => context }` with `new DefaultContextBudgetManager(simpleTokenEstimator)` |
| `apps/cli/src/utils/token-estimator.ts` | optional | Add `TODO: upgrade to tiktoken for production` comment. No change required — char/3 heuristic is acceptable for MVP. |
| `templates/defaults/*.ts` | 4 files | Replace `{{debate_history}}` variable with `{{conversation_summary}}\n\n{{recent_messages}}` in: `architect-response.ts`, `reviewer-followup.ts`, `architect-apply.ts`, `reviewer-final-check.ts`. |

### Implementation logic (`context/default-budget-manager.ts`)

```typescript
export class DefaultContextBudgetManager implements ContextBudgetManager {
  constructor(
    private tokenEstimator: TokenEstimator,
    private summarizer?: (text: string) => Promise<string>  // optional LLM-based
  ) {}

  fitToLimit(context: AgentContext, tokenLimit: number): AgentContext {
    const currentTokens = this.estimateContextTokens(context)
    if (currentTokens <= tokenLimit) {
      return context  // fits — no change
    }

    // Strategy: keep pinned context + last 2 rounds intact, summarize the rest
    // 1. Estimate pinned tokens (brief, scope, decisionLog) — never trimmed
    // 2. Estimate recent messages tokens — never trimmed
    // 3. If still over: truncate conversation summary from the front
    // 4. If still over: reduce recent messages to last 1 round
    // 5. If still over: truncate pinned.brief to first 2000 chars

    return trimmedContext
  }
}
```

No LLM summarizer in v1. The `summarizer` param is optional. Without it, old messages are simply dropped (same as today's truncation, but token-aware instead of char-aware). LLM summarization can be added later by passing a summarizer function.

### Integration point

`ContextBuilder.buildFor()` currently calls `this.budgetManager.fitToLimit(context, tokenLimit)` as its last step (line 77). The only change is that `context` now includes conversation data:

```typescript
// context/context-builder.ts — inside buildFor()

// Before fitToLimit, load conversation history and attach to context
if (options?.conversationMessages) {
  const { recent, older } = this.splitMessages(
    options.conversationMessages,
    keepRecentRounds: 2  // configurable
  )
  context.recentMessages = recent
  if (older.length > 0) {
    context.conversationSummary = this.formatOlderMessages(older)
  }
}

// fitToLimit now has real data to trim
return this.budgetManager.fitToLimit(context, tokenLimit)
```

The protocol runner passes conversation messages when calling `buildFor()`:

```typescript
// In SingleChallengerRunner, each renderPrompt callback:
const messages = await conversationStore.loadByJob(job.id)
const context = deps.contextBuilder.buildFor(architect, job, {
  skills: resolvedSkills,
  lifecyclePoint: 'pre_round',
  conversationMessages: messages,  // new param
})
```

### What stays untouched

- `ContextBudgetManager` interface — unchanged (existing contract is correct)
- `TokenEstimator` interface — unchanged
- `simpleTokenEstimator` in CLI — unchanged (upgrade to tiktoken is optional, separate task)
- `JobRuntimeConfig` — unchanged (can add `tokenLimit` config later)
- All storage — unchanged
- All events — unchanged
- Provider layer — unchanged

### Backward compatibility

- `DefaultContextBudgetManager` with no summarizer behaves like smart truncation — strictly better than current char-based truncation.
- `AgentContext.conversationSummary` and `recentMessages` are optional fields. Any code that doesn't read them is unaffected.
- Template changes are mechanical: `{{debate_history}}` → `{{conversation_summary}}\n\n{{recent_messages}}`. Output is the same format (markdown text), just assembled differently.
- If `options.conversationMessages` is not provided (e.g., tests that don't use concept #1), `buildFor()` skips the new logic — identical to today.

### Migration risk: **Medium**

The template variable rename (`debate_history` → `conversation_summary` + `recent_messages`) touches 4 template files. If a template has hardcoded references to `{{debate_history}}`, they must all be updated together. Unit tests for templates need updating.

The budget manager itself is low-risk — it's a pure function that trims data. The risk is in the integration: `buildFor()` signature gets a new optional param, and `SingleChallengerRunner` must pass it correctly. Missing the param means no history in the prompt (silent regression). Mitigation: add a test that verifies conversation messages flow through to the rendered prompt.

---

## Concept #3 — Generic Typed EventBus

### New files

```
events/runtime-events.ts       # RuntimeEventMap type
```

### Modified files

| File | Change |
|---|---|
| `events/event-bus.ts` | Make `EventBus` generic: `EventBus<TMap>` |
| `events/types.ts` | Rename to `events/debate-events.ts`. Keep all existing types. Add `DebateEventMap` alias. |
| `events/runtime-events.ts` | **New.** Define `RuntimeEventMap` with runtime event types. |
| `events/index.ts` | Re-export both event maps. Export composed `FullEventMap`. |
| `types/orchestrator.ts:20` | Change `eventBus: unknown` to `eventBus: EventBus<DebateEventMap>` (type-only, no runtime effect) |
| `protocols/single-challenger.ts:17` | Import `EventBus` with debate generic: `EventBus<DebateEventMap>` |
| `protocols/single-challenger.ts:77` | Cast: `const eventBus = deps.eventBus as EventBus<DebateEventMap>` (already casts, just change the target type) |
| `apps/cli/src/commands/run.ts:261` | `const eventBus = new EventBus<DebateEventMap>()` (add generic param) |

### Type changes

**`events/event-bus.ts`** — before:

```typescript
import type { EventMap, EventType } from './types.js'

export class EventBus {
  emit<T extends EventType>(type: T, payload: EventMap[T]): void { ... }
  on<T extends EventType>(type: T, handler: (payload: EventMap[T]) => void): void { ... }
  // ...
}
```

**`events/event-bus.ts`** — after:

```typescript
export class EventBus<TMap extends Record<string, unknown> = Record<string, unknown>> {
  private readonly emitter = new EventEmitter()

  emit<T extends string & keyof TMap>(type: T, payload: TMap[T]): void {
    this.emitter.emit(PREFIX + type, payload)
  }

  on<T extends string & keyof TMap>(type: T, handler: (payload: TMap[T]) => void): void {
    this.emitter.on(PREFIX + type, handler)
  }

  off<T extends string & keyof TMap>(type: T, handler: (payload: TMap[T]) => void): void {
    this.emitter.off(PREFIX + type, handler)
  }

  once<T extends string & keyof TMap>(type: T, handler: (payload: TMap[T]) => void): void {
    this.emitter.once(PREFIX + type, handler)
  }

  removeAllListeners(type?: string & keyof TMap): void {
    if (type) {
      this.emitter.removeAllListeners(PREFIX + type)
    } else {
      this.emitter.removeAllListeners()
    }
  }
}
```

**`events/debate-events.ts`** (renamed from `types.ts`):

```typescript
// All existing types stay exactly as-is.
// Add one alias at the bottom:

export type DebateEventMap = EventMap  // backward compat alias

// Keep EventMap, EventType, OrchestraEvent exports for backward compat
```

**`events/runtime-events.ts`** (new):

```typescript
export type RunStartedEvent = {
  type: 'run:started'
  runId: string
  sessionId: string
  mode: string
  timestamp: string
}

export type RunCompletedEvent = {
  type: 'run:completed'
  runId: string
  sessionId: string
  status: 'completed' | 'failed' | 'cancelled'
  timestamp: string
}

export type TaskStatusEvent = {
  type: 'task:status'
  taskId: string
  status: string
  timestamp: string
}

export type GuardViolationEvent = {
  type: 'guard:violation'
  runId: string
  violationType: string
  message: string
  timestamp: string
}

export type RuntimeEventMap = {
  'run:started': RunStartedEvent
  'run:completed': RunCompletedEvent
  'task:status': TaskStatusEvent
  'guard:violation': GuardViolationEvent
}
```

**`events/index.ts`** — after:

```typescript
// Debate events (backward compat — same exports as before)
export type {
  JobUpdateEvent,
  RoundStartEvent,
  RoundCompleteEvent,
  AgentOutputEvent,
  AgentOutputEndEvent,
  ClusterUpdateEvent,
  SynthesisReadyEvent,
  ErrorEvent,
  OrchestraEvent,
  EventMap,
  EventType,
  DebateEventMap,
} from './debate-events.js'

// Runtime events
export type {
  RunStartedEvent,
  RunCompletedEvent,
  TaskStatusEvent,
  GuardViolationEvent,
  RuntimeEventMap,
} from './runtime-events.js'

// Composed map for server/dashboard that needs both
export type FullEventMap = DebateEventMap & RuntimeEventMap

// Classes
export { EventBus } from './event-bus.js'
export { PersistedEventBus } from './persisted-event-bus.js'
```

### Integration point

The change is type-level. The runtime behavior of `EventBus` is identical — `EventEmitter.emit()` doesn't care about TypeScript generics.

**Where the generic param gets set:**

| Call site | Before | After |
|---|---|---|
| `cli/commands/run.ts:261` | `new EventBus()` | `new EventBus<DebateEventMap>()` |
| `protocols/single-challenger.ts:77` | `deps.eventBus as EventBus` | `deps.eventBus as EventBus<DebateEventMap>` |
| `events/persisted-event-bus.ts:6` | `extends EventBus` | `extends EventBus<DebateEventMap>` |
| Future: `runtime/runtime.ts` | n/a | Will use `EventBus<RuntimeEventMap>` |
| Future: `apps/server/src/index.ts` | n/a | Will use `EventBus<FullEventMap>` |

**Where runtime events get emitted (future, not in this PR):**

| File | Event |
|---|---|
| `runner/interactive-runner.ts:40` | `run:started` after `runStore.create()` |
| `runner/interactive-runner.ts:114` | `run:completed` after `runStore.update()` |
| `runner/automation-runner.ts:29` | `run:started` after `runStore.create()` |
| `runner/automation-runner.ts:131` | `run:completed` after `runStore.update()` |
| `runtime/runtime.ts:138` | `guard:violation` when guard blocks |

These emissions are NOT part of concept #3. Concept #3 only provides the type infrastructure. Emitting runtime events happens when `Runtime` is wired to the server (a separate migration step).

### What stays untouched

- All debate event types — unchanged (same fields, same names)
- `SingleChallengerRunner` event emission logic — unchanged (same `.emit()` calls)
- CLI `run.ts` event subscription — unchanged (same `.on()` handlers)
- `EventLogger` — unchanged (it logs whatever events it receives)
- Storage layer — unchanged
- Templates — unchanged
- Provider layer — unchanged
- Output normalizer — unchanged
- All non-event modules — unchanged

### Backward compatibility

- `EventMap` and `EventType` exports stay in `events/index.ts`. Any code importing them still works.
- `EventBus` without a generic param defaults to `Record<string, unknown>` — existing code that does `new EventBus()` still compiles.
- The rename `types.ts` → `debate-events.ts` is internal to `events/`. The barrel `events/index.ts` re-exports everything — no external import paths change.
- `PersistedEventBus extends EventBus<DebateEventMap>` — the replay method continues to work because the persisted JSON format is unchanged.

### Migration risk: **Low**

Pure type-level refactor for existing code. Zero runtime behavior change. The only risk is the file rename (`types.ts` → `debate-events.ts`) breaking internal imports within the `events/` folder — but there are only 3 files: `event-bus.ts`, `persisted-event-bus.ts`, and `index.ts`. All are updated in the same PR.

---

## Cross-concept dependency map

```
                   Concept #1                    Concept #3
              Conversation Log              Generic EventBus
                     │                             │
   types/message.ts  │  events/event-bus.ts<TMap>  │
   storage/conv-*    │  events/debate-events.ts    │
   single-challenger │  events/runtime-events.ts   │
   cli/run.ts        │  events/index.ts            │
                     │                             │
                     └──────────┐                  │
                                │                  │
                          Concept #2               │
                     Context Budget Mgmt           │
                                │                  │
              context/default-budget-manager.ts    │
              context/context-builder.ts           │
              templates/defaults (4 files)         │
              single-challenger.ts                 │
                                                   │
                     (no dependency) ──────────────┘
```

- **#1 and #3 are independent.** Can be built in parallel.
- **#2 depends on #1** for conversation messages. Can be started in parallel but the integration in `buildFor()` requires `AgentMessage[]` from concept #1.
- **#2 and #3 have no dependency.**

## Files touched (summary)

| File | C#1 | C#2 | C#3 |
|---|---|---|---|
| `types/message.ts` | **new** | | |
| `types/context.ts` | | modify | |
| `types/index.ts` | modify | | |
| `types/orchestrator.ts` | modify | | modify |
| `storage/conversation-types.ts` | **new** | | |
| `storage/conversation-store.ts` | **new** | | |
| `storage/index.ts` | modify | | |
| `context/default-budget-manager.ts` | | **new** | |
| `context/context-builder.ts` | | modify | |
| `events/event-bus.ts` | | | modify |
| `events/types.ts` → `debate-events.ts` | | | rename+modify |
| `events/runtime-events.ts` | | | **new** |
| `events/index.ts` | | | modify |
| `events/persisted-event-bus.ts` | | | modify |
| `protocols/single-challenger.ts` | modify | modify | modify |
| `output/normalizer.ts` | modify | | |
| `templates/defaults/architect-response.ts` | | modify | |
| `templates/defaults/reviewer-followup.ts` | | modify | |
| `templates/defaults/architect-apply.ts` | | modify | |
| `templates/defaults/reviewer-final-check.ts` | | modify | |
| `apps/cli/src/commands/run.ts` | modify | modify | modify |

**New files:** 5
**Modified files:** 14 (some touched by multiple concepts)
**Deleted files:** 0
**Renamed files:** 1 (`events/types.ts` → `events/debate-events.ts`)
