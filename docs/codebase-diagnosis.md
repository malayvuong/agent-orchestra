# Codebase Diagnosis: agent-orchestra

> Generated: 2026-04-03 | Commit: e88b85f (main)

## 1. What it is today

A **pnpm monorepo** with 4 packages + 2 apps:

| Package | Purpose |
|---|---|
| `packages/core` | All domain logic: types, orchestrator, protocols, storage, events, skills, runtime, guard |
| `packages/providers` | LLM provider adapters (Anthropic API, OpenAI API, Claude CLI, Codex CLI) |
| `packages/registry` | Skill registry client (calver, checksum, lockfile, installer) |
| `packages/shared` | Constants, version, calver utils, provider defaults |
| `apps/cli` | CLI (`ao run`, `ao init`, `ao job`, `ao serve`, `ao daemon`, etc.) |
| `apps/server` | HTTP API server + dashboard for jobs/runs/tasks/sessions/automation |

## 2. Main execution paths

### Path A — Debate (code review): `ao run --target <file>`

```
CLI run command
  -> resolveTarget() + readScope() + buildBaselineSnapshot()
  -> Orchestrator.createJob()
  -> Orchestrator.runJob()
    -> ProtocolRegistry.get("single_challenger")
    -> SingleChallengerRunner.execute()
      -> analysis -> review -> rebuttal -> [apply] -> [follow-up]* -> convergence -> [apply -> final_check]
```

Key files:
- `apps/cli/src/commands/run.ts` — CLI entry, wires all deps
- `packages/core/src/orchestrator/orchestrator.ts` — job lifecycle (create, run)
- `packages/core/src/protocols/single-challenger.ts` — the only implemented protocol (~350 lines)

### Path B — Runtime (general-purpose): not yet CLI-wired

```
Runtime.handleRequest()
  -> SessionStore get/create
  -> TranscriptStore log
  -> IntentClassifier -> RunMode
  -> Runner.execute() (InteractiveRunner | AutomationRunner)
    -> TaskClassifier + ExecutionGuard
```

Key files:
- `packages/core/src/runtime/runtime.ts` — session-aware request router
- `packages/core/src/runner/interactive-runner.ts` — single-turn model call with task tracking
- `packages/core/src/runner/automation-runner.ts` — workflow step execution with retry/topo-sort
- `packages/core/src/runtime/intent-classifier.ts` — rule-based intent -> RunMode routing

> **Note:** `Runtime` is instantiated nowhere in the CLI or server. The server uses stores directly.

## 3. Where things live

| Concern | Location | Debate-specific? |
|---|---|---|
| **Job lifecycle** | `core/types/job.ts`, `core/storage/job-store.ts` | Yes — `Job` has `protocol`, `rounds`, `agents`, `scope`, `decisionLog` |
| **Rounds** | `core/types/protocol.ts`, `core/storage/round-store.ts` | Yes — `Round` has `architectOutput`, `reviewerOutputs`, `builderOutput`, `clusterOutput` |
| **Agent roles** | `core/types/agent.ts`, `core/roles/role-definitions.ts` | Mixed — `DebateRole` (architect/reviewer/builder) is debate-specific; `GeneralRole` (planner/executor/verifier/researcher/operator) is reusable |
| **Findings** | `core/types/finding.ts`, `core/output/finding-parser.ts` | Yes — findings with actionability/confidence/evidence are debate output format |
| **Protocols** | `core/protocols/single-challenger.ts`, `core/protocols/registry.ts` | Yes — `SingleChallengerRunner` is pure debate orchestration |
| **Orchestrator** | `core/orchestrator/orchestrator.ts` | Yes — creates jobs, runs protocols; tightly coupled to `Job` + `ProtocolRunner` |
| **Events** | `core/events/event-bus.ts`, `core/events/types.ts` | Mixed — event bus mechanism is generic, but event types are debate-flavored (`round:start`, `agent:output`, `cluster:update`, `synthesis:ready`) |
| **Storage** | `core/storage/` | Two parallel systems: debate (`JobStore`, `RoundStore`) vs runtime (`RunStore`, `TaskStore`, `SessionStore`, `TranscriptStore`, `AutomationStore`) |
| **Context builder** | `core/context/context-builder.ts` | Mixed — `buildFor()` is debate-specific (needs `Job`, `AgentAssignment`); `buildInteractiveContext()`, `buildAutomationContext()`, `buildVerificationContext()` are generic |
| **Skills** | `core/skills/` (loader, parser, matcher, injector, executor, policy, sandbox, signing, hooks) | Reusable — fully generic skill system |
| **Superpowers** | `core/superpowers/` (catalog, loader, resolver) | Debate-specific — superpowers resolve to debate agent presets and protocols |
| **Templates** | `core/templates/` | Yes — prompt templates for architect-analysis, reviewer-by-lens, architect-rebuttal, etc. |
| **Runtime** | `core/runtime/runtime.ts`, `core/runtime/intent-classifier.ts` | Reusable — session-aware request router |
| **Runners** | `core/runner/interactive-runner.ts`, `core/runner/automation-runner.ts`, `core/runner/scheduler.ts` | Reusable — generic execution with task tracking |
| **Guard** | `core/guard/execution-guard.ts`, `core/guard/task-classifier.ts`, `core/guard/evidence-collector.ts` | Reusable — checks model behavior, not debate-specific |
| **Providers** | `packages/providers/` | Reusable — LLM adapter layer |
| **Tools** | `core/tools/tool-registry.ts` | Reusable — generic tool registry |
| **Projects** | `core/projects/project-registry.ts` | Reusable — central project listing |

## 4. The split: debate-specific vs reusable runtime foundation

### Debate-specific (would stay or become a "debate protocol plugin")

- `Job` type and `JobStore`
- `Round` type and `RoundStore`
- `Protocol`, `ProtocolRunner`, `ProtocolRegistry`, `SingleChallengerRunner`
- `Finding`, `FindingCluster`, `DecisionLog`
- `Orchestrator` (in its current form)
- All prompt templates (`architect-analysis`, `reviewer-by-lens`, `architect-rebuttal`, `architect-response`, `architect-apply`, `reviewer-followup`, `reviewer-final-check`, `synthesis`)
- `Superpowers` (resolve debate presets)
- `AgentOutput` shape (findings-centric)
- Debate-flavored events (`round:start`, `round:complete`, `cluster:update`, `synthesis:ready`)
- CLI `run` command wiring
- CLI `job` command (job inspection)

### Reusable runtime foundation (already exists, could be promoted)

- `Runtime` (session + transcript + runner dispatch + guard)
- `InteractiveRunner`, `AutomationRunner`, `Scheduler`
- `RunRecord`, `TaskState`, `SessionState`, `TranscriptEntry` types
- `RunStore`, `TaskStore`, `SessionStore`, `TranscriptStore`
- `ExecutionGuard`, `TaskClassifier`, `EvidenceCollector`
- `IntentClassifier`
- `EventBus` (the mechanism, not the debate event types)
- `ContextBuilder` (the interactive/automation/verification methods)
- Entire `skills/` subsystem (loader, parser, matcher, injector, executor, policy, sandbox, signing, hooks)
- Entire `providers/` package (Anthropic, OpenAI, Claude CLI, Codex CLI adapters)
- `tools/tool-registry.ts`
- `roles/role-definitions.ts` (general roles: planner, executor, verifier, researcher, operator)
- `projects/project-registry.ts`
- `packages/shared` (constants, version, calver)
- `packages/registry` (skill registry client)

## 5. Key architectural observations

### 5.1 Two parallel worlds in core

The original debate engine (`Job`/`Round`/`Protocol`/`Orchestrator`) and the newer Phase 4 runtime (`Runtime`/`Runner`/`Session`/`Task`) coexist in `packages/core` with minimal cross-references. Only `InteractiveRunner` mentions the orchestrator — in a comment.

### 5.2 CLI only uses the debate path

`ao run` goes straight to `Orchestrator` -> `SingleChallengerRunner`. The `Runtime` class is never instantiated by any CLI command or the server.

### 5.3 Server uses both systems independently

The server exposes debate jobs through `JobStore`/`RoundStore` AND runtime entities through `RunStore`/`TaskStore`/`SessionStore`, but they never connect to each other.

### 5.4 Storage is file-based with clean interfaces

All stores are JSON-on-disk (`FileJobStore`, `FileRunStore`, etc.). The interface layer (`JobStore`, `RunStore`, etc.) is clean enough to swap backends without changing consumers.

### 5.5 Only one protocol implemented

`SingleChallengerRunner` is the only protocol. The `ProtocolRegistry` supports registration of additional protocols but none exist beyond `single_challenger`.

### 5.6 Skills system is fully generic

Loading, matching, injection, execution (MCP transports: stdio, SSE, streamable-http), policy engine, sandboxing (Docker), signing, hooks — none of this is debate-specific. This is the most reusable subsystem.

### 5.7 ContextBuilder serves two masters

`buildFor()` takes `Job` + `AgentAssignment` (debate world). `buildInteractiveContext()` / `buildAutomationContext()` / `buildVerificationContext()` take runtime types. This is a natural seam for separation.

### 5.8 Provider layer is fully abstracted

`packages/providers` exposes a `ProviderRouter` with `forAgent()` dispatch. Supports API-based providers (Anthropic, OpenAI) and CLI-based providers (Claude CLI, Codex CLI). Detection logic auto-selects based on available binaries/API keys.

## 6. File tree (source only)

```
apps/
  cli/
    src/
      commands/       # run, init, job, serve, skills, audit, policy, superpowers, automation, daemon, setup, project
      init/           # detect, confirm, generate, agents-config, builtin-skills
      jobs/           # compare-runs
      mcp/            # MCP server handlers + tools
      providers/      # resolve-provider (CLI-level provider wiring)
      superpowers/    # resolve-run-skills
      targeting/      # resolve-target, read-scope, build-baseline-snapshot, markdown-links
      apply/          # parse-apply-output
      utils/          # token-estimator
      index.ts        # entry
      program.ts      # commander setup
  server/
    src/
      index.ts        # HTTP API + router
      dashboard.ts    # HTML dashboard

packages/
  core/
    src/
      types/          # agent, job, protocol, finding, output, context, runtime, orchestrator
      interfaces/     # protocol-runner, context-budget-manager, output-normalizer, cancellation-registry, token-estimator
      orchestrator/   # orchestrator, cancellation
      protocols/      # single-challenger, registry
      storage/        # job-store, round-store, run-store, task-store, session-store, transcript-store, automation-store, event-logger, runtime-store (interfaces), types (interfaces)
      events/         # event-bus, persisted-event-bus, types
      context/        # context-builder
      output/         # normalizer, finding-parser
      templates/      # loader, renderer, defaults/ (8 prompt templates)
      roles/          # role-definitions
      skills/         # loader, parser, matcher, injector, types, skillset-loader, executor/, hooks/, policy/, sandbox/, signing/
      superpowers/    # catalog, loader, resolver, builtin, types
      guard/          # execution-guard, task-classifier, evidence-collector
      runner/         # interactive-runner, automation-runner, scheduler, types
      runtime/        # runtime, intent-classifier
      tools/          # tool-registry
      apply/          # parse-apply-output
      observability/  # logger
      projects/       # project-registry
  providers/
    src/
      anthropic/      # adapter
      openai/         # adapter
      cli/            # claude-cli, codex-cli, detect
      router.ts       # ProviderRouter
      types.ts
      default-models.ts
  registry/
    src/              # client, installer, lockfile, calver, checksum, types
  shared/
    src/              # constants, version, calver, errors, provider-defaults
```

## 7. Dependency ownership map

### 7.1 Core module dependency graph

Arrows read "X imports from Y". Only production imports (not test files).

```
                        ┌──────────┐
                        │  types/  │  (imported by ALL 18 modules)
                        └────┬─────┘
               ┌─────────┬──┴──┬──────────┬──────────┐
               v         v     v          v          v
          interfaces/  guard/  events/  templates/  roles/
               │                                     │
               v                                     v
            output/                               tools/
               │
       ┌───────┴────────┐
       v                v
   protocols/     orchestrator/
       │                │
       v                v
   storage/        ProtocolRegistry
   (debate)
       │
       └───────> events/ (emit round:start, etc.)

   ─── runtime side (parallel) ────

   types/runtime.ts
       │
       v
     guard/ ──> runner/ ──> runtime/
                  │
                  v
              storage/
           (RunStore, TaskStore,
            SessionStore, etc.)
```

### 7.2 Cross-package imports

| Consumer | Imports from |
|---|---|
| `apps/cli` | `core` (Orchestrator, storage, skills, superpowers, projects, events, context, output), `providers`, `shared` |
| `apps/server` | `core` (storage implementations, AutomationRunner, projects, superpowers catalog), `shared` |
| `packages/core` | `shared` (version, errors) |
| `packages/providers` | `shared` (default models) |
| `packages/registry` | `shared` (calver) |

### 7.3 What each core module exports and who consumes it

| Module | Key exports | Used by apps? | Used by other core modules? |
|---|---|---|---|
| `types/` | 60+ types (Job, Round, Finding, AgentAssignment, RunRecord, TaskState, SessionState, etc.) | Yes (cli, server — type imports) | Yes (all modules) |
| `interfaces/` | ProtocolRunner, ContextBudgetManager, OutputNormalizer, CancellationRegistry, TokenEstimator | No | protocols, orchestrator, skills, context |
| `orchestrator/` | Orchestrator, DefaultCancellationRegistry | Yes (cli `run` command) | No |
| `protocols/` | SingleChallengerRunner, ProtocolRegistry | Yes (cli `run` command) | orchestrator |
| `storage/` | FileJobStore, FileRoundStore, FileRunStore, FileTaskStore, FileSessionStore, FileTranscriptStore, FileAutomationStore, EventLogger | Yes (cli, server) | runner, runtime |
| `events/` | EventBus, PersistedEventBus | Yes (cli `run` command uses EventBus) | protocols (emit events) |
| `context/` | ContextBuilder | No (only via type reference in orchestrator.ts) | orchestrator (via ProtocolExecutionDeps) |
| `output/` | DefaultOutputNormalizer, parseFindingsFromMarkdown | Yes (cli `run` command) | No |
| `templates/` | renderTemplate, TemplateLoader, 8 default templates | No | protocols (SingleChallengerRunner) |
| `roles/` | ROLE_DEFINITIONS, getRoleDefinition | No | tools |
| `skills/` | SkillLoader, SkillParser, SkillMatcher, SkillInjector, PolicyEngine, SkillExecutor, etc. (50+) | Yes (cli skills/policy commands) | context, superpowers |
| `superpowers/` | loadSuperpowerCatalog, SuperpowerResolver | Yes (cli run/superpowers commands, server) | No |
| `guard/` | ExecutionGuard, TaskClassifier, collectEvidence | No | runner, runtime |
| `runner/` | InteractiveRunner, AutomationRunner, Scheduler | Yes (server uses AutomationRunner) | runtime |
| `runtime/` | Runtime, IntentClassifier | No | No |
| `tools/` | ToolRegistry | No | No |
| `apply/` | parseApplyOutput | No | protocols |
| `observability/` | FileLogger | No | No |
| `projects/` | registerProject, listProjects, unregisterProject, touchProject | Yes (cli, server) | No |

### 7.4 Circular dependency analysis

All identified cycles are **type-only** (safe in TypeScript, no runtime issues):

1. `types/orchestrator.ts` references `ContextBuilder` type -> `context/` imports `types/`
2. `types/output.ts` imports `ToolCall`, `SkillArtifact` from `skills/executor/types` -> `skills/` imports `types/`
3. `storage/automation-store.ts` imports `AutomationJobDefinition` from `runner/types` -> `runner/` imports `storage/`

No runtime circular dependencies exist.

## 8. Coupling hotspots

### 8.1 Classification of every core module

| Classification | Modules |
|---|---|
| **DEBATE-only** | `orchestrator/`, `protocols/`, `templates/`, `superpowers/`, `output/`, `apply/` |
| **RUNTIME-only** | `runtime/`, `runner/`, `guard/` |
| **REUSABLE** (mode-agnostic) | `events/` (mechanism), `skills/`, `tools/`, `observability/`, `projects/`, `providers` (package), `shared` (package), `registry` (package) |
| **MIXED** (the hotspots) | `context/context-builder.ts`, `types/index.ts`, `storage/` (split stores), `roles/role-definitions.ts`, `events/types.ts` |

### 8.2 The two hotspot files

**1. `context/context-builder.ts`** — the critical coupling point

This file imports from both worlds:
- Debate: `Job`, `AgentAssignment`, `SkillMatcher`, `SkillInjector`
- Runtime: `SessionState`, `TaskState`, `RunRecord`, `AutomationJobDefinition`

It serves both with separate methods:
- `buildFor(agent, job)` — debate context
- `buildInteractiveContext(session, task)` — runtime context
- `buildAutomationContext(job)` — runtime context
- `buildVerificationContext(task, run)` — runtime context

**Recommendation:** Split into `DebateContextBuilder` and `RuntimeContextBuilder`. The skill matching logic stays with debate (skills match on `AgentAssignment.role`).

**2. `types/index.ts`** — the barrel export

Re-exports everything from both worlds in one barrel. Forces any consumer that imports one type to accept the entire type surface.

**Recommendation:** Split into `types/debate.ts` re-export and `types/runtime.ts` re-export, keeping `types/index.ts` as a union for backwards compatibility.

### 8.3 Cross-boundary import analysis

| Direction | Count | Details |
|---|---|---|
| Runtime -> Debate | **0** | Clean. No runtime module imports debate types. |
| Debate -> Runtime | **0** | Clean. No debate module imports runtime types. |
| Mixed files | **2** | `context-builder.ts` and `types/index.ts` |
| Shared infra -> either | **0** | skills/, events mechanism, tools/ are mode-agnostic |

### 8.4 The events/types.ts debt

All event types in `events/types.ts` are debate-flavored:

```
job:update      -> JobStatus
round:start     -> RoundState
round:complete  -> RoundState
agent:output    -> chunk
agent:output:end -> AgentOutput (findings)
cluster:update  -> FindingCluster[]
synthesis:ready -> jobId
error           -> error string
```

Runtime has no events at all. When Runtime needs to emit events (task status changes, run completion, guard violations), it will either:
- Create a parallel event system (duplication)
- Extend this debate-tied union (couples runtime to debate concepts)

**Recommendation:** Extract `EventBus` as a generic typed emitter. Define debate events and runtime events as separate `EventMap` types. Compose them where both are needed.

## 9. Dead code & unused exports

### 9.1 Exported but never imported outside tests

| Symbol | Exported from | Used in prod code? | Used in tests? | Verdict |
|---|---|---|---|---|
| `Runtime` | `core/runtime/` | No | Yes (1 test file) | **Dead** — built but never wired |
| `IntentClassifier` | `core/runtime/` | No | Yes (1 test file) | **Dead** — built but never wired |
| `InteractiveRunner` | `core/runner/` | No | Yes (1 test file) | **Dead** — built but never wired |
| `Scheduler` | `core/runner/` | No | Yes (1 test file) | **Dead** — built but never wired |
| `ExecutionGuard` | `core/guard/` | Only by `runtime.ts` (itself dead) | Yes | **Dead** — transitively unused |
| `TaskClassifier` | `core/guard/` | Only by `InteractiveRunner` (dead) | Yes | **Dead** — transitively unused |
| `collectEvidence` | `core/guard/` | Only by `InteractiveRunner` (dead) | Yes | **Dead** — transitively unused |
| `PersistedEventBus` | `core/events/` | No | Yes (1 test file) | **Dead** — never used in prod |
| `FileLogger` | `core/observability/` | No | Yes (1 test file) | **Dead** — never used in prod |
| `ToolRegistry` | `core/tools/` | No | Yes (1 test file) | **Dead** — never used in prod |
| `ROLE_DEFINITIONS` | `core/roles/` | Only by `ToolRegistry` (dead) | Yes | **Dead** — transitively unused |
| `getRoleDefinition` | `core/roles/` | Only by `ToolRegistry` (dead) | Yes | **Dead** — transitively unused |
| `ContextBuilder` | `core/context/` | Only via type ref in `orchestrator.ts`; never instantiated outside cli `run` | Yes | **Partially alive** — used in cli `run`, but runtime methods never called |
| `DefaultOutputNormalizer` | `core/output/` | Only in cli `run` and `mcp/handlers` | — | Alive |
| `parseFindingsFromMarkdown` | `core/output/` | No (not imported by any app) | — | **Dead** |

### 9.2 Risk assessment

| Risk level | Category | Description |
|---|---|---|
| **HIGH** | Phase 4 runtime stack | `Runtime`, `InteractiveRunner`, `Scheduler`, `IntentClassifier`, `ExecutionGuard`, `TaskClassifier`, `EvidenceCollector` — 7 classes + 3 types files, fully implemented, fully tested, zero production callers. This is ~600 lines of live code with no path to execution. |
| **MEDIUM** | Infrastructure modules | `ToolRegistry`, `ROLE_DEFINITIONS`, `FileLogger`, `PersistedEventBus` — 4 modules built for future use, tested, but never wired. ~300 lines. |
| **LOW** | Utility exports | `parseFindingsFromMarkdown` — exported but unused. Single function. |
| **NONE** | `packages/registry` | Only imported by `apps/cli/src/commands/skills.ts`. Alive but narrow usage. |

### 9.3 Examples directory

- `examples/flawed-plan.md` — sample plan for plan-review testing (alive: used with `--superpower plan-review`)
- `examples/untested-module.ts` — sample target file for testing `ao run` (alive)
- `examples/vulnerable-server.ts` — sample target for security lens review (alive)

All examples are functional test fixtures, not stale.

## 10. Migration recommendation

### 10.1 The core question

The codebase has two futures:
1. **Stay debate-first:** agent-orchestra remains a multi-agent code review tool, runtime modules are deleted or deferred indefinitely.
2. **Become runtime-first:** agent-orchestra becomes a general-purpose agent orchestration framework, with debate as one protocol plugin among many.

The code structure already implies option 2 (Phase 4 built the runtime stack), but nothing actually uses it.

### 10.2 If going runtime-first: recommended migration order

**Step 1 — Extract debate into a protocol plugin**

Move debate-specific code into `packages/debate/` (or `packages/protocol-debate/`):
- `types/job.ts`, `types/protocol.ts`, `types/finding.ts`
- `orchestrator/`, `protocols/`, `templates/`, `superpowers/`, `output/`, `apply/`
- `storage/job-store.ts`, `storage/round-store.ts`, `storage/types.ts` (debate interfaces)
- Debate event types (extract from `events/types.ts`)

What stays in `packages/core`:
- `types/agent.ts` (generalize: remove DebateRole dependency, keep AgentRole as union)
- `types/runtime.ts`, `types/context.ts` (runtime types)
- `storage/` (runtime stores only)
- `events/` (generic EventBus + runtime events)
- `runner/`, `runtime/`, `guard/`, `context/` (runtime stack)
- `skills/`, `tools/`, `roles/`, `observability/`, `projects/`
- `interfaces/` (remove ProtocolRunner, keep the rest)

**Step 2 — Wire Runtime into the server**

Replace direct store access in `apps/server/src/index.ts` with `Runtime.handleRequest()`. The server becomes a thin HTTP adapter over `Runtime`:

```
HTTP request -> parse -> Runtime.handleRequest() -> RunnerResult -> HTTP response
```

Benefits:
- Session management automated
- Transcript logging automated
- ExecutionGuard enforced
- EventBus available for future WebSocket/SSE

**Step 3 — Wire Runtime into the CLI**

Add a new `ao chat` or `ao task` command that uses `Runtime` + `InteractiveRunner` for general-purpose agent tasks (not debate).

**Step 4 — Make debate a registered runner**

Create a `DebateRunner implements Runner` that wraps the existing `Orchestrator` + `SingleChallengerRunner`. Register it as a runner mode in `Runtime`:

```typescript
runtime.registerRunner(new InteractiveRunner(...))
runtime.registerRunner(new AutomationRunner(...))
runtime.registerRunner(new DebateRunner(...))  // wraps Orchestrator
```

Then `ao run --target <file>` routes through Runtime -> DebateRunner instead of directly calling Orchestrator.

### 10.3 If staying debate-first

Delete the dead runtime stack:
- `runtime/runtime.ts`, `runtime/intent-classifier.ts`
- `runner/interactive-runner.ts`, `runner/scheduler.ts`
- `guard/execution-guard.ts`, `guard/task-classifier.ts`, `guard/evidence-collector.ts`
- `tools/tool-registry.ts`, `roles/role-definitions.ts` (general roles)
- `observability/logger.ts`
- `events/persisted-event-bus.ts`
- Runtime storage: `run-store.ts`, `task-store.ts`, `session-store.ts`, `transcript-store.ts`, `runtime-store.ts`
- Runtime types: `types/runtime.ts`
- `context/context-builder.ts` — remove `buildInteractiveContext`, `buildAutomationContext`, `buildVerificationContext`

Keep `AutomationRunner` (used by server and CLI automation commands).

This would remove ~1500 lines of dead code and simplify the package surface.

## 11. Server architecture: runtime-first vs dual-mode

### 11.1 Current server state

The server is a **store-centric REST API** with no orchestration logic:

| Endpoint group | Store used | Connects to Runtime? |
|---|---|---|
| `/api/jobs`, `/api/jobs/:id` | JobStore, RoundStore | No |
| `/api/runs`, `/api/runs/:id` | RunStore | No |
| `/api/tasks` | TaskStore | No |
| `/api/sessions` | SessionStore, TranscriptStore | No |
| `/api/automation` | AutomationStore, RunStore | No (uses AutomationRunner directly) |
| `/api/projects` | project-registry | No |
| `/api/superpowers` | superpower catalog | No |
| `/` (dashboard) | N/A (HTML SPA) | No |

No EventBus. No WebSocket/SSE. No guard enforcement. No transcript logging.

### 11.2 Recommendation: runtime-first

**Dual-mode** (serving both debate and runtime as parallel systems) is the current de facto state, and it creates confusion:
- Two store systems that never connect
- Automation wired directly (bypassing Runtime)
- No session lifecycle management
- Dashboard shows disconnected data from two worlds

**Runtime-first** is the better path because:

1. **Runtime already abstracts the right things**: sessions, transcripts, guard, runner dispatch. The server is manually reimplementing what Runtime provides.

2. **Debate becomes one mode**: `Runtime.handleRequest({ requestedMode: 'debate' })` dispatches to a `DebateRunner` that wraps the existing `Orchestrator`. Jobs and rounds are still persisted, but they're now connected to a session and transcript.

3. **One event system**: Runtime can emit events (`task:started`, `run:completed`, `guard:violation`) alongside debate events (`round:start`, `synthesis:ready`). Dashboard subscribes to one EventBus.

4. **Path to real-time**: Once the server routes through Runtime, adding WebSocket/SSE is a matter of bridging EventBus to the transport layer. Currently impossible without reimplementing event propagation.

5. **No data loss**: All existing stores and data remain. The migration is additive — Runtime wraps existing stores, doesn't replace them.

### 11.3 Migration risk

| Risk | Severity | Mitigation |
|---|---|---|
| Breaking server API contract | Low | HTTP endpoints stay the same; only internal routing changes |
| Debate job creation flow | Medium | DebateRunner must accept the same params as current `ao run` wiring |
| Dashboard compatibility | Low | Dashboard reads from same stores; API responses unchanged |
| AutomationRunner double-wiring | Low | Remove direct instantiation in server; let Runtime dispatch |
| Session creation overhead | Low | Minimal — one JSON file write per session |
