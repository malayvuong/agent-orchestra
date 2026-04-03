# Agent Orchestra — Project Document

> Version: 2026.4.4 | Last updated: 2026-04-03

---

## 1. What is Agent Orchestra

Agent Orchestra is a multi-agent runtime for code review, automation, and orchestrated AI workflows. It coordinates multiple AI agents — each with a defined role, lens, and tool permissions — to analyze, debate, and act on code and plans.

The system runs as a CLI tool (`ao`), an MCP tool server, or a web dashboard with REST API.

### Core capabilities

- **Multi-agent code review** — Architect analyzes, reviewer challenges through a focused lens (security, testing, performance, etc.), they debate iteratively, acknowledged findings get patched.
- **Automation workflows** — Define step-based jobs (scripts, tool calls, conditional logic) with dependency ordering, retry, and scheduling.
- **Skill system** — Injectable prompts and MCP tool bindings, matched to agents by role/lens/keywords. Skills follow the Agent Skills standard (SKILL.md with YAML frontmatter).
- **Policy engine** — Deny-by-default capability system. Controls what tools each agent role can access.
- **Execution guard** — Catches "model promised but didn't act" by validating tool calls against task requirements.
- **Project management** — Central registry of workspaces across the machine, with per-project storage.

---

## 2. Architecture

### System layers

```
 Entrypoint          CLI commands, MCP tools, cron triggers, webhooks
      |
   Runtime            Session management, request routing,
      |               transcript logging, execution guard
      |
   Runners            InteractiveRunner    AutomationRunner    SingleChallengerRunner
      |               (user tasks)         (workflow jobs)      (debate protocol)
      |
 Infrastructure       Providers, Skills, Tools, Policy, Events, Storage
```

### Monorepo structure

```
packages/
  core/           Domain logic — types, orchestrator, protocols, storage,
                  events, skills, runtime, guard, context, templates
  providers/      LLM adapters — Anthropic API, OpenAI API, Claude CLI, Codex CLI
  registry/       Skill registry client — calver, checksum, lockfile, installer
  shared/         Constants, version, errors, provider defaults

apps/
  cli/            CLI application (commander-based)
  server/         HTTP API server + embedded web dashboard
```

### Package dependency graph

```
shared  <---  core  <---  cli
  ^            ^           |
  |            |           v
  +-- providers  <---------+
  |
  +-- registry  <--- cli (skills commands only)
```

All packages are TypeScript, built with `tsup`, tested with `vitest`.

---

## 3. The Debate Engine

### How a review works

```bash
ao run --target ./src/auth.ts --lens security --auto-apply
```

1. **Target resolution** — Resolve the target path, discover related files (imports, markdown links), build a baseline snapshot with SHA-256 checksums.

2. **Job creation** — Create a `Job` record with protocol, scope, agent assignments, and runtime config. Persisted to `.agent-orchestra/jobs/{jobId}/job.json`.

3. **Protocol execution** — The `SingleChallengerRunner` drives the debate:

```
  analysis        Architect analyzes the target code
      |
  review          Reviewer challenges through the selected lens
      |
  rebuttal        Architect responds — acknowledge, dispute, or discover new issues
      |
 [apply]          If --auto-apply: patch files with acknowledged findings
      |
  follow-up       Reviewer re-reads patched code, continues debate
      |           (loop until convergence or round budget exhausted)
  convergence     Deduplicate and synthesize all findings
      |
 [apply]          Final patch round if auto-apply is on
      |
  final_check     Reviewer compares final artifact against original baseline
```

4. **Output** — Findings classified by actionability (`must_fix_now`, `follow_up_candidate`, `note_only`) and confidence (`high`, `medium`, `low`), with file/line evidence.

### Agents and roles

Each agent has a **role** that defines its capabilities:

| Role | Purpose | Can read | Can write | Can exec |
|------|---------|----------|-----------|----------|
| `architect` | Analyze targets, defend design | Yes | No | No |
| `reviewer` | Challenge findings through a lens | Yes | No | No |
| `builder` | Apply accepted fixes to code | Yes | Yes | Yes |

Reviewers have a **lens** that focuses their analysis:

`logic` | `consistency` | `regression` | `testing` | `performance` | `security` | `cross_system_contract` | `scope` | `dependency` | `sequencing` | `simplification` | `risk` | `implementation_readiness`

### Superpowers

Superpowers are curated presets that bundle skills, lenses, and agent configuration:

| Superpower | Category | Best for |
|---|---|---|
| `plan-review` | review | Specs, plans, RFCs — checks sequencing, scope, dependencies |
| `security-review` | review | OWASP Top 10, auth, injection, secrets |
| `test-generation` | review | Missing tests, edge cases, coverage gaps |
| `dependency-audit` | analysis | Package risk, license compliance, supply chain |

Usage:
```bash
ao run --target ./docs/spec.md --superpower plan-review
```

Superpowers set defaults; explicit CLI flags always override them.

### Conversation log

Each debate produces a structured conversation log at `.agent-orchestra/jobs/{jobId}/conversation.jsonl`. Each line is a JSON `AgentMessage` with:

```json
{
  "id": "uuid",
  "jobId": "job-uuid",
  "roundIndex": 0,
  "sender": "architect-1",
  "role": "architect",
  "state": "analysis",
  "timestamp": "2026-04-03T10:00:00.000Z",
  "contentBlocks": [
    { "type": "text", "text": "..." },
    { "type": "finding", "finding": { "id": "f-1", "title": "...", ... } }
  ],
  "findingCount": 3,
  "warnings": [],
  "usage": { "inputTokens": 1200, "outputTokens": 800 }
}
```

Query with `jq`:
```bash
# All reviewer messages
jq 'select(.role=="reviewer")' .agent-orchestra/jobs/*/conversation.jsonl

# Findings count per round
jq '{round: .roundIndex, role: .role, findings: .findingCount}' .agent-orchestra/jobs/*/conversation.jsonl
```

### Providers

| Provider | Type | Default model | Auto-detected by |
|---|---|---|---|
| `claude-cli` | CLI | `claude-opus-4-6` | `claude` binary in PATH |
| `codex-cli` | CLI | `gpt-5.4` | `codex` binary in PATH |
| `anthropic` | API | `claude-sonnet-4-6` | `ANTHROPIC_API_KEY` env var |
| `openai` | API | `gpt-5.4` | `OPENAI_API_KEY` env var |

Per-agent provider overrides:
```bash
ao run --target ./src/ \
  --architect-provider claude-cli --architect-model claude-opus-4-6 \
  --reviewer-provider codex-cli --reviewer-model gpt-5.4
```

---

## 4. The Runtime System

Beyond the debate engine, Agent Orchestra has a general-purpose runtime layer for sessions, tasks, and automation.

### Sessions

A `SessionState` groups related runs. Types: `interactive`, `cron`, `subagent`, `background`.

### Runs

Every execution — debate, automation, or interactive — produces a `RunRecord`:
- Run ID, session ID, task ID
- Source (`chat`, `cron`, `webhook`, `system`, `subagent`)
- Status, timing, tool calls, guard violations, failure reason

### Tasks

A `TaskState` tracks what needs to be done independently of chat context:
- Title, objective, execution-required flag
- Status: `queued` | `running` | `blocked` | `waiting` | `done` | `failed`
- Evidence of work, blockers, resume hints

### Transcripts

Append-only JSONL log per session. Each entry has a trust level:

| Trust level | Meaning |
|---|---|
| `system` | Internal system messages |
| `trusted_meta` | Metadata from trusted sources |
| `user_input` | Direct user messages |
| `external` | Content from web/files |
| `automation` | Events from cron/automated sources |

### Execution guard

A response filter between model output and delivery:
1. `TaskClassifier` determines if the task requires action
2. After the model responds, the guard checks: were tools actually called?
3. If the task requires action but the model only made promises ("I'll do it now") without calling tools, the response is blocked
4. The guard checks for evidence — tool output, file reads, command results

### Intent classifier

Rule-based routing of user requests to the correct runner mode:

| Intent | Detected by | Routes to |
|---|---|---|
| `code_review` | "review", "check this code" | InteractiveRunner |
| `code_task` | Default for action requests | InteractiveRunner |
| `question` | "what is", "explain", "how does" | InteractiveRunner |
| `automation_setup` | "schedule", "every", "cron" | AutomationRunner |
| `background_task` | Explicit mode override | Background runner |
| `verification` | Explicit mode override | Verification runner |

### General roles

For non-debate orchestration, additional roles are defined:

| Role | Purpose | Tool access |
|---|---|---|
| `planner` | Decomposes tasks, decides delegation | Read only |
| `executor` | Runs tools, edits files | Read + Write + Exec |
| `verifier` | Checks whether work happened | Read only |
| `researcher` | Fetches docs, web info | Read + External |
| `operator` | Background/cron jobs | All categories |

---

## 5. Automation System

### Job definition

```json
{
  "id": "nightly-tests",
  "name": "Nightly Test Suite",
  "schedule": "every 1d",
  "trigger": "cron",
  "enabled": true,
  "workflow": [
    {
      "id": "step-1",
      "type": "script",
      "name": "Run tests",
      "config": { "command": "npm test" },
      "timeoutMs": 60000,
      "retryCount": 2
    },
    {
      "id": "step-2",
      "type": "script",
      "name": "Generate report",
      "config": { "command": "npm run coverage-report" },
      "dependsOn": ["step-1"]
    }
  ]
}
```

### Step execution

Steps execute in topological order based on `dependsOn`. Each step:
- Is logged as a `ToolCallRecord` on the run
- Has optional timeout and retry count
- Fails fast after exhausting retries (stops the entire workflow)

### CLI commands

```bash
ao automation list              # List all registered jobs
ao automation add <file>        # Register from JSON definition
ao automation run <jobId>       # Run immediately
ao automation enable <jobId>    # Enable scheduled execution
ao automation disable <jobId>   # Disable
ao automation logs <jobId>      # Show run history
```

### Scheduling

The `Scheduler` class manages `setTimeout`-based interval scheduling. Supports `every 5m`, `every 1h`, `every 1d` format.

---

## 6. Skill System

### What is a skill

A skill is a directory containing a `SKILL.md` file with YAML frontmatter and a markdown body:

```markdown
---
name: Security Review
description: OWASP Top 10 checklist for code review
version: 2026.3.1
license: MIT
triggers:
  lenses: [security]
  keywords: [auth, injection, csrf]
---

When reviewing code for security issues, check for:
1. SQL injection via string concatenation
2. XSS through unescaped output
...
```

Skills live in `.agent-orchestra/skills/` or can be installed from git URLs.

### Skill lifecycle

```
  Load (SkillLoader)
    |
  Parse (SkillParser)      Extract frontmatter + body
    |
  Match (SkillMatcher)     Match to agent by role, lens, keywords
    |
  Inject (SkillInjector)   Insert into agent context within budget
    |
  Execute (SkillExecutor)  For MCP tool skills: call via stdio/SSE/HTTP
```

### Policy engine

Deny-by-default capability system:

```yaml
# .agent-orchestra/policy.yaml
rules:
  - scope: { skill: "web-fetcher" }
    capability: "net.http"
    effect: allow
  - scope: { skill: "*" }
    capability: "fs.write"
    effect: deny
```

System rules (always active) block:
- SSRF to private networks
- Shell injection patterns
- Secret file access (`.env`, credentials)
- Recursive self-invocation

### Skill types (progressive risk ladder)

1. **Prompt skills** — Context injection only. No execution. Always safe.
2. **Tool skills** — MCP-based tool bindings. Read-only initially, then full access with policy.
3. **Plugin skills** — Sandboxed executables. Docker isolation, network restrictions, signed packages.

### SkillSets

Group related skills:
```yaml
# .agent-orchestra/skillsets/security-review/SKILLSET.md
---
name: Security Review
skills: [owasp-check, auth-review, dependency-scan]
---
```

---

## 7. Event System

### Architecture

The `EventBus` is a generic typed emitter wrapping Node's `EventEmitter`:

```typescript
class EventBus<TMap extends Record<string, unknown>>
```

Two event map types:

**Debate events** (`DebateEventMap`):
| Event | Payload |
|---|---|
| `job:update` | jobId, status |
| `round:start` | jobId, roundIndex, state |
| `round:complete` | jobId, roundIndex, state |
| `agent:output` | jobId, agentId, chunk (streaming) |
| `agent:output:end` | jobId, agentId, full AgentOutput |
| `cluster:update` | jobId, clusters |
| `synthesis:ready` | jobId |
| `error` | jobId, error string, details |

**Runtime events** (`RuntimeEventMap`):
| Event | Payload |
|---|---|
| `run:started` | runId, sessionId, mode |
| `run:completed` | runId, sessionId, status |
| `task:status` | taskId, status |
| `guard:violation` | runId, violationType, message |

Composed: `FullEventMap = DebateEventMap & RuntimeEventMap`

The `PersistedEventBus` extends `EventBus<DebateEventMap>` to write events to disk (NDJSON) before dispatching. Supports `replay()` for recovery.

---

## 8. Storage

All data persists as JSON files under `.agent-orchestra/` at the workspace root.

### Layout

```
.agent-orchestra/
  jobs/{jobId}/
    job.json                    Review job record
    conversation.jsonl          Structured conversation log (NDJSON)
    rounds/
      round-0.json              Per-round agent outputs
      round-1.json
  runs/{runId}.json             Execution run records
  tasks/{taskId}.json           Task state
  sessions/{sessionId}.json     Session state
  sessions/{sessionId}/
    transcript.jsonl            Append-only transcript
  automation/{jobId}.json       Automation job definitions
  skills/                       Local skill directories
  skillsets/                    Skill set configurations
  daemon/
    daemon.pid                  Daemon process ID
    daemon.log                  Daemon stdout/stderr
  tool-invocations.jsonl        Skill/tool audit log
  policy.yaml                  Policy rules
  agents.yaml                  Agent configuration
```

### Store interfaces

Each store has an interface in `packages/core` and a `File*Store` implementation:

| Interface | Implementation | Data |
|---|---|---|
| `JobStore` | `FileJobStore` | Review jobs |
| `RoundStore` | `FileRoundStore` | Debate rounds |
| `ConversationStore` | `FileConversationStore` | Conversation log |
| `RunStore` | `FileRunStore` | Execution runs |
| `TaskStore` | `FileTaskStore` | Tasks |
| `SessionStore` | `FileSessionStore` | Sessions |
| `TranscriptStore` | `FileTranscriptStore` | Transcripts |
| `AutomationStore` | `FileAutomationStore` | Automation jobs |

Interfaces are backend-agnostic. Implementations can be swapped (e.g., SQLite, Redis) without changing consumers.

---

## 9. Dashboard & Server

### Starting

```bash
ao daemon start             # Background (production)
# or
pnpm dev:server             # Foreground (development)
# → http://localhost:3100/
```

### REST API

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Version, uptime |
| `/api/status` | GET | Version, storage path, job count |
| `/api/jobs` | GET | List all review jobs |
| `/api/jobs/:id` | GET | Job detail + rounds |
| `/api/runs` | GET | List runs (filter by sessionId, taskId) |
| `/api/runs/:id` | GET | Run detail |
| `/api/runs/:id` | PATCH | Cancel a running run |
| `/api/tasks` | GET | List tasks (filter by status, sessionId) |
| `/api/tasks` | POST | Create a task |
| `/api/tasks/:id` | GET/PATCH/DELETE | Task CRUD |
| `/api/sessions` | GET | List sessions |
| `/api/sessions/:id` | GET/DELETE | Session detail/delete |
| `/api/sessions/:id/transcript` | GET | Load transcript entries |
| `/api/automation` | GET/POST | List/create automation jobs |
| `/api/automation/:id` | GET/PATCH/DELETE | Automation CRUD |
| `/api/automation/:id/run` | POST | Run automation job now |
| `/api/automation/:id/logs` | GET | Run history for an automation job |
| `/api/projects` | GET/POST/PATCH/DELETE | Project registry CRUD |
| `/api/superpowers` | GET | List superpower presets |

### Dashboard tabs

| Tab | Shows |
|---|---|
| Overview | Stats cards, recent runs and tasks |
| Runs | All execution runs with tool calls and guard violations |
| Tasks | Task management with create/update/delete |
| Review Jobs | Debate jobs with round detail |
| Sessions | Session list with transcript viewer |
| Automation | Job management, manual trigger, run logs |
| Projects | Cross-workspace project registry |
| Superpowers | Available presets catalog |

### MCP server

```bash
ao serve --mcp              # stdio transport
```

Exposes tools: `list_superpowers`, `review_target`, `review_plan`, `show_findings`, `list_skills`, `evaluate_policy`, `get_job`, `compare_runs`.

---

## 10. CLI Reference

### Setup & Config

| Command | Description |
|---|---|
| `ao setup` | Interactive wizard (provider, defaults, automation, daemon) |
| `ao init` | Quick init (auto-detect project, generate config) |
| `ao init --refresh-agents` | Refresh provider defaults |
| `ao init --with-policy` | Include policy scaffolding |

### Code Review

| Command | Description |
|---|---|
| `ao run --target <file>` | Run debate review |
| `ao run --target <file> --superpower <id>` | Use a preset |
| `ao run --target <file> --auto-apply` | Auto-patch findings |
| `ao run --target <file> --max-rounds 10` | Set round limit |
| `ao job list` | List all review jobs |
| `ao job show <id>` | Show job + rounds |

### Automation

| Command | Description |
|---|---|
| `ao automation list` | List jobs |
| `ao automation add <file>` | Register from JSON |
| `ao automation run <id>` | Run immediately |
| `ao automation enable/disable <id>` | Toggle scheduling |
| `ao automation logs <id>` | Run history |

### Daemon & Dashboard

| Command | Description |
|---|---|
| `ao daemon start [--port N]` | Start background server |
| `ao daemon stop` | Stop |
| `ao daemon status` | Check PID, port, uptime |
| `ao daemon logs [-f] [-n N]` | View/follow logs |

### Project Manager

| Command | Description |
|---|---|
| `ao project list` | All registered projects |
| `ao project add [path]` | Register |
| `ao project remove [path]` | Unregister |
| `ao project status [path]` | Detailed status |

### Skills & Policy

| Command | Description |
|---|---|
| `ao skills list` | List available skills |
| `ao skills show <id>` | Skill detail |
| `ao superpowers list` | List presets |
| `ao superpowers show <id>` | Preset detail |
| `ao policy show` | Active policy rules |
| `ao audit list` | Tool invocation audit log |

### Provider overrides

```bash
ao run --target ./src/ \
  --provider auto \
  --architect-provider claude-cli \
  --architect-model claude-opus-4-6 \
  --reviewer-provider openai \
  --reviewer-model gpt-5.4
```

---

## 11. Development

### Prerequisites

- Node.js >= 20
- pnpm (via `corepack enable` or `npm install -g pnpm`)

### Setup

```bash
git clone https://github.com/malayvuong/agent-orchestra.git
cd agent-orchestra
pnpm install
pnpm build
```

### Run locally

```bash
pnpm dev                          # CLI help
pnpm dev -- run --target file.ts  # Run a review
pnpm dev:server                   # Start server on :3100
```

### Link globally

```bash
pnpm link:ao     # Creates 'ao' symlink to local build
pnpm unlink:ao   # Removes symlink
```

### Tests

```bash
pnpm test           # Run all tests (1169 tests across 87 files)
pnpm test:watch     # Watch mode
```

### Code quality

```bash
pnpm lint           # ESLint
pnpm format         # Prettier
pnpm typecheck      # TypeScript across all packages
```

### Commit convention

[Conventional Commits](https://www.conventionalcommits.org/):
```
feat(core): add conversation store for structured debate history
fix(protocols): handle empty reviewer output in rebuttal
docs: update project document
```

---

## 12. Data flow diagrams

### Code review flow

```
User                CLI                     Orchestrator         SingleChallenger        Provider
  |                  |                          |                      |                    |
  |-- ao run ------->|                          |                      |                    |
  |                  |-- resolveTarget() ------->|                      |                    |
  |                  |-- createJob() ----------->|                      |                    |
  |                  |-- runJob() -------------->|                      |                    |
  |                  |                          |-- execute() -------->|                    |
  |                  |                          |                      |-- analysis -------->|
  |                  |                          |                      |<-- findings --------|
  |                  |                          |                      |-- review ---------->|
  |                  |                          |                      |<-- challenges ------|
  |                  |                          |                      |-- rebuttal -------->|
  |                  |                          |                      |<-- response --------|
  |                  |                          |                      |   (loop if budget)  |
  |                  |                          |                      |-- convergence ----->|
  |                  |                          |                      |   (synthesize)      |
  |                  |                          |<-- awaiting_decision-|                    |
  |<-- findings -----|                          |                      |                    |
```

### Automation flow

```
User/Cron           CLI/Server              AutomationRunner        StepExecutor
  |                    |                          |                      |
  |-- trigger -------->|                          |                      |
  |                    |-- execute() ------------>|                      |
  |                    |                          |-- resolveOrder() --->|
  |                    |                          |   (topo sort)        |
  |                    |                          |-- step 1 ---------->|
  |                    |                          |<-- result -----------|
  |                    |                          |-- step 2 ---------->|
  |                    |                          |<-- result -----------|
  |                    |                          |   (retry on fail)   |
  |                    |<-- RunnerResult ---------|                      |
  |<-- status ---------|                          |                      |
```

---

## 13. Current state and roadmap

### What is production-ready

- Debate engine (`ao run`) with single-challenger protocol
- Auto-apply of acknowledged findings
- Multi-provider support (Claude CLI, Codex CLI, OpenAI API, Anthropic API)
- Superpowers (plan-review, security-review, test-generation, dependency-audit)
- Skill system (prompt skills, SKILL.md format, matching, injection)
- Policy engine (deny-by-default, capability scoping)
- Automation runner with step dependencies and retry
- Dashboard with REST API
- MCP tool server integration
- Project registry
- Structured conversation log with NDJSON persistence

### What is built but not yet wired

- `Runtime` class (central request router) — built, tested, not connected to CLI or server
- `InteractiveRunner` — built, tested, no CLI command uses it
- `Scheduler` — built, tested, not started by the daemon
- `IntentClassifier` — built, tested, not called anywhere
- `ExecutionGuard` — built, tested, only used by `Runtime` (which itself is unwired)
- General roles (planner, executor, verifier, researcher, operator) — defined, not used in any protocol
- Runtime events — types defined, no `.emit()` calls in runners yet

### Planned next steps

1. **Context Budget Manager** — Replace the 40K char truncation with token-aware budget management. Summarize old rounds instead of dropping them.
2. **Wire Runtime to server** — Route server HTTP requests through `Runtime.handleRequest()` for automatic session management, transcript logging, and guard enforcement.
3. **Second protocol** — `reviewer_wave` (parallel fan-out to multiple reviewers) or `builder_plus_reviewer` (reviewer + builder collaboration).

### Architecture decision records

Key decisions are documented in `docs/decision-log.md`:
- ADR-001: Adopt Agent Skills Standard over proprietary format
- ADR-002: Risk Ladder Sequencing (prompt -> tool -> plugin)
- ADR-003: Marketplace after permissioning
- ADR-004: Embed security as code per phase
- ADR-005: Local registry before remote marketplace

---

## 14. Glossary

| Term | Definition |
|---|---|
| **Job** | A review task with protocol, scope, agents, and rounds |
| **Round** | One step in the debate protocol (analysis, review, rebuttal, etc.) |
| **Finding** | A specific issue identified during review, with actionability and confidence |
| **Protocol** | The debate choreography (e.g., single_challenger) |
| **Superpower** | A curated preset bundling skills, lens, and agent config |
| **Skill** | An injectable prompt or MCP tool binding |
| **SkillSet** | A group of related skills |
| **Lens** | A reviewer's focus area (security, testing, performance, etc.) |
| **Run** | A single execution — debate, automation, or interactive |
| **Task** | A unit of work tracked independently of chat |
| **Session** | A grouping of related runs and transcripts |
| **Guard** | The execution guard that validates model actions |
| **Policy** | Deny-by-default capability rules for tools and skills |
| **ContentBlock** | A typed block within an AgentMessage (text, finding) |
| **AgentMessage** | A structured message in the per-job conversation log |
