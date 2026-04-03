# AgentScope vs agent-orchestra: Concept Comparison

> Generated: 2026-04-03 | Reference: AgentScope v1.0 (modelscope/agentscope)

## How to read this document

AgentScope is studied as **inspiration**, not a migration target. Every recommendation is tied to a real gap or need in agent-orchestra's current codebase. "Adopt now" means the gap actively blocks planned work (runtime-first migration, general-purpose orchestration). "Adopt later" means useful but not blocking. "Ignore" means irrelevant or already solved differently.

---

## 1. Workflow Modeling

### AgentScope approach

Three primitives, no DSL:
- **SequentialPipeline** — chains agents linearly: output of A becomes input to B
- **FanoutPipeline** — broadcasts input to N agents concurrently via `asyncio.gather()`, collects all responses
- **MsgHub** — async context manager for broadcast-style group conversations; all participants auto-observe each other's messages

Conditional routing and loops are plain Python `if/else` and `while`. Python IS the workflow language — no DAG engine, no declarative YAML.

### Current agent-orchestra equivalent

- **SingleChallengerRunner** is a hardcoded sequential pipeline: `analysis -> review -> (rebuttal -> [apply] -> followup)* -> convergence -> [apply -> final_check]`. The loop is a `while (roundIndex < budget)`.
- **AutomationRunner** has a topological sort (`resolveOrder()`) for step dependencies — this is a basic DAG executor.
- **No composable pipeline primitives**. Each protocol is a monolithic `execute()` method.
- **No fan-out/parallel execution** within a protocol. Agents run one at a time even when independent.

### Comparison table

| AgentScope concept | What it does | Current equivalent | Gap | Recommendation | Why |
|---|---|---|---|---|---|
| **SequentialPipeline** | Chains agent calls linearly | Hardcoded in `SingleChallengerRunner.execute()` | No reusable primitive; each protocol reimplements sequencing | **Adopt later** | Only one protocol exists today. When a second protocol is added, extract a `sequential()` helper. Premature now. |
| **FanoutPipeline** | Parallel fan-out to N agents, gather results | None. Agents always run serially. | `reviewer_wave` protocol (declared in types but never implemented) would need this. | **Adopt later** | Blocked by the fact that only `single_challenger` exists. When `reviewer_wave` is built, add `Promise.all()`-based fan-out. Not a separate class — a helper function is enough in JS/TS. |
| **MsgHub broadcast** | All participants auto-observe all messages in a group context | `debateHistory: string[]` accumulates raw text and is passed to each prompt template | debate history is a flat string, not structured messages. Agents can't selectively observe. | **Adopt now** | See "Structured Messages" below. The flat string loses metadata (who said what, which round, which findings). Switching to structured message list solves this and enables future protocols. |
| **Code-first workflows** | No DAG DSL; Python control flow IS the workflow | Same — TypeScript `while` loops, `if/else` in protocol runner | No gap. Both frameworks are code-first. | **Ignore** | agent-orchestra already does this. No need for a DSL. |
| **Composable operators** | Pipelines can be nested and combined | Protocols are monolithic classes | Each protocol is self-contained (~350 lines). No shared step logic. | **Adopt later** | Refactor when a second protocol is added. Extract `runAgentStep()`, `runApplyStep()`, `runConvergenceStep()` as reusable building blocks. The current `runStep()` private method is already halfway there. |

---

## 2. Handoffs / Routing

### AgentScope approach

Three routing patterns:
- **Structured output routing**: Router agent returns a Pydantic model with `Literal` field → user code dispatches based on `msg.metadata`
- **Tool-based routing**: Downstream agents are wrapped as tool functions; router LLM picks which tool to call
- **Subscriber broadcasting**: MsgHub auto-forwards messages to all participants via `observe()`

No centralized dispatcher. All routing is either LLM-decided (via tool calls or structured output) or developer-decided (via code).

### Current agent-orchestra equivalent

- **IntentClassifier** does rule-based routing: regex/heuristics classify user message → `RunMode` (interactive, automation, background, verification) → dispatch to corresponding `Runner`. But it's dead code — never wired.
- **ProtocolRegistry** routes `Protocol` name → `ProtocolRunner` implementation. Static lookup, not dynamic.
- **No dynamic agent-to-agent handoff**. The protocol runner controls all agent invocations. Agents never decide who to call next.
- **No tool-based routing**. Agents can't invoke other agents as tools.

### Comparison table

| AgentScope concept | What it does | Current equivalent | Gap | Recommendation | Why |
|---|---|---|---|---|---|
| **Structured output routing** | LLM returns typed routing decision via constrained output | None. Protocol controls all routing statically. | Agents can't influence who runs next. | **Adopt later** | Current debate protocol is fixed-turn (architect, reviewer, architect, reviewer...). Dynamic routing only matters for general-purpose orchestration (Phase 5+). |
| **Tool-based agent dispatch** | Agent A calls Agent B via a tool function, gets result back | None. No agent-as-tool pattern. | Cannot compose agents dynamically. | **Adopt later** | Useful for the planner/executor pattern in `ROLE_DEFINITIONS`. When interactive orchestration is built, wrap agents as tool functions. Not needed for debate. |
| **IntentClassifier routing** | Rule-based request → runner mode dispatch | `IntentClassifier` exists but is dead code | Built but never wired to anything. | **Adopt now** | Wire `IntentClassifier` when the Runtime is activated. It already does the right thing — classify user intent and pick a runner mode. |
| **Subscriber broadcasting** | Agents auto-observe each other's messages in a group | `debateHistory[]` accumulates text, manually passed via templates | No automatic observation. Each agent only sees what the template explicitly includes. | **Adopt now** | Same as MsgHub point above. Replace `debateHistory: string[]` with a structured message log that all agents can query. |
| **No centralized hub** | Routing is code-level, not a central dispatcher | `Runtime` acts as a central dispatcher (routes to runners) | Slight mismatch: Runtime is hub-style, AgentScope is code-flow. | **Ignore** | Hub pattern (Runtime) is correct for agent-orchestra's server architecture. Keep it. |

---

## 3. Structured Messages

### AgentScope approach

`Msg` class with:
- `id` (auto UUID), `name` (sender), `role` (user/assistant/system), `timestamp`
- `content`: either a string or a list of `ContentBlock` (TextBlock, ThinkingBlock, ToolUseBlock, ToolResultBlock, ImageBlock, etc.)
- `metadata`: dict for structured output (Pydantic models serialized here)
- `ThinkingBlock` stripped before broadcasting (private reasoning stays private)

Messages are the universal currency — every agent receives and returns `Msg` objects.

### Current agent-orchestra equivalent

Two completely separate message systems:

**Debate side:**
- `AgentOutput` = `{ rawText, structuredSections, findings[], warnings[], usage, toolCalls, skillArtifacts }` — findings-centric, not a general message
- `ProviderOutput` = `{ rawText, structuredSections?, warnings?, usage?, exitCode?, stderrText? }` — provider response envelope
- `debateHistory: string[]` = flat text accumulation, not typed messages
- Round-level storage: `Round.architectOutput`, `Round.reviewerOutputs[]` — messages are stored per-agent-per-round, not as a message stream

**Runtime side:**
- `TranscriptEntry` = `{ id, role, timestamp, runId?, taskId?, toolName?, trustLevel, content }` — proper structured message with trust levels
- Content can be `string | Record<string, unknown>` — semi-structured

### Comparison table

| AgentScope concept | What it does | Current equivalent | Gap | Recommendation | Why |
|---|---|---|---|---|---|
| **Unified Msg type** | One message format for all inter-agent communication | `AgentOutput` (debate) and `TranscriptEntry` (runtime) are separate types with different shapes | No shared message type. Protocol runner manually marshals between template strings and AgentOutput. | **Adopt now** | This is the biggest structural gap. A unified `AgentMessage` type would serve both debate (replace `debateHistory: string[]`) and runtime (replace `TranscriptEntry.content: string`). It bridges the two worlds. |
| **ContentBlock union** | Typed blocks: text, thinking, tool_use, tool_result, image | `AgentOutput.rawText` is a flat string. `toolCalls` and `skillArtifacts` are separate arrays. | Agent output is not block-structured. Tool results, findings, and reasoning are all mixed in `rawText`. | **Adopt now** | Define `ContentBlock = TextBlock \| ThinkingBlock \| ToolCallBlock \| ToolResultBlock \| FindingBlock`. Parse `rawText` into blocks during normalization. This enables structured debate history and clean transcript logging. |
| **ThinkingBlock privacy** | Internal reasoning stripped before broadcast | None. Everything an agent says is visible to all subsequent agents. | No distinction between private reasoning and public findings. | **Adopt later** | Not critical for debate (architect/reviewer see everything). Becomes important for planner/executor pattern where planner's reasoning shouldn't leak to executor. |
| **metadata dict** | Structured output stored alongside message content | `AgentOutput.structuredSections: Record<string, string>` — string values only | Close equivalent. `structuredSections` is string-only; `metadata` supports arbitrary objects. | **Ignore** | Current `structuredSections` works fine for debate. No need to change the shape. |
| **Message ID + timestamp** | Every message has unique ID and timestamp | `TranscriptEntry` has `id` and `timestamp`. `AgentOutput` has neither. | Debate messages lack identity and temporal ordering. | **Adopt now** | Add `id` and `timestamp` to a unified `AgentMessage`. Enables deduplication, ordering, and cross-referencing between debate and runtime stores. |
| **Trust levels** | ThinkingBlock stripped = implicit trust boundary | `TranscriptEntry.trustLevel: 'system' \| 'trusted_meta' \| 'user_input' \| 'external' \| 'automation'` — explicit and richer | agent-orchestra's trust model is MORE sophisticated than AgentScope's. | **Ignore** | Keep current `TrustLevel` enum. It's better than AgentScope's implicit approach. |

---

## 4. Context / Memory Organization

### AgentScope approach

Two-tier:
- **Working memory** (`MemoryBase`): per-agent message store with "marks" for categorization. Implementations: in-memory, Redis, SQLAlchemy, Tablestore.
- **Long-term memory** (`LongTermMemoryBase`): vector-search-based retrieval. Modes: `static_control` (auto), `agent_control` (tool functions), `both`.

Context window management is agent-level (compression config: threshold, keep_recent, summary_schema) + formatter-level (FIFO truncation preserving tool_use/tool_result pairs).

Memory provides ONLY storage. Compression/truncation logic lives in the agent.

### Current agent-orchestra equivalent

- **ContextBuilder** assembles context for each agent call. Debate: `buildFor(agent, job)` → `AgentContext { role, mode, pinned, dynamic, evidence, skillContext }`. Runtime: `buildInteractiveContext()` etc.
- **ContextBudgetManager** interface (currently pass-through: `fitToLimit()` returns input unchanged).
- **TokenEstimator** interface (simple char-based approximation in CLI).
- **debateHistory: string[]** — flat text accumulation, trimmed to `MAX_DEBATE_HISTORY_CHARS = 40_000`.
- **TranscriptStore** — per-session message log (runtime side). Never used for context assembly.
- **No per-agent memory**. Each agent call is stateless — all context comes from the template + job data.
- **No long-term memory** across jobs.

### Comparison table

| AgentScope concept | What it does | Current equivalent | Gap | Recommendation | Why |
|---|---|---|---|---|---|
| **Per-agent working memory** | Each agent accumulates messages across turns | None. Agents are stateless; context is rebuilt from job data + templates each call. | Agent has no memory of previous turns except what's stuffed into the prompt template. | **Adopt now** | Replace `debateHistory: string[]` with a per-job message log (structured `AgentMessage[]`). Each agent prompt includes relevant prior messages from this log, selected by the context builder. This is NOT per-agent memory (overkill for debate) — it's a shared conversation log. |
| **Message marks/categories** | Tag messages for selective retrieval (e.g., "important", "compressed") | None. | Can't filter debate history by category (e.g., "only architect findings", "only rebuttals"). | **Adopt later** | Useful when debate history grows large and needs selective inclusion. Not critical with current `MAX_DEBATE_HISTORY_CHARS` approach. |
| **Long-term memory** | Cross-session vector-search memory | None. Jobs are independent. | No learning across review jobs. | **Ignore** | Not needed. Each code review is independent. Cross-job learning is a different product feature, not an orchestration concern. |
| **Agent-level compression** | When token count exceeds threshold, summarize older messages | `MAX_DEBATE_HISTORY_CHARS = 40_000` truncation (trim from start). `ContextBudgetManager.fitToLimit()` is a pass-through. | Truncation is character-based, not token-based. No summarization — just drops oldest content. | **Adopt now** | Implement real `fitToLimit()` in `ContextBudgetManager`: token-count trigger → summarize old rounds → keep recent N rounds intact. This directly improves debate quality on long reviews. |
| **Formatter-level FIFO truncation** | Provider-specific truncation preserving tool_use/tool_result pairs | None. Template renderer doesn't truncate. | If a prompt exceeds provider limits, it fails at the API level. | **Adopt later** | Currently handled by `MAX_DEBATE_HISTORY_CHARS`. When tool-calling agents are added (executor/builder roles), pair-aware truncation becomes necessary. |
| **Compression config** | Per-agent settings: threshold, keep_recent, summary_schema | No equivalent. Hardcoded 40K char limit. | Can't tune context strategy per agent or per job. | **Adopt later** | Move `MAX_DEBATE_HISTORY_CHARS` to `JobRuntimeConfig.contextBudget` and make it configurable. Add `keepRecentRounds` option. |
| **State persistence** | `state_dict()`/`load_state_dict()` for serialization across sessions | `FileJobStore.save()` persists full Job. `FileRoundStore` persists rounds. | Job state is persisted, but agent internal state is not (no agent memory to persist). | **Ignore** | Agents are stateless in agent-orchestra by design. Context is reconstructed from persisted Job + Rounds. No agent state to serialize. |

---

## 5. Role-Based Collaboration

### AgentScope approach

Roles are defined entirely through:
- **System prompts** — natural language role definition
- **Toolkit** — what tools an agent can use
- **Skills** — `SKILL.md` files registered via toolkit
- **Structured output** — Pydantic models constrain output format

No formal `Role` class. No permission system. No output contract enforcement. The LLM is trusted to follow its system prompt.

Collaboration patterns are code-level:
- **Debate**: MsgHub + while loop + moderator judge
- **Delegation**: orchestrator agent with `create_worker` tool
- **Routing**: structured output or tool-wrapped agents
- **Verification**: moderator agent with structured judgment model

### Current agent-orchestra equivalent

- **ROLE_DEFINITIONS** — formal `RoleDefinition` type: `{ role, description, allowedToolCategories, canMutateState, canAccessExternal, outputContract, defaultTimeoutMs }`. 7 roles defined (architect, reviewer, builder, planner, executor, verifier, researcher, operator).
- **AgentAssignment** — per-job agent binding with role, lens, provider, model, protocol.
- **OutputNormalizer** — parses raw LLM text into typed `AgentOutput` with findings.
- **ExecutionGuard** — validates that model actions match promises (promise-without-action detection).
- **No dynamic role switching**. Agent's role is fixed for the entire job.

### Comparison table

| AgentScope concept | What it does | Current equivalent | Gap | Recommendation | Why |
|---|---|---|---|---|---|
| **System prompt-only roles** | Roles defined purely in natural language, enforced by LLM compliance | `ROLE_DEFINITIONS` with formal constraints (tool categories, mutation rights, output contract) + system prompts via templates | agent-orchestra is MORE rigorous. Formal output contracts and tool permissions. | **Ignore** | Keep `ROLE_DEFINITIONS`. AgentScope's approach is too loose — relies entirely on LLM compliance. agent-orchestra's formal constraints are better for trust/safety. |
| **Toolkit per agent** | Each agent gets a different set of tools | `AgentAssignment` has `canWriteCode` and `allowReferenceScan` flags. `ROLE_DEFINITIONS` has `allowedToolCategories`. | Flags exist but are NOT enforced at runtime. `SingleChallengerRunner` never checks `canWriteCode` before calling an agent. | **Adopt now** | Enforce `ROLE_DEFINITIONS.allowedToolCategories` in the protocol runner. When an agent returns tool calls, validate them against the role's allowed categories. This is a safety improvement, not an abstraction exercise. |
| **Structured output models** | Pydantic model constrains LLM output format | `OutputNormalizer` parses free-form markdown into `AgentOutput`. `Finding` type is the expected structure. | Output is parsed post-hoc, not constrained at generation time. If the LLM produces malformed output, the normalizer returns `malformed: true`. | **Ignore** | Post-hoc parsing is the right approach for multi-provider support (Claude CLI, Codex CLI don't support structured output natively). Pydantic constraints only work with API-mode providers. |
| **Dynamic worker creation** | Orchestrator spawns agents on-demand via tool call | None. All agents are pre-declared in `Job.agents[]`. | Can't dynamically create sub-agents during a protocol run. | **Adopt later** | Useful for the planner/executor pattern. A planner agent could spawn executor sub-agents for independent tasks. Not needed for debate protocol. |
| **MsgHub debate pattern** | Broadcast + loop + moderator judgment | `SingleChallengerRunner` — fixed-turn debate with convergence detection | Functionally equivalent. agent-orchestra's is more structured (round-based, finding-centric). | **Ignore** | Current debate pattern works well. No need to adopt MsgHub's loose broadcast style. |
| **Agent hooks** (pre/post reply, observe, reasoning, acting) | Cross-cutting concerns: logging, filtering, transformation at agent lifecycle points | `EventBus` emits `round:start`, `agent:output:end` etc. at the protocol level, not the agent level. | Events are protocol-scoped, not agent-scoped. Can't hook into individual agent's reasoning process. | **Adopt later** | Useful for adding per-agent telemetry, cost tracking, or output filtering. Low priority. EventBus already covers the protocol-level needs. |
| **PlanNotebook** | Task decomposition with `SubTask` objects guiding sequential execution | `TaskState` in runtime types. `WorkflowStep[]` in automation runner. | Runtime has task decomposition. Debate doesn't need it. | **Ignore** | `WorkflowStep` in `AutomationRunner` already serves this purpose for automation. Debate doesn't decompose tasks. |

---

## Summary: Priority matrix

### Adopt now (blocks current work or is a clear safety/quality improvement)

| # | What to do | Why now |
|---|---|---|
| 1 | **Unified AgentMessage type** with id, timestamp, sender, role, content blocks | Bridges debate (`AgentOutput`) and runtime (`TranscriptEntry`). Required for runtime-first migration. Replaces `debateHistory: string[]` with structured data. |
| 2 | **ContentBlock union** (text, thinking, tool_call, tool_result, finding) | Enables structured debate history, clean transcript logging, and future multi-modal support. Parse during `OutputNormalizer` step. |
| 3 | **Shared conversation log per job** replacing `debateHistory: string[]` | Structured message list that `ContextBuilder` can query and filter. Replaces 40K char string concatenation with typed, ordered, filterable messages. |
| 4 | **Implement real `ContextBudgetManager.fitToLimit()`** | Currently a pass-through. Needs token counting + summarization of old rounds to prevent context overflow on long debates. |
| 5 | **Enforce `ROLE_DEFINITIONS` tool permissions** at runtime | `allowedToolCategories` and `canMutateState` are declared but never checked. Safety gap. |

### Adopt later (useful but not blocking)

| # | What to do | When |
|---|---|---|
| 6 | Fan-out parallel execution helper | When `reviewer_wave` protocol is implemented |
| 7 | Composable pipeline operators (`sequential()`, `parallel()`) | When second protocol is added; extract from `SingleChallengerRunner` |
| 8 | Dynamic agent-as-tool dispatch | When planner/executor interactive mode is built |
| 9 | ThinkingBlock privacy (strip reasoning before sharing) | When multi-role orchestration requires information hiding |
| 10 | Message marks/categories for selective history retrieval | When debate history exceeds current 40K limit frequently |
| 11 | Configurable compression settings per job | When `fitToLimit()` is implemented (follows #4) |
| 12 | Agent-level hooks (pre/post reply) | When per-agent telemetry or cost tracking is needed |

### Ignore (irrelevant or already solved better)

| # | What | Why ignore |
|---|---|---|
| DAG workflow DSL | agent-orchestra is already code-first; no need for a declarative DSL |
| Long-term cross-job memory | Code review jobs are independent; cross-job learning is a different product |
| System-prompt-only roles | `ROLE_DEFINITIONS` with formal constraints is stricter and better for trust |
| Pydantic-constrained output | Post-hoc parsing (`OutputNormalizer`) is correct for multi-provider support |
| State persistence (`state_dict`) | Agents are stateless by design; context reconstructed from Job + Rounds |
| PlanNotebook task decomposition | `WorkflowStep[]` already serves this for automation |
| MsgHub broadcast style | Fixed-turn debate with convergence detection is more controlled |
| Centralized hub avoidance | Runtime's hub pattern is correct for server architecture |

---

## Appendix: AgentScope source references

| Component | Location | Relevance |
|---|---|---|
| `Msg` class | `src/agentscope/message/_message_base.py` | Inspiration for unified AgentMessage type |
| `ContentBlock` types | `src/agentscope/message/_message_block.py` | Inspiration for ContentBlock union |
| `SequentialPipeline` | `src/agentscope/pipeline/_class.py` | Reference for composable pipeline helpers |
| `FanoutPipeline` | `src/agentscope/pipeline/_class.py` | Reference for parallel execution |
| `MsgHub` | `src/agentscope/pipeline/_msghub.py` | Inspiration for shared conversation log |
| `MemoryBase` | `src/agentscope/memory/_working_memory/_base.py` | Reference for memory interface design |
| `TruncatedFormatterBase` | `src/agentscope/formatter/_truncated_formatter_base.py` | Reference for pair-aware truncation |
| `ReActAgent.CompressionConfig` | `src/agentscope/agent/_react_agent.py` | Reference for configurable compression |
| `Toolkit` | `src/agentscope/tool/_toolkit.py` | Reference for tool-based agent dispatch |
