# Setup Guide

The interactive setup wizard gets Agent Orchestra running in your project in under a minute.

## Run the wizard

```bash
cd your-project
ao setup
```

The wizard walks through 5 steps:

### Step 1: Project detection

Automatically detects your project type (Node/TypeScript, Python, Rust, or generic) and checks for tests, docs, and recommended superpowers.

### Step 2: Provider selection

Choose your default AI provider:

| Provider | Requirements |
|----------|-------------|
| `claude-cli` | Claude Code CLI installed |
| `codex-cli` | OpenAI Codex CLI installed |
| `anthropic` | `ANTHROPIC_API_KEY` env var |
| `openai` | `OPENAI_API_KEY` env var |
| `auto` | Auto-detect available providers |

### Step 3: Review defaults

Configure your preferred review lens (logic, security, performance, testing, scope), max debate rounds, and whether auto-apply is enabled by default.

### Step 4: Automation

Optionally creates sample automation jobs based on your project type:

- **Test runner** — runs your test suite on a schedule
- **Health check** — verifies your project builds

### Step 5: Daemon

Optionally starts the background daemon so you can access the web dashboard immediately.

## What gets created

```
your-project/
  .agent-orchestra/
    agents.yaml           Provider configuration
    setup.json            Setup preferences
    automation/           Automation job definitions
    runs/                 Run records
    tasks/                Task state
    sessions/             Session state
    daemon/               PID file and logs
```

The project is also registered in `~/.agent-orchestra/projects.json` so you can manage it from anywhere with `ao project list`.

## After setup

Review a file:

```bash
ao run --target ./docs/spec.md --superpower plan-review
```

Open the dashboard:

```bash
ao daemon start
# → http://localhost:3100/
```

See all commands:

```bash
ao --help
```
