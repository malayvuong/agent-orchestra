# Agent Orchestra

Multi-agent runtime for code review, automation, and orchestrated AI workflows.

## Install

```bash
npm install -g @malayvuong/agent-orchestra
```

Requires Node.js `>= 20`. The CLI command is `ao`.

## Quick Start

```bash
ao setup                  # interactive wizard — provider, config, automation, dashboard
```

Or minimal setup:

```bash
ao init                   # auto-detect and configure
```

## Review a file

```bash
ao run --target ./docs/spec.md --superpower plan-review --auto-apply
```

The architect analyzes, the reviewer challenges, they debate, acknowledged findings get patched. See results:

```bash
ao job list
ao job show <job-id>
```

## Automate workflows

```bash
ao automation add ./jobs/nightly.json     # register a job
ao automation enable nightly              # enable scheduled execution
ao automation run nightly                 # run immediately
ao automation logs nightly                # see run history
```

Scheduled jobs run while the daemon/server is running. Schedules use simple intervals like `every 5m`, `every 1h`, or `every 1d`; cron expressions are not supported yet.

## Dashboard

```bash
ao daemon start           # start in background → http://localhost:3100/
ao daemon status           # check if running
ao daemon stop             # stop
```

The dashboard lets you manage runs, tasks, automation jobs, sessions, and projects through a web UI.

## Manage projects

```bash
ao project list            # all registered projects across your machine
ao project add             # register current directory
ao project status          # detailed status + data counts
```

## Superpowers

Ready-to-use review presets:

| Superpower | Best for |
|---|---|
| `plan-review` | specs, plans, RFCs |
| `security-review` | code security, OWASP |
| `test-generation` | missing tests and edge cases |
| `dependency-audit` | package risk |

## Validate skills

Validate one skill directory:

```bash
ao skills validate <skill-directory>
```

Validate all skills discoverable from a workspace:

```bash
ao skills validate .
```

## Providers

### Optional JEV review decisions

Set `TYPESAFE_API_KEY` in the CLI or MCP server process environment to enable JEV
assessment after each reviewer follow-up in `single_challenger`. Without a key,
the existing review flow runs unchanged. Environment files are not loaded automatically.

JEV receives reviewer findings, architect/reviewer responses, and the apply summary
through the external TypeSafe API. Do not enable it for content that must stay local.
The integration pins `jev-1.13.0`, limits state to 24,000 characters, and times out
after five seconds. API errors, malformed results, and uncertain assessments fall
back to the existing flow. There are no automatic retries.

Confident assessments can request another cycle, stop a resolved review, or end a
stalled debate with a needs-attention summary. JEV cannot stop as resolved while the
current reviewer still reports a must-fix finding. Round limits and cancellation
remain authoritative; final checking and user decisions still run. Assessments,
token usage, latency, and fallback outcomes are saved on the synthesis round as
`reviewAssessments`. The conservative thresholds need calibration on real reviews.

`ao init` auto-detects available providers:

| Provider | Default model |
|---|---|
| `claude-cli` | `claude-opus-4-6` |
| `codex-cli` | `gpt-5.4` |
| `openai` | `gpt-5.4` |
| `anthropic` | `claude-sonnet-4-6` |

Override per run:

```bash
ao run --target ./spec.md --architect-provider claude-cli --reviewer-provider codex-cli
```

## Documentation

### Guides

- [Setup Guide](docs/guides/setup.md) — interactive wizard walkthrough
- [Automation Guide](docs/guides/automation.md) — create and manage workflow jobs
- [Dashboard & Daemon](docs/guides/dashboard.md) — web UI, REST API, daemon management
- [Project Manager](docs/guides/project-manager.md) — multi-project tracking
- [CLI Reference](docs/guides/cli-reference.md) — all commands at a glance

### Architecture

- [Architecture Overview](docs/architecture-overview.md) — system layers, key concepts, design principles
- [Implementation Plan](docs/implementation-plan-v2.md) — detailed phase breakdown

### Reference

- [Quick Start with Init](docs/onboarding/init.md)
- [Superpowers Overview](docs/superpowers/overview.md)
- [Built-in Superpowers](docs/superpowers/builtin-superpowers.md)
- [Plan Review](docs/superpowers/plan-review.md)
- [MCP Integration](docs/integrations/mcp.md)
- [Skill Format Reference](docs/skills/skill-format.md)

## Development

If you are developing Agent Orchestra itself and want to run this checkout instead of the npm package:

```bash
git clone https://github.com/malayvuong/agent-orchestra.git
cd agent-orchestra
pnpm install
pnpm link:ao
ao --help
```

This creates a symlink in the npm global bin directory so `ao` resolves to the local checkout.

Remove the local link later with `pnpm unlink:ao`.

Before pushing changes, run the same local checks covered by CI:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test
pnpm audit --audit-level moderate
```

CI verifies the main matrix on Node.js 20 and 22.

Run the dashboard/API server from this checkout:

```bash
pnpm dev:server
```

## Links

- GitHub: <https://github.com/malayvuong/agent-orchestra>
- Issues: <https://github.com/malayvuong/agent-orchestra/issues>

## License

[MIT](LICENSE)
