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
ao automation run nightly                 # run immediately
ao automation logs nightly                # see run history
```

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

## Providers

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

## Links

- GitHub: <https://github.com/malayvuong/agent-orchestra>
- Issues: <https://github.com/malayvuong/agent-orchestra/issues>

## License

[MIT](LICENSE)
