# Design Spec: Structured Conversation Log + Generic EventBus

> Status: **Pending review**
> Author: Agent | Date: 2026-04-03
> Base commit: e88b85f (main)

---

## 1. Objective

Add a structured, append-only conversation log to the debate engine and decouple the EventBus from debate-specific types. These two changes lay the foundation for the runtime-first migration without destabilizing the current `ao run` flow.

## 2. Problem statement

**Problem A — Opaque debate history.** `SingleChallengerRunner` accumulates debate turns as `debateHistory: string[]` (plain markdown text). This string array has no identity (no message IDs), no metadata (no sender, role, round index), and no queryability. Debugging a failed debate requires reading multi-thousand-line round JSON files. The 40K-char truncation silently drops early findings on long debates.

**Problem B — EventBus locked to debate types.** `EventBus` is typed against `EventMap` which hardcodes 7 debate-specific event types importing `JobStatus`, `RoundState`, `AgentOutput`, `FindingCluster`. Any module wanting to emit events must accept the entire debate type graph. The runtime stack (`Runtime`, `InteractiveRunner`, `AutomationRunner`) has no event channel at all.

## 3. Scope

### In scope

- `AgentMessage` type with `ContentBlock` discriminated union
- `ConversationStore` interface + `FileConversationStore` (NDJSON)
- Wire conversation log into `SingleChallengerRunner` (replace `debateHistory: string[]`)
- Wire `FileConversationStore` into CLI `run` command deps
- Generic `EventBus<TMap>` with default type param
- Split `events/types.ts` into `debate-events.ts` + `runtime-events.ts`
- Update all internal imports and type casts

### Out of scope

- `DefaultContextBudgetManager` — `fitToLimit()` stays pass-through
- Template variable changes — `{{debate_history}}` template var stays as-is
- Token-aware truncation — keep `MAX_DEBATE_HISTORY_CHARS = 40_000`
- Runtime event emissions in runners — types only, no `.emit()` calls
- Server API changes
- Dashboard changes
- `ToolCallBlock` / `ToolResultBlock` content blocks

## 4. File-level changes

### New files (5)

| File | Purpose |
|---|---|
| `packages/core/src/types/message.ts` | `AgentMessage`, `ContentBlock`, `TextBlock`, `FindingBlock` types |
| `packages/core/src/storage/conversation-types.ts` | `ConversationStore` interface |
| `packages/core/src/storage/conversation-store.ts` | `FileConversationStore` implementation |
| `packages/core/src/events/runtime-events.ts` | `RuntimeEventMap` + 4 runtime event types |
| `packages/core/src/storage/__tests__/conversation-store.test.ts` | Unit tests for FileConversationStore |

### Renamed files (1)

| From | To | Reason |
|---|---|---|
| `packages/core/src/events/types.ts` | `packages/core/src/events/debate-events.ts` | Separate debate events from generic mechanism |

### Modified files (9)

| File | Change |
|---|---|
| `packages/core/src/types/index.ts` | Add re-exports for `AgentMessage`, `ContentBlock`, `TextBlock`, `FindingBlock` |
| `packages/core/src/types/orchestrator.ts` | Add `conversationStore: unknown` to `ProtocolExecutionDeps` |
| `packages/core/src/storage/index.ts` | Add re-exports for `ConversationStore`, `FileConversationStore` |
| `packages/core/src/events/event-bus.ts` | Make `EventBus` generic: `EventBus<TMap>` |
| `packages/core/src/events/persisted-event-bus.ts` | Extend `EventBus<DebateEventMap>` |
| `packages/core/src/events/index.ts` | Re-export split event types + `FullEventMap` |
| `packages/core/src/protocols/single-challenger.ts` | Replace `debateHistory: string[]` with `ConversationStore` reads/writes |
| `apps/cli/src/commands/run.ts` | Wire `FileConversationStore` into deps, type `EventBus<DebateEventMap>` |
| `packages/core/src/protocols/__tests__/single-challenger.test.ts` | Add `conversationStore` mock to deps fixture |

## 5. Data types

### `AgentMessage` (`types/message.ts`)

```typescript
type AgentMessage = {
  id: string              // randomUUID()
  jobId: string           // from Job.id
  roundIndex: number      // protocol step counter
  sender: string          // agent.id (e.g. "architect-1")
  role: AgentRole         // "architect" | "reviewer" | ...
  state: RoundState       // "analysis" | "review" | "rebuttal" | ...
  timestamp: string       // ISO 8601
  contentBlocks: ContentBlock[]
  findingCount: number    // length of finding blocks
  usage?: {
    inputTokens?: number
    outputTokens?: number
    latencyMs?: number
  }
}
```

### `ContentBlock` (`types/message.ts`)

```typescript
type TextBlock = { type: 'text'; text: string }
type FindingBlock = { type: 'finding'; finding: Finding }
type ContentBlock = TextBlock | FindingBlock
```

### `ConversationStore` (`storage/conversation-types.ts`)

```typescript
interface ConversationStore {
  append(message: AgentMessage): Promise<void>
  loadByJob(jobId: string, filter?: {
    afterRound?: number
    role?: AgentRole
    sender?: string
  }): Promise<AgentMessage[]>
}
```

### `RuntimeEventMap` (`events/runtime-events.ts`)

```typescript
type RuntimeEventMap = {
  'run:started': RunStartedEvent
  'run:completed': RunCompletedEvent
  'task:status': TaskStatusEvent
  'guard:violation': GuardViolationEvent
}
```

### `FullEventMap` (`events/index.ts`)

```typescript
type FullEventMap = DebateEventMap & RuntimeEventMap
```

### Storage format

`FileConversationStore` writes to `.agent-orchestra/jobs/{jobId}/conversation.jsonl`:

```jsonl
{"id":"abc-123","jobId":"job-1","roundIndex":0,"sender":"architect-1","role":"architect","state":"analysis","timestamp":"2026-04-03T10:00:00.000Z","contentBlocks":[{"type":"text","text":"..."},{"type":"finding","finding":{...}}],"findingCount":3}
{"id":"def-456","jobId":"job-1","roundIndex":1,"sender":"reviewer-1","role":"reviewer","state":"review","timestamp":"2026-04-03T10:00:05.000Z","contentBlocks":[{"type":"text","text":"..."}],"findingCount":2}
```

## 6. Runtime flow

### Before (current)

```
SingleChallengerRunner.execute()
  const debateHistory: string[] = []           ← in-memory only
  ...
  debateHistory.push(`## Architect...\n${raw}`) ← string concat
  ...
  debate_history: buildDebateHistoryText(debateHistory, 40000) ← char truncation
```

### After (with conversation log)

```
SingleChallengerRunner.execute()
  const conversationStore = deps.conversationStore as ConversationStore
  ...
  await conversationStore.append(toMessage(output, job.id, idx, agent, state))  ← structured write
  ...
  const history = await conversationStore.loadByJob(job.id)                     ← structured read
  debate_history: formatHistory(history, 40000)                                 ← same truncation
```

Key invariant: the `debate_history` template variable still receives a markdown string. Templates are unchanged. The internal representation is structured, but the output to templates is identical.

### EventBus before/after

Before: `class EventBus` — typed against hardcoded `EventMap`
After: `class EventBus<TMap>` — parameterized. Existing code passes `DebateEventMap`. Runtime code (future) passes `RuntimeEventMap`.

No behavior change. Same `EventEmitter` underneath.

## 7. Migration strategy

1. **Additive, not replacement.** `Round.architectOutput` and `Round.reviewerOutputs` continue to be populated. The conversation log is a parallel data path.
2. **No flag/toggle.** The conversation log is always written when the protocol runs. There's no feature flag.
3. **Old jobs are unaffected.** `ConversationStore.loadByJob()` returns `[]` for jobs without a `conversation.jsonl` file. This is handled by a try/catch in the file read.

## 8. Backward compatibility

| Concern | Status |
|---|---|
| `Round` JSON files | Unchanged — still written by `roundStore.save()` |
| `AgentOutput` type | Unchanged — still the normalization output |
| `Finding` type | Unchanged — `FindingBlock` wraps it, doesn't replace it |
| Template variables | Unchanged — `{{debate_history}}` still receives the same markdown string |
| CLI output | Unchanged — same findings display |
| Server API | Unchanged — no new endpoints |
| `ao job show` command | Unchanged — reads from round files |
| Event handlers in `cli/run.ts` | Unchanged — same `.on()` callbacks, just `EventBus<DebateEventMap>` type |
| `EventMap` / `EventType` exports | Unchanged — re-exported from `debate-events.ts` |
| Existing tests | Updated only to add `conversationStore` mock to `ProtocolExecutionDeps` fixtures |

## 9. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `conversationStore.append()` throws during protocol run | Low | High — could abort the debate | Wrap in try/catch inside `runStep()`. Log warning, continue without conversation log. Protocol still works via round files. |
| Test fixtures missing `conversationStore` in deps | High | Low — tests fail at compile time | Grep all `ProtocolExecutionDeps` fixtures in test files, add mock. |
| `events/types.ts` rename breaks imports | Low | Medium | Only 2 internal files import it. Both updated in same commit. Barrel `events/index.ts` shields external consumers. |
| `conversation.jsonl` write race on concurrent agents | N/A | N/A | Current protocol runs agents sequentially. No concurrency issue. |
| Performance regression from NDJSON reads during prompt rendering | Low | Low | One file read per round. File is ~50KB for a 10-round debate. Negligible vs LLM API latency. |

## 10. Tests

### New test file: `storage/__tests__/conversation-store.test.ts`

| Test | What it verifies |
|---|---|
| `append + loadByJob round-trip` | Write N messages, read all back, verify count and content |
| `loadByJob with afterRound filter` | Only messages after specified round index returned |
| `loadByJob with role filter` | Only messages from specified role returned |
| `loadByJob on empty/missing job` | Returns `[]`, does not throw |
| `corrupt NDJSON line skipped` | Manually corrupt a line, verify other messages still load |

### Updated test fixture: `protocols/__tests__/single-challenger.test.ts`

Add to every `ProtocolExecutionDeps` mock:
```typescript
conversationStore: {
  append: vi.fn().mockResolvedValue(undefined),
  loadByJob: vi.fn().mockResolvedValue([]),
}
```

Verify: `conversationStore.append` called once per agent step (analysis, review, rebuttal, followup, convergence).

### Existing tests that must still pass

- `events/__tests__/event-bus.test.ts` — EventBus behavior unchanged
- `events/__tests__/persisted-event-bus.test.ts` — PersistedEventBus behavior unchanged
- `orchestrator/__tests__/orchestrator.test.ts` — Orchestrator deps updated
- All other existing tests — no changes expected

## 11. Success criteria

1. `pnpm typecheck` passes across all packages
2. `pnpm test` passes with zero regressions
3. `ao run --target examples/untested-module.ts --provider auto` produces identical CLI output
4. `.agent-orchestra/jobs/{id}/conversation.jsonl` exists after a run
5. Each NDJSON line contains valid `AgentMessage` with `id`, `sender`, `role`, `state`, `contentBlocks`, `timestamp`
6. Round JSON files still contain `architectOutput`/`reviewerOutputs` (parallel data)
7. `EventBus<DebateEventMap>`, `EventBus<RuntimeEventMap>`, `EventBus<FullEventMap>`, and unparameterized `EventBus()` all compile
