# Top 3 Concepts to Integrate Next

> Generated: 2026-04-03 | Based on: codebase-diagnosis.md + agentscope-comparison.md

---

## #1 — Structured Conversation Log

### Problem solved

Debate history is a `string[]` that accumulates raw LLM text and gets concatenated into a template variable:

```typescript
// single-challenger.ts:108
const debateHistory: string[] = []

// line 148
debateHistory.push(`## Architect Analysis\n\n${architectOutput.rawText}`)

// line 226 — passed as a flat string to the next prompt
debate_history: this.buildDebateHistoryText(debateHistory, MAX_DEBATE_HISTORY_CHARS),
```

This causes three concrete problems:

1. **No queryability.** You can't ask "what did the reviewer say in round 2?" or "which findings were disputed?" without parsing raw markdown. Debugging a failed debate means reading multi-thousand-line JSON files.

2. **Lossy truncation.** `buildDebateHistoryText()` trims to 40K chars from the front. A critical architect finding from round 1 can be silently dropped if later rounds are verbose. There's no intelligence — just char count.

3. **Two incompatible message types.** Debate uses `AgentOutput` (findings-centric), runtime uses `TranscriptEntry` (role + trust level). They share no structure. The runtime-first migration (section 10 of diagnosis) requires bridging these — a unified message type is the natural bridge.

### Expected benefit

- **Debuggability:** Every agent utterance has an `id`, `timestamp`, `sender`, `role`. You can trace any finding to its origin message. The CLI `ao job show` command can display structured conversation instead of raw text dumps.
- **Orchestration clarity:** The protocol runner works with typed messages, not string concatenation. `ContextBuilder` selects relevant messages by round, role, or content type instead of slicing a char buffer.
- **Migration path:** The same `AgentMessage` type works for debate (stored in conversation log) and runtime (stored in transcript). When Runtime is wired to the server, it already speaks the right format.

### Scope

| Area | Change |
|---|---|
| New type | `AgentMessage { id, timestamp, sender, role, jobId, roundIndex, contentBlocks[], metadata? }` in `types/` |
| New type | `ContentBlock = TextBlock \| FindingBlock \| ToolCallBlock \| ToolResultBlock` in `types/` |
| New store | `ConversationStore` interface + `FileConversationStore` (append-only NDJSON per job) in `storage/` |
| Modify | `SingleChallengerRunner` — replace `debateHistory: string[]` with `ConversationStore.append()` calls. Replace `buildDebateHistoryText()` with `ConversationStore.loadByJob()` + `ContextBuilder` selection. |
| Modify | `OutputNormalizer` — return `AgentMessage` instead of (or alongside) `AgentOutput` |
| Modify | `ContextBuilder.buildFor()` — accept conversation log, select relevant messages by round/role |

**Does not touch:** Job type, Round type, protocol interface, CLI commands, server, providers. Round-level storage (`Round.architectOutput` etc.) stays as-is for backwards compatibility — the conversation log is additive.

### Dependencies

None. Can be built on current `main` without other changes.

### Risk

**Low.** Additive change. Existing `AgentOutput` and `Round` storage remain. The conversation log is a parallel data path that the protocol runner writes to. If it breaks, `debateHistory: string[]` can be kept as fallback during development.

---

## #2 — Real Context Budget Management

### Problem solved

`ContextBudgetManager.fitToLimit()` is declared in the spec, wired through the code, and **does nothing**:

```typescript
// interfaces/context-budget-manager.ts
export interface ContextBudgetManager {
  fitToLimit(context: AgentContext, tokenLimit: number): AgentContext
}

// Every call site — CLI run command, tests — uses a pass-through:
const budgetManager = { fitToLimit: (context: unknown) => context }
```

Meanwhile, context overflow is handled by a hardcoded char limit:

```typescript
// single-challenger.ts:113
const MAX_DEBATE_HISTORY_CHARS = 40_000
```

This causes two concrete problems:

1. **Silent quality degradation.** On a long debate (4+ rounds with auto-apply), early findings get truncated from the debate history. The architect in round 5 literally cannot see what the reviewer said in round 1. Findings get "rediscovered" — wasting rounds and tokens.

2. **No provider-awareness.** 40K chars is ~10K tokens for English text, but different models have different context windows (Claude: 200K, GPT-4: 128K, smaller models: 8K-32K). A fixed char limit either wastes capacity on large-context models or overflows on small ones.

### Expected benefit

- **Debate quality:** Old but important findings survive truncation. Summarization compresses verbose rounds into key points, keeping the architect/reviewer informed across the entire debate.
- **Provider flexibility:** Budget scales to the model's actual context window. Large-context models get richer debate history; small models get properly summarized history instead of hard-truncated garbage.
- **Foundation for #1:** Once the conversation log exists (concept #1), the budget manager operates on structured messages instead of char-counting a flat string. The two concepts compose naturally: #1 gives structure, #2 gives intelligent selection.

### Scope

| Area | Change |
|---|---|
| Implement | `DefaultContextBudgetManager implements ContextBudgetManager` in `context/` or `interfaces/` |
| Strategy | Token-count messages → if over limit: keep system prompt + last N rounds intact → summarize older rounds into a `SummaryBlock` → recount → iterate |
| Modify | `ContextBuilder.buildFor()` — pass actual token limit from provider config instead of hardcoded 16K |
| Modify | `SingleChallengerRunner` — remove `MAX_DEBATE_HISTORY_CHARS` and `buildDebateHistoryText()`. Let `ContextBuilder` + `ContextBudgetManager` handle truncation. |
| Modify | `TokenEstimator` — upgrade from char-based (`text.length / 4`) to tiktoken or provider-reported token counts |
| Config | Add `tokenLimit` to `AgentAssignment` or `JobRuntimeConfig`, sourced from provider's model config |

**Does not touch:** Protocol interface, storage layer, CLI commands, server, events.

### Dependencies

Best built after concept #1 (structured conversation log), because budget management on structured messages is cleaner than on a `string[]`. But can be built independently — the current `debateHistory` approach still benefits from token-counting + summarization.

### Risk

**Medium.** Summarization requires an LLM call, adding latency and cost to each round. Mitigation: only summarize when token count exceeds 80% of limit. On short debates (2-3 rounds), the budget manager is a no-op pass-through — same as today.

---

## #3 — Generic Typed EventBus

### Problem solved

The `EventBus` is a solid typed emitter, but its `EventMap` is hardcoded to debate events:

```typescript
// events/types.ts
export type EventMap = {
  'job:update': JobUpdateEvent       // imports JobStatus
  'round:start': RoundStartEvent     // imports RoundState
  'round:complete': RoundCompleteEvent
  'agent:output': AgentOutputEvent
  'agent:output:end': AgentOutputEndEvent  // imports AgentOutput
  'cluster:update': ClusterUpdateEvent     // imports FindingCluster
  'synthesis:ready': SynthesisReadyEvent
  error: ErrorEvent
}
```

This causes three concrete problems:

1. **Runtime can't emit events.** When `InteractiveRunner` completes a task, `AutomationRunner` finishes a workflow step, or `ExecutionGuard` blocks a response — there's no event channel. The runtime stack is silent.

2. **Server can't subscribe.** The server doesn't use `EventBus` because all events are debate-specific. It has no way to push live updates to the dashboard. When we wire Runtime into the server (migration step 2), we need runtime events to flow through the same bus.

3. **Coupling.** Any code that imports `EventBus` transitively imports `JobStatus`, `RoundState`, `AgentOutput`, `FindingCluster` — all debate types. A runtime module that just wants to emit "task completed" pulls in the entire debate type graph.

### Expected benefit

- **Decoupling.** EventBus becomes a generic mechanism. Debate events and runtime events are separate type definitions. A module only imports the events it cares about.
- **Observability.** Runtime events (`run:started`, `run:completed`, `task:status`, `guard:violation`) enable the server dashboard to show live status for non-debate work. The automation "logs" tab can show real-time step progress instead of polling completed runs.
- **Migration enabler.** When Runtime is wired to the server, the event bus is ready. No second event system needed. The server subscribes to both debate and runtime events through one channel.

### Scope

| Area | Change |
|---|---|
| Modify | `EventBus` — make generic: `class EventBus<TMap extends Record<string, unknown>>` |
| Split | `events/types.ts` → `events/debate-events.ts` (current events) + `events/runtime-events.ts` (new: `run:started`, `run:completed`, `task:status`, `guard:violation`) |
| Type alias | `type DebateEventBus = EventBus<DebateEventMap>` and `type RuntimeEventBus = EventBus<RuntimeEventMap>` |
| Compose | `type FullEventMap = DebateEventMap & RuntimeEventMap` for the server that needs both |
| Modify | `SingleChallengerRunner` — change `EventBus` to `EventBus<DebateEventMap>` (no behavior change) |
| Modify | `ProtocolExecutionDeps.eventBus` — type becomes `EventBus<DebateEventMap>` |
| Add events to | `InteractiveRunner`, `AutomationRunner`, `Runtime` — emit runtime events on state changes |

**Does not touch:** Storage, providers, skills, CLI commands, templates, context builder.

### Dependencies

None. Can be built on current `main`. The existing debate event flow is unchanged — only the type signature widens.

### Risk

**Low.** The generic `EventBus<TMap>` is a type-level change. Runtime behavior is identical. Existing `EventBus` usage in `SingleChallengerRunner` and `cli/commands/run.ts` only needs a type annotation update, no logic change. New runtime events are additive — emitting them in runners is optional until the server consumes them.

---

## Why these 3, not others

| Considered alternative | Why it lost |
|---|---|
| **Enforce role tool permissions** | Safety improvement, but no agent currently returns tool calls in debate mode. The enforcement has nothing to enforce yet. Revisit when executor/builder roles are active. |
| **Fan-out parallel execution** | Only needed for `reviewer_wave` protocol, which doesn't exist. Building infra for a protocol that may never ship is waste. |
| **Wire Runtime to server** | Correct goal, but it's a migration step, not a concept. Concepts #1 and #3 are prerequisites — do those first, then the wiring is straightforward. |
| **Dynamic agent-as-tool dispatch** | Useful for planner/executor orchestration (Phase 5+). Current debate protocol doesn't need it. |
| **ThinkingBlock privacy** | Only matters for multi-role orchestration with information hiding. Debate has two agents that see everything. No need now. |
| **Composable pipeline operators** | Extracting `sequential()`/`parallel()` from a single protocol is premature abstraction. Wait for protocol #2. |

## Implementation order

```
#1 Conversation Log ──> #2 Context Budget ──> #3 Generic EventBus
     (no deps)              (better with #1)       (no deps, parallel OK)
```

\#1 and #3 can be built in parallel. #2 benefits from #1 but doesn't strictly require it.

Total scope estimate: ~800-1000 lines of new code across the three concepts, with ~200 lines of modification to existing files. No breaking changes to public API.
