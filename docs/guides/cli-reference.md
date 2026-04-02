# CLI Reference

All `ao` commands at a glance.

## Setup & Configuration

| Command | Description |
|---------|-------------|
| `ao setup` | Interactive setup wizard (provider, review defaults, automation, daemon) |
| `ao init` | Quick init (auto-detect project, generate config) |
| `ao init --refresh-agents` | Refresh provider defaults in agents.yaml |
| `ao init --with-policy` | Include policy file scaffolding |

## Code Review

| Command | Description |
|---------|-------------|
| `ao run --target <file>` | Run architect-reviewer debate on a target |
| `ao run --target <file> --superpower plan-review` | Use a superpower preset |
| `ao run --target <file> --auto-apply` | Auto-patch acknowledged findings |
| `ao run --target <file> --max-rounds 10` | Set debate round limit |
| `ao run --target <dir> --superpower security-review` | Review a directory |
| `ao job list` | List all review jobs |
| `ao job show <id>` | Show job details and rounds |
| `ao job compare <id>` | Compare related runs |

## Automation

| Command | Description |
|---------|-------------|
| `ao automation list` | List registered automation jobs |
| `ao automation add <file>` | Register job from JSON definition |
| `ao automation run <id>` | Run job immediately (isolated) |
| `ao automation enable <id>` | Enable scheduled execution |
| `ao automation disable <id>` | Disable scheduled execution |
| `ao automation logs <id>` | Show run history for a job |

## Daemon & Dashboard

| Command | Description |
|---------|-------------|
| `ao daemon start` | Start dashboard server in background |
| `ao daemon start --port 8080` | Custom port (default: 3100) |
| `ao daemon stop` | Stop the daemon |
| `ao daemon status` | Check daemon status (PID, port, uptime) |
| `ao daemon logs` | Show daemon logs (last 50 lines) |
| `ao daemon logs -f` | Follow daemon logs |
| `ao daemon logs -n 100` | Show last N lines |

## Project Manager

| Command | Description |
|---------|-------------|
| `ao project list` | List all registered projects with status |
| `ao project add [path]` | Register a project |
| `ao project add --name "X" --tag y` | Register with metadata |
| `ao project remove [path]` | Unregister (doesn't delete files) |
| `ao project status [path]` | Detailed project status |

## Skills & Policy

| Command | Description |
|---------|-------------|
| `ao skills list` | List available skills |
| `ao skills show <id>` | Show skill details |
| `ao audit list` | Show tool invocation audit log |
| `ao policy show` | Show active policy |
| `ao superpowers list` | List available superpowers |
| `ao superpowers show <id>` | Show superpower details |

## Server

| Command | Description |
|---------|-------------|
| `ao serve --mcp` | Start as MCP tool server (stdio) |

## Provider Overrides

Any `ao run` command supports per-agent provider overrides:

```bash
ao run --target ./spec.md --superpower plan-review \
  --architect-provider claude-cli \
  --architect-model claude-opus-4-6 \
  --reviewer-provider codex-cli \
  --reviewer-model gpt-5.4
```

## Global Options

| Option | Description |
|--------|-------------|
| `--path <path>` | Workspace path (default: current directory) |
| `--version` | Show version |
| `--help` | Show help |
