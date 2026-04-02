# Agent Orchestra

Structured multi-agent review for specs, plans, and code.

Agent Orchestra runs an architect-reviewer loop instead of a one-shot prompt. It finds issues, argues through them, patches acknowledged fixes back into the original file, and keeps a full round history so you can inspect what happened.

## Install in 1 Minute

```bash
npm install -g @malayvuong/agent-orchestra
```

Requires Node.js `>= 20`.

The CLI command is `ao`. `agent-orchestra` also works.

## Fastest Path

If you want to review one spec right now:

```bash
# inside the project you want to review
ao init
ao run --target ./docs/spec.md --superpower plan-review --max-rounds 10 --auto-apply
```

Then inspect the result:

```bash
ao job list
ao job show <job-id>
```

If your workspace already has an older `.agent-orchestra/agents.yaml`, refresh it with:

```bash
ao init --refresh-agents
```

## What It Does

Agent Orchestra is built for review workflows where “give me feedback” is not enough.

Typical loop:

1. The `architect` analyzes the target file or folder.
2. The `reviewer` challenges that analysis through a lens like planning or security.
3. The `architect` reviews those findings and explicitly acknowledges or disputes them.
4. If `--auto-apply` is enabled, only acknowledged findings are patched into the live file.
5. The `reviewer` re-reads the updated file and continues the debate.
6. The run stops when the debate converges or the round budget is exhausted.
7. A final check compares the ending artifact against the original baseline.

Important: `--auto-apply` is patch-based. It does not replace the whole file with model-generated content.

## Most Common Commands

Review a plan or spec:

```bash
ao run --target ./docs/plan.md --superpower plan-review --max-rounds 10
```

Review and patch the spec in place:

```bash
ao run --target ./docs/plan.md --superpower plan-review --max-rounds 10 --auto-apply
```

Review a codebase for security issues:

```bash
ao run --target ./src --superpower security-review
```

Start the MCP server:

```bash
ao serve --mcp
```

## Superpowers

A superpower is a ready-to-use review preset: lens + skills + agent setup.

| Superpower | Best for |
|---|---|
| `plan-review` | specs, plans, RFCs, rollouts |
| `security-review` | source code, auth, input validation, OWASP-style review |
| `test-generation` | finding missing tests and edge cases |
| `auto-fix-lint` | lint-focused cleanup |
| `dependency-audit` | package manifests and dependency risk |

## Provider Defaults

`ao init` auto-detects what is available and prefers CLI tools over API keys.

Default model matrix:

| Provider | Default model |
|---|---|
| `claude-cli` | `claude-opus-4-6` |
| `codex-cli` | `gpt-5.4` |
| `openai` | `gpt-5.4` |
| `anthropic` | `claude-sonnet-4-6` |

Per-agent config is stored in `.agent-orchestra/agents.yaml`.

Example:

```yaml
architect:
  provider: claude-cli
  model: claude-opus-4-6

reviewer:
  provider: codex-cli
  model: gpt-5.4
```

You can also override providers on the command line:

```bash
ao run --target ./docs/spec.md --superpower plan-review \
  --architect-provider claude-cli \
  --reviewer-provider codex-cli
```

## Runtime Architecture (v2)

Agent Orchestra has two execution modes:

### Review mode (original)

The architect-reviewer debate loop described above. Use `ao run` with a target file.

### Automation mode (new)

Run deterministic workflows as isolated background jobs, independent of any chat session.

```bash
ao automation add ./jobs/daily-check.json
ao automation run daily-check
ao automation logs daily-check
ao automation list
```

A job definition is a JSON file:

```json
{
  "id": "daily-check",
  "name": "Daily health check",
  "schedule": "every 1d",
  "enabled": true,
  "workflow": [
    { "id": "s1", "type": "script", "name": "Run tests", "config": { "command": "npm test" } },
    { "id": "s2", "type": "script", "name": "Check build", "config": { "command": "npm run build" }, "dependsOn": ["s1"] }
  ]
}
```

### How it works under the hood

```
                    ┌─────────────┐
  User / Cron / ──▶ │  Entrypoint  │
  Webhook           └──────┬──────┘
                           │ RunRequest
                    ┌──────▼──────┐
                    │   Runtime    │ ◄── sessions, transcripts, execution guard
                    └──────┬──────┘
                ┌──────────┼──────────┐
                ▼          ▼          ▼
         ┌──────────┐ ┌────────┐ ┌──────────┐
         │Interactive│ │Automat.│ │Background│
         │  Runner   │ │ Runner │ │  Runner  │
         └──────────┘ └────────┘ └──────────┘
                │          │
         ┌──────▼──┐  ┌───▼────┐
         │ Debate  │  │Workflow│
         │Protocol │  │ Steps  │
         └─────────┘  └────────┘
```

Key components:

| Component | What it does |
|-----------|-------------|
| **Runtime** | Central router. Gets or creates sessions, routes requests to runners, applies the execution guard, logs transcripts. |
| **Execution Guard** | Catches "model promised but didn't act". Blocks responses that contain promises but zero tool calls. Runs after model output, before delivery. |
| **Task Classifier** | Decides if a user message needs action (`fix the bug` = yes) or explanation (`what is X` = no). The guard uses this to know when to enforce. |
| **InteractiveRunner** | Handles user-facing requests. Creates task + run records, calls the model, logs tool calls and evidence. |
| **AutomationRunner** | Executes workflow steps in dependency order. Each step logged as a ToolCallRecord. Retry support per step, fail-fast on exhaustion. |
| **Scheduler** | Registers automation jobs with interval schedules (`every 5m`, `every 1h`, `every 1d`). Re-schedules after each execution. |

### Observability

Every execution produces a `RunRecord` with:
- run ID, session ID, task ID
- start/end timestamps
- status (running, completed, blocked, failed, cancelled)
- all tool calls with timing
- guard violations (if any)
- failure reason

```bash
ao automation logs <job-id>    # see run history for automation jobs
ao job show <job-id>           # see debate review details
```

### Agent Roles

Debate roles (existing): `architect`, `reviewer`, `builder`

General roles (new): `planner`, `executor`, `verifier`, `researcher`, `operator`

Each role defines what tools it can use, whether it can mutate state, and what output format it must produce. See `packages/core/src/roles/role-definitions.ts`.

### Tool Registry

Tools declare metadata: category, side effects, required approval, allowed roles, timeout. The registry enables role-based access control — a `planner` can only use read tools, an `executor` can read + write + exec.

### Structured Logging

The `FileLogger` writes JSONL with level filtering and context propagation (runId, sessionId). The `PersistedEventBus` extends the existing EventBus to write all events to disk before dispatching.

## Why Use It

Agent Orchestra is optimized for execution-readiness review.

It is good at catching:
- wrong sequencing in implementation plans
- hidden dependencies and circular dependencies
- vague or non-actionable tasks
- scope creep and missing MVP cuts
- security and validation gaps in code
- disagreements that should be resolved before work starts

## Output and Audit Trail

Review runs produce:
- persisted rounds with architect/reviewer outputs
- classified findings (critical, follow-up, note)
- apply summaries (files written, unchanged, skipped)
- final-check summaries with verdict and score
- a baseline-aware job record

Automation runs produce:
- RunRecord with tool call trace and timing
- per-step status (ok, error, timeout)
- failure reason and guard violations
- structured JSONL logs

Useful commands:

```bash
ao job list                    # list review jobs
ao job show <job-id>           # inspect a review job
ao automation list             # list automation jobs
ao automation logs <job-id>    # inspect automation run history
```

## Use This Repo Directly

If you are developing Agent Orchestra itself and want to run this checkout instead of the npm package:

```bash
git clone https://github.com/malayvuong/agent-orchestra.git
cd agent-orchestra
pnpm install
pnpm link:ao
ao --help
```

This creates a symlink in the npm global bin directory so `ao` resolves to the local checkout.

Remove the local link later with:

```bash
pnpm unlink:ao
```

## Documentation

- [Quick Start with Init](docs/onboarding/init.md)
- [Superpowers Overview](docs/superpowers/overview.md)
- [Built-in Superpowers](docs/superpowers/builtin-superpowers.md)
- [Plan Review](docs/superpowers/plan-review.md)
- [MCP Integration](docs/integrations/mcp.md)
- [Skill Format Reference](docs/skills/skill-format.md)
- [Architecture Overview](docs/architecture-overview.md)
- [Implementation Plan v2](docs/implementation-plan-v2.md)

## Repository

- GitHub: <https://github.com/malayvuong/agent-orchestra>
- Issues: <https://github.com/malayvuong/agent-orchestra/issues>

## License

[MIT](LICENSE)
