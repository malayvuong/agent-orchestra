# Implementation Plan — MVP Slice

> Generated: 2026-04-03
> Goal: Ship the smallest slice that delivers real value without destabilizing the debate engine.

---

## MVP scope

Ship **Concept #1 (Structured Conversation Log)** and **Concept #3 (Generic EventBus)** only.

**Defer Concept #2 (Context Budget Manager)** entirely. The current `buildDebateHistoryText()` with 40K char truncation continues working. It is not broken — it is just not optimal. Replacing it requires template changes and a new summarization strategy, both of which add risk for marginal MVP value.

### What ships

1. `AgentMessage` type + `ContentBlock` union
2. `ConversationStore` interface + `FileConversationStore`
3. `SingleChallengerRunner` writes to conversation log after each agent call
4. `SingleChallengerRunner` reads from conversation log instead of `debateHistory: string[]`
5. `EventBus<TMap>` generic + debate/runtime event type split

### What does NOT ship

- No `DefaultContextBudgetManager` — `fitToLimit()` stays pass-through
- No template variable rename — `{{debate_history}}` stays as-is
- No token-aware truncation — keep `MAX_DEBATE_HISTORY_CHARS`
- No runtime event emissions — just the type infrastructure
- No server changes
- No CLI output changes (findings display stays the same)

---

## Step-by-step implementation order

### Step 1 — Generic EventBus (30 min)

**Why first:** Zero dependencies, pure type refactor, gets it out of the way.

**1a. Rename `events/types.ts` → `events/debate-events.ts`**

Update internal imports in `events/event-bus.ts`, `events/persisted-event-bus.ts`, `events/index.ts`.

Add alias at the bottom of `debate-events.ts`:
```typescript
export type DebateEventMap = EventMap
```

**1b. Make `EventBus` generic**

```typescript
// events/event-bus.ts
export class EventBus<TMap extends Record<string, unknown> = Record<string, unknown>> {
  emit<T extends string & keyof TMap>(type: T, payload: TMap[T]): void { ... }
  on<T extends string & keyof TMap>(type: T, handler: (payload: TMap[T]) => void): void { ... }
  off<T extends string & keyof TMap>(type: T, handler: (payload: TMap[T]) => void): void { ... }
  once<T extends string & keyof TMap>(type: T, handler: (payload: TMap[T]) => void): void { ... }
  removeAllListeners(type?: string & keyof TMap): void { ... }
}
```

**1c. Update `PersistedEventBus`**

```typescript
export class PersistedEventBus extends EventBus<DebateEventMap> { ... }
```

**1d. Create `events/runtime-events.ts`**

4 event types: `run:started`, `run:completed`, `task:status`, `guard:violation`. Plus `RuntimeEventMap` type.

**1e. Update `events/index.ts`**

Re-export everything. Add `FullEventMap = DebateEventMap & RuntimeEventMap`.

**1f. Update call sites**

- `protocols/single-challenger.ts:77` — cast to `EventBus<DebateEventMap>`
- `apps/cli/src/commands/run.ts:261` — `new EventBus<DebateEventMap>()`

**Validation:**
```bash
pnpm typecheck     # all packages compile
pnpm test          # existing event-bus tests pass unchanged
```

---

### Step 2 — AgentMessage type + ConversationStore (45 min)

**Why second:** Foundation for step 3. Can be tested independently.

**2a. Create `types/message.ts`**

```typescript
import type { AgentRole } from './agent.js'
import type { RoundState } from './protocol.js'
import type { Finding } from './finding.js'

export type TextBlock = { type: 'text'; text: string }
export type FindingBlock = { type: 'finding'; finding: Finding }
export type ContentBlock = TextBlock | FindingBlock

export type AgentMessage = {
  id: string
  jobId: string
  roundIndex: number
  sender: string
  role: AgentRole
  state: RoundState
  timestamp: string
  contentBlocks: ContentBlock[]
  findingCount: number
  usage?: { inputTokens?: number; outputTokens?: number; latencyMs?: number }
}
```

No `ToolCallBlock`/`ToolResultBlock` yet — defer until agents actually use tools.

**2b. Export from `types/index.ts`**

```typescript
export type { AgentMessage, ContentBlock, TextBlock, FindingBlock } from './message.js'
```

**2c. Create `storage/conversation-types.ts`**

```typescript
import type { AgentMessage } from '../types/message.js'
import type { AgentRole } from '../types/agent.js'

export interface ConversationStore {
  append(message: AgentMessage): Promise<void>
  loadByJob(jobId: string, filter?: {
    afterRound?: number
    role?: AgentRole
    sender?: string
  }): Promise<AgentMessage[]>
}
```

**2d. Create `storage/conversation-store.ts`**

Append-only NDJSON. Path: `{baseDir}/jobs/{jobId}/conversation.jsonl`.
Same implementation pattern as `FileTranscriptStore` — `appendFile` for writes, `readFile` + split + filter for reads.

```typescript
export class FileConversationStore implements ConversationStore {
  constructor(private readonly baseDir: string) {}

  async append(message: AgentMessage): Promise<void> {
    const dir = join(this.baseDir, 'jobs', message.jobId)
    await mkdir(dir, { recursive: true })
    const filePath = join(dir, 'conversation.jsonl')
    await appendFile(filePath, JSON.stringify(message) + '\n', 'utf-8')
  }

  async loadByJob(jobId: string, filter?: { ... }): Promise<AgentMessage[]> {
    // Read NDJSON, parse lines, apply filter, return
  }
}
```

**2e. Export from `storage/index.ts`**

```typescript
export type { ConversationStore } from './conversation-types.js'
export { FileConversationStore } from './conversation-store.js'
```

**2f. Add to `ProtocolExecutionDeps`**

```typescript
// types/orchestrator.ts
export type ProtocolExecutionDeps = {
  // ... existing fields ...
  conversationStore: unknown
}
```

**Validation:**
```bash
pnpm typecheck
# Write unit tests for FileConversationStore:
# - append + loadByJob round-trip
# - filter by afterRound
# - filter by role
# - empty job returns []
# - corrupt NDJSON line is skipped
```

---

### Step 3 — Wire conversation log into SingleChallengerRunner (60 min)

**Why third:** This is the behavioral change. Steps 1-2 are additive infrastructure.

**3a. Add a private `toMessage()` helper to `SingleChallengerRunner`**

```typescript
private toMessage(
  output: AgentOutput,
  jobId: string,
  roundIndex: number,
  agent: AgentAssignment,
  state: RoundState,
): AgentMessage {
  const contentBlocks: ContentBlock[] = [
    { type: 'text', text: output.rawText },
    ...output.findings.map(f => ({ type: 'finding' as const, finding: f })),
  ]
  return {
    id: randomUUID(),
    jobId,
    roundIndex,
    sender: agent.id,
    role: agent.role,
    state,
    timestamp: new Date().toISOString(),
    contentBlocks,
    findingCount: output.findings.length,
    usage: output.usage ? {
      inputTokens: output.usage.inputTokens,
      outputTokens: output.usage.outputTokens,
      latencyMs: output.usage.latencyMs,
    } : undefined,
  }
}
```

**3b. Add a private `formatHistory()` helper**

```typescript
private formatHistory(messages: AgentMessage[], maxChars: number): string {
  // Replaces buildDebateHistoryText()
  // Same truncation logic (walk backwards, keep recent, truncate old)
  // but reads from AgentMessage[] instead of string[]
  const entries = messages.map(m => {
    const label = `## ${m.role} (${m.state}, round ${m.roundIndex})`
    const text = m.contentBlocks
      .filter((b): b is TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('\n\n')
    return `${label}\n\n${text}`
  })

  // Reuse existing truncation logic from buildDebateHistoryText
  return this.buildDebateHistoryText(entries, maxChars)
}
```

**3c. Modify `execute()`**

Replace:
```typescript
const debateHistory: string[] = []
```
With:
```typescript
const conversationStore = deps.conversationStore as ConversationStore
```

**3d. Modify each agent call site in `execute()`**

After every successful agent output, replace `debateHistory.push(...)` with:

```typescript
await conversationStore.append(this.toMessage(architectOutput, job.id, roundIndex - 1, architect, 'analysis'))
```

There are **6 push sites** in `execute()`:
1. Line 148 — after architect analysis
2. Line 191 — after initial review
3. Line 240-242 — after architect response (rebuttal)
4. Line 312-314 — after reviewer follow-up

**3e. Modify each `renderPrompt` callback**

Replace `this.buildDebateHistoryText(debateHistory, MAX_DEBATE_HISTORY_CHARS)` with:

```typescript
const history = await conversationStore.loadByJob(job.id)
const historyText = this.formatHistory(history, MAX_DEBATE_HISTORY_CHARS)
```

There are **2 sites** that use `debate_history` in templates:
1. Line 226 — architect response prompt
2. Line 302 — reviewer followup prompt

**3f. Keep `buildDebateHistoryText()` private method**

Don't delete it. `formatHistory()` delegates to it internally. This keeps the truncation logic unchanged and testable.

**3g. Keep `MAX_DEBATE_HISTORY_CHARS = 40_000`**

No change. Context budget management is deferred.

**3h. Wire in `apps/cli/src/commands/run.ts`**

Add to deps object at line 330:
```typescript
conversationStore: new FileConversationStore(baseDir),
```

Add import:
```typescript
import { FileConversationStore } from '@malayvuong/agent-orchestra-core'
```

**Validation:**
```bash
pnpm typecheck
pnpm test   # existing single-challenger tests still pass

# New test: run a full single_challenger protocol with mocked provider
# Verify conversation.jsonl is created with correct messages
# Verify debate_history template variable contains formatted conversation
# Verify message count matches expected round count
```

---

### Step 4 — Verify end-to-end (15 min)

Run the actual CLI against a real target:

```bash
pnpm dev:cli run --target examples/untested-module.ts --provider auto
```

**Check:**
1. Job completes successfully (same findings as before)
2. `.agent-orchestra/jobs/{id}/conversation.jsonl` exists
3. Each line in `conversation.jsonl` is valid JSON with `id`, `sender`, `role`, `state`, `contentBlocks`
4. Round JSON files still have `architectOutput`/`reviewerOutputs` (backward compat)
5. CLI output is identical (same findings display)

---

## Deferred items

| Item | Why deferred | When to revisit |
|---|---|---|
| `DefaultContextBudgetManager` | Current 40K truncation works. Budget management needs template changes and summarization strategy. Ship separately. | After MVP ships and conversation log proves stable. |
| Template variable rename (`debate_history` → `conversation_summary` + `recent_messages`) | Coupled to budget manager. No value without intelligent selection. | Same as above. |
| Token-aware truncation (replace char-based with tiktoken) | Requires adding `js-tiktoken` dependency. Char/3 heuristic is acceptable for MVP. | When a user hits context overflow on a real review. |
| LLM-based summarization of old rounds | Adds latency, cost, and complexity. Not needed until debates regularly exceed 4 rounds. | After budget manager ships. |
| Runtime event emissions in runners | Type infrastructure ships now (step 1). Actual `.emit()` calls wait until Runtime is wired to the server. | When server migration begins. |
| `ToolCallBlock` / `ToolResultBlock` content blocks | No agents currently produce tool calls during debate. Add when executor/builder roles are active. | When tool-calling agents ship. |
| Server API for conversation (`GET /api/jobs/:id/conversation`) | Useful but not blocking. Dashboard can read round files for now. | Next sprint after MVP. |
| `AgentContext.conversationSummary` / `recentMessages` fields | Part of budget manager. Not needed while using `formatHistory()` → `debate_history`. | With budget manager. |

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `conversationStore.append()` fails silently during protocol run | Low | Medium — debate continues but no history for next round | Catch in `toMessage()`, log warning, fall through. The protocol runner already handles `debateHistory` being empty. |
| `conversation.jsonl` grows large on long debates | Low | Low — file is read once per round, not per-token | Same scale as existing round JSON files. 10 rounds × ~5KB/message = ~50KB. Negligible. |
| Test suite breaks due to missing `conversationStore` in deps | High | Low — tests fail fast, easy to fix | Update all test fixtures that create `ProtocolExecutionDeps` to include `conversationStore: { append: async () => {}, loadByJob: async () => [] }` |
| EventBus generic param breaks downstream TypeScript consumers | Low | Low — type error, not runtime error | Default generic `= Record<string, unknown>` means unparameterized `new EventBus()` still compiles. |
| `events/types.ts` rename breaks `import` paths outside the barrel | Low | Medium — compile error | Only 2 internal files import directly from `./types.js`. Both updated in step 1. External consumers use `events/index.ts` barrel. |

---

## Validation strategy

### Automated (must pass before merge)

```
pnpm typecheck                # all packages compile
pnpm test                     # all existing tests pass
```

Plus new tests:

| Test file | What it covers |
|---|---|
| `storage/__tests__/conversation-store.test.ts` | append, loadByJob, filter by round/role, empty job, corrupt line skip |
| `events/__tests__/event-bus.test.ts` | Existing tests still pass with generic param. Add: typed emit/on with `DebateEventMap` and `RuntimeEventMap` separately. |
| `protocols/__tests__/single-challenger.test.ts` | Existing tests updated with `conversationStore` in deps. Add: verify `conversationStore.append()` called once per agent step. |
| `types/__tests__/types.test.ts` | Add: `AgentMessage` satisfies shape checks. `ContentBlock` discriminated union narrowing works. |

### Manual (before shipping)

```bash
# 1. Run a real debate
pnpm dev:cli run --target examples/untested-module.ts --provider auto

# 2. Check conversation log exists and is valid
cat .agent-orchestra/jobs/*/conversation.jsonl | head -5

# 3. Check round files still have architectOutput/reviewerOutputs
cat .agent-orchestra/jobs/*/rounds/round-0.json | jq '.architectOutput.findings | length'

# 4. Check findings output is identical to pre-change behavior
# (compare against a saved baseline if available)
```

### Success criteria

The MVP is done when:

1. `pnpm typecheck && pnpm test` passes with zero failures
2. A real `ao run` produces identical CLI output (same findings, same format)
3. `.agent-orchestra/jobs/{id}/conversation.jsonl` contains one `AgentMessage` per agent step
4. Each message has valid `id`, `sender`, `role`, `state`, `contentBlocks`, `timestamp`
5. Old jobs without `conversation.jsonl` still load and display correctly
6. `EventBus<DebateEventMap>` compiles. `EventBus<RuntimeEventMap>` compiles. `EventBus<FullEventMap>` compiles. Unparameterized `EventBus()` compiles.
