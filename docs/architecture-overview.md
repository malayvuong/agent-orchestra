# Agent Orchestra — Architecture Overview

> A practical guide to how the system is structured, for developers joining the project.

---

## What is Agent Orchestra?

Agent Orchestra is a multi-agent runtime that started as a code review debate engine and evolved into a general-purpose agent execution system. It has two main modes:

1. **Review mode** — structured architect-reviewer debates for specs, plans, and code
2. **Automation mode** — deterministic workflow execution for background jobs

---

## System Layers

The system is organized into 4 layers:

```
┌────────────────────────────────┐
│         Entrypoint             │  CLI commands, cron triggers, webhooks
├────────────────────────────────┤
│          Runtime               │  Session management, request routing,
│                                │  execution guard, transcript logging
├────────────────────────────────┤
│          Runners               │  InteractiveRunner, AutomationRunner,
│                                │  debate protocol (SingleChallenger)
├────────────────────────────────┤
│     Tools & Policy             │  Tool registry, policy engine,
│                                │  skill system, MCP integration
└────────────────────────────────┘
```

### Entrypoint

Receives work from users (`ao run`, `ao automation run`), cron schedules, or webhooks. Normalizes input into a `RunRequest` and passes it to the Runtime.

### Runtime

The central coordinator (`packages/core/src/runtime/runtime.ts`). It:

- Gets or creates a **Session** for the request
- Logs inbound messages to the **TranscriptStore**
- Routes the request to the correct **Runner** based on mode
- Applies the **Execution Guard** to catch empty promises
- Logs the response and touches the session

### Runners

Each runner handles a specific execution mode:

| Runner | Mode | What it does |
|--------|------|-------------|
| `InteractiveRunner` | `interactive` | User-facing tasks. Creates TaskState, calls the model, logs tool calls. |
| `AutomationRunner` | `automation` | Deterministic workflows. Executes steps in dependency order, retries on failure. |
| `SingleChallengerRunner` | (debate) | The original architect-reviewer debate loop. Managed by the Orchestrator. |

### Tools & Policy

- **Tool Registry** — each tool declares its category (read/write/exec/external), side effects, and which roles can use it
- **Policy Engine** — deny-by-default capability system. System rules block SSRF, dangerous commands, and secret file access. User rules can allow/deny/require-approval per capability.
- **Skill System** — skills are injectable prompts or MCP tool bindings, matched to agents by role/lens/keywords

---

## Key Concepts

### RunRecord

Every execution produces a `RunRecord` stored as JSON on disk. It tracks:

- Run ID, session ID, task ID
- Source (chat, cron, webhook, system)
- Start/end timestamps and status
- All tool calls with individual timing
- Guard violations (if any)
- Failure reason

Location: `.agent-orchestra/runs/{runId}.json`

### TaskState

A task exists independently of the chat transcript. It tracks:

- What needs to be done (title, objective)
- Whether execution is required (vs. just explanation)
- Current status (queued, running, blocked, waiting, done, failed)
- Last evidence of work done
- Blocker reason and resume hints

Location: `.agent-orchestra/tasks/{taskId}.json`

### SessionState

A session groups related runs and transcripts. Types: interactive, cron, subagent, background.

Location: `.agent-orchestra/sessions/{sessionId}.json`

### TranscriptStore

Append-only JSONL log of all messages in a session. Each entry has a trust level:

| Trust Level | Meaning |
|------------|---------|
| `system` | Internal system messages |
| `trusted_meta` | Metadata from trusted sources |
| `user_input` | Direct user messages |
| `external` | Content fetched from web/files |
| `automation` | Events from cron/automated sources |

Location: `.agent-orchestra/sessions/{sessionId}/transcript.jsonl`

---

## Execution Guard

The execution guard is a **response filter** that sits between model output and delivery. It solves the "model promises but doesn't act" problem.

**How it works:**

1. The `TaskClassifier` looks at the user's message and decides if the task requires action (e.g., "fix the bug" = yes, "what is X" = no)
2. After the model responds, the guard checks: did the model actually call any tools?
3. If the task requires action but no tools were called AND the response contains promise language ("I'll do it", "con lam ngay"), the response is **blocked**
4. The guard also checks for evidence — successful tool output, file reads, command results

**What counts as evidence:**

- Successful tool call output
- File read result
- Command execution result
- Spawned background run ID
- Persisted artifact

Plain text does not count as evidence for actionable tasks.

---

## Automation System

### Job Definition

An automation job is a JSON file with:

- `id`, `name` — identification
- `schedule` — when to run (e.g., `every 5m`, `every 1h`, `every 1d`)
- `workflow` — array of steps to execute
- `enabled` — on/off toggle

### Workflow Steps

Steps declare their type, config, and dependencies:

```json
{
  "id": "step-1",
  "type": "script",
  "name": "Run tests",
  "config": { "command": "npm test" },
  "timeoutMs": 30000,
  "retryCount": 2
}
```

Steps are executed in **topological order** based on `dependsOn`. If a step fails after exhausting retries, the workflow stops immediately (fail-fast).

### CLI Commands

```
ao automation list              List all registered jobs
ao automation add <file>        Register from JSON definition
ao automation run <jobId>       Run immediately (isolated)
ao automation enable <jobId>    Enable a job
ao automation disable <jobId>   Disable a job
ao automation logs <jobId>      Show run history
```

---

## Agent Roles

### Debate Roles (for review mode)

| Role | Purpose | Can write? |
|------|---------|-----------|
| `architect` | Analyzes target, defends design decisions | No |
| `reviewer` | Challenges findings through a focused lens | No |
| `builder` | Applies accepted fixes to code | Yes |

### General Roles (for runtime mode)

| Role | Purpose | Can write? | Can access external? |
|------|---------|-----------|---------------------|
| `planner` | Decomposes tasks, decides delegation | No | No |
| `executor` | Runs tools, edits files, executes commands | Yes | No |
| `verifier` | Checks whether work actually happened | No | No |
| `researcher` | Fetches docs and web info | No | Yes |
| `operator` | Handles cron/background jobs | Yes | Yes |

Each role defines which tool categories it can access, enforced by the Tool Registry.

---

## Observability

### Structured Logging

`FileLogger` writes JSONL entries with:

- Timestamp, log level (debug/info/warn/error)
- Component name
- Run ID and session ID (via `child()` context)
- Arbitrary data payload

Location: `.agent-orchestra/logs/`

### Persisted EventBus

The `PersistedEventBus` extends the in-memory EventBus to write events to disk before dispatching. Supports `replay()` for recovery.

### What you can inspect

| Question | Where to look |
|----------|--------------|
| Why did this run fail? | `RunRecord.failureReason` |
| What tools were called? | `RunRecord.toolCalls[]` |
| Was the response blocked? | `RunRecord.guardViolations[]` |
| What happened in this session? | Transcript JSONL file |
| What did the automation do? | `ao automation logs <jobId>` |
| What rounds happened in a review? | `ao job show <jobId>` |

---

## Project Structure

```
packages/
  core/src/
    types/          Type definitions (job, agent, runtime, protocol, etc.)
    storage/        File-based stores (jobs, rounds, runs, tasks, sessions, transcripts)
    guard/          Execution guard, task classifier, evidence collector
    runner/         AutomationRunner, InteractiveRunner, Scheduler
    runtime/        Runtime (central router), IntentClassifier
    roles/          Role definitions with output contracts
    tools/          Tool registry with role-based access
    observability/  Structured FileLogger
    events/         EventBus + PersistedEventBus
    context/        Context builder for all execution modes
    orchestrator/   Debate job orchestrator
    protocols/      Single-challenger debate protocol
    skills/         Skill parser, loader, matcher, injector, policy engine, executor
    templates/      Prompt templates for debate rounds
    superpowers/    Review presets (plan-review, security-review, etc.)
  providers/        AI provider integrations (OpenAI, Anthropic, CLI)
  shared/           Shared constants
  registry/         Skill registry + installer

apps/
  cli/src/
    commands/       CLI commands (run, job, automation, skills, init, etc.)
    providers/      Provider resolution
    targeting/      File targeting and baseline snapshots
  server/           HTTP server + REST API
```

---

## Data Storage Layout

All runtime data lives in `.agent-orchestra/` at the workspace root:

```
.agent-orchestra/
  jobs/{jobId}/
    job.json                  Review job record
    rounds/
      round-0.json            Debate round data
      round-1.json
  runs/{runId}.json           Run records (all modes)
  tasks/{taskId}.json         Task state
  sessions/{sessionId}.json   Session state
  sessions/{sessionId}/
    transcript.jsonl           Append-only transcript
  automation/{jobId}.json     Automation job definitions
  tool-invocations.jsonl      Skill/tool audit log
```

---

## Design Principles

1. **Additive** — new features don't break existing ones. `ao run` works the same as before.
2. **Backward compatible** — the debate protocol is one runner inside the general runtime.
3. **Evidence-first** — the system checks that work actually happened before claiming success.
4. **Isolated automation** — cron/background jobs run independently of chat sessions.
5. **Observable** — every run, tool call, and guard violation is persisted and inspectable.
6. **Deny-by-default** — tools are blocked unless explicitly allowed by policy.
7. **Trust-aware** — transcript entries carry trust levels to distinguish user input from system data.

---

## Further reading

- [Setup Guide](guides/setup.md) — get started with the interactive wizard
- [Automation Guide](guides/automation.md) — create and run workflow jobs
- [Dashboard & Daemon](guides/dashboard.md) — web UI and REST API reference
- [Project Manager](guides/project-manager.md) — manage multiple workspaces
- [CLI Reference](guides/cli-reference.md) — all commands in one place
- [Implementation Plan](implementation-plan-v2.md) — detailed phase breakdown of v2 runtime
