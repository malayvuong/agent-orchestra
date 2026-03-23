# @malayvuong/agent-orchestra

Structured multi-agent review for plans and code, packaged as a CLI.

## Fastest Path

```bash
# install from npm
npm install -g @malayvuong/agent-orchestra
ao init
ao run --target ./docs/spec.md --superpower plan-review --max-rounds 10 --auto-apply
```

Requires Node.js `>= 20`.

`ao` is the short command. `agent-orchestra` is also available.

## Use This Repo Directly

If you are developing Agent Orchestra itself and do not want to install from npm:

```bash
pnpm install
pnpm link:ao
ao --help
```

## Quick Start

```bash
ao init
ao run --target ./docs/plan.md --superpower plan-review --max-rounds 10 --auto-apply
ao serve --mcp
```

## Default Models

`ao init` and provider auto-resolution use these defaults:

| Provider | Default model |
|---|---|
| `claude-cli` | `claude-opus-4-6` |
| `codex-cli` | `gpt-5.4` |
| `openai` | `gpt-5.4` |
| `anthropic` | `claude-sonnet-4-6` |

If your workspace already has an older `.agent-orchestra/agents.yaml`, refresh it with:

```bash
ao init --refresh-agents
```

## Docs

- Repository: <https://github.com/nicemvp/agent-orchestra>
- Full usage guide: <https://github.com/nicemvp/agent-orchestra#readme>
