# @malayvuong/agent-orchestra

CLI for Agent Orchestra.

Agent Orchestra reviews specs, plans, and code through an iterative architect-vs-reviewer workflow, then patches acknowledged fixes back into the original file when `--auto-apply` is enabled.

## Install

```bash
npm install -g @malayvuong/agent-orchestra
```

Requires Node.js `>= 20`.

Commands:
- `ao`
- `agent-orchestra`

## Fastest Path

```bash
ao init
ao run --target ./docs/spec.md --superpower plan-review --max-rounds 10 --auto-apply
```

Check results:

```bash
ao job list
ao job show <job-id>
```

## Common Commands

```bash
# review a plan or spec
ao run --target ./docs/plan.md --superpower plan-review --max-rounds 10

# review and patch the file in place
ao run --target ./docs/plan.md --superpower plan-review --max-rounds 10 --auto-apply

# security review for code
ao run --target ./src --superpower security-review

# MCP server
ao serve --mcp
```

`--auto-apply` is patch-based. It does not replace the whole file with generated content, and it only applies reviewer findings the architect explicitly acknowledged.

## Provider Defaults

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

## More Docs

- Repository: <https://github.com/malayvuong/agent-orchestra>
- Full README: <https://github.com/malayvuong/agent-orchestra#readme>
