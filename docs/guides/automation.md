# Automation Guide

Automation jobs run deterministic workflows as isolated background tasks, independent of any chat session.

## Create a job

Write a JSON definition file:

```json
{
  "id": "nightly-tests",
  "name": "Nightly Test Suite",
  "schedule": "every 1d",
  "enabled": true,
  "workflow": [
    {
      "id": "lint",
      "type": "script",
      "name": "Lint",
      "config": { "command": "npm run lint" },
      "timeoutMs": 30000
    },
    {
      "id": "test",
      "type": "script",
      "name": "Test",
      "config": { "command": "npm test" },
      "timeoutMs": 60000,
      "dependsOn": ["lint"]
    },
    {
      "id": "build",
      "type": "script",
      "name": "Build",
      "config": { "command": "npm run build" },
      "timeoutMs": 60000,
      "dependsOn": ["test"],
      "retryCount": 2
    }
  ]
}
```

Register it:

```bash
ao automation add ./jobs/nightly-tests.json
```

## Job definition fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | yes | Unique identifier |
| `name` | yes | Display name |
| `schedule` | no | Interval: `every 5m`, `every 1h`, `every 1d` |
| `trigger` | no | `cron`, `webhook`, or `watch` |
| `enabled` | yes | Whether the job runs on schedule |
| `workflow` | yes | Array of steps to execute |

## Workflow step fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | yes | Unique step identifier |
| `type` | yes | `script`, `tool_call`, `model_prompt`, or `conditional` |
| `name` | yes | Display name |
| `config` | yes | Step-specific config (e.g. `{ "command": "npm test" }`) |
| `dependsOn` | no | Array of step IDs that must complete first |
| `timeoutMs` | no | Timeout in milliseconds |
| `retryCount` | no | Number of retry attempts on failure |

## Step execution order

Steps run in **dependency order**. If step B depends on step A, A runs first. Steps without dependencies run in definition order. Circular dependencies are detected and rejected.

## Retry and failure

Each step can specify `retryCount`. If a step fails:

1. Retry up to `retryCount` times
2. If all retries fail, the workflow **stops immediately** (fail-fast)
3. The run is marked `failed` with the step name and error

## CLI commands

```bash
ao automation list                    # List all jobs
ao automation add <file>              # Register from JSON file
ao automation run <job-id>            # Run immediately
ao automation enable <job-id>         # Enable scheduling
ao automation disable <job-id>        # Disable scheduling
ao automation logs <job-id>           # Show run history
```

## Dashboard

All automation jobs are visible in the dashboard under the **Automation** tab:

- Toggle enable/disable with a switch
- Click **Run Now** to trigger immediately
- Click a job to see its run history
- Add new jobs via the **Add Job** form
- Delete jobs with confirmation

## Run records

Every automation execution creates a `RunRecord` stored at `.agent-orchestra/runs/`. Each step becomes a `ToolCallRecord` with:

- Step name and status (ok/error/timeout)
- Start time and duration
- Summary of output or error message
