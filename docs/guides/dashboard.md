# Dashboard & Daemon Guide

Agent Orchestra includes a web dashboard for managing reviews, automation, tasks, and projects through a browser UI.

## Start the dashboard

### Foreground (development)

```bash
cd your-project
pnpm --filter @malayvuong/agent-orchestra-server dev
# → http://localhost:3100/
```

### Background daemon (production)

```bash
ao daemon start              # Start in background
ao daemon status             # Check if running
ao daemon logs               # View logs
ao daemon logs -f            # Follow logs (like tail -f)
ao daemon stop               # Stop gracefully
```

Options:

```bash
ao daemon start --port 8080  # Custom port (default: 3100)
ao daemon start --path /other/project
```

The daemon stores its PID and logs at `.agent-orchestra/daemon/`.

## Dashboard tabs

### Overview

Stats cards showing totals for jobs, runs, tasks, automation, and counters for running tasks, failed runs, and guard violations. Below: recent runs and tasks tables.

**Auto-refresh**: Use the dropdown in the header to enable auto-refresh at 5s, 15s, or 30s intervals.

### Runs

All execution runs across the system. Each row shows:
- Run ID, source, status, tool call count, guard violation count, timing

Click a row to see:
- Full detail: all fields, tool calls table with individual timing, guard violations highlighted in yellow, final reply text
- **Cancel** button for running runs

### Tasks

All tasks with status, origin, and execution-required flag.

Click a row to see full detail. Available actions:
- **Create Task**: Form to create a new task (title, objective, execution required)
- **Update Status**: Dropdown to change task status
- **Delete**: Remove done or failed tasks

### Review Jobs

Debate review jobs from `ao run`. Click to see rounds, findings, and agent outputs.

### Automation

Automation job management:
- **Enable/Disable** toggle per job
- **Run Now** button to trigger immediate execution
- **Add Job** form to create new automation jobs
- **Delete** with confirmation
- Click a row to see run history

### Sessions

Session list with type and last activity. Click to view the transcript:
- Messages displayed in chat style (user left, assistant right, system centered)
- Trust level shown as a colored tag per entry

### Projects

All registered projects across workspaces:
- Name, path, kind, daemon port, last active, tags
- **Add Project** form
- **Remove** with confirmation

## REST API

The dashboard communicates through a REST API. You can use these endpoints directly for integrations.

### Read endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check (version, uptime) |
| `GET /api/status` | Server status |
| `GET /api/jobs` | List review jobs |
| `GET /api/jobs/:id` | Job detail with rounds |
| `GET /api/runs` | List runs (?sessionId, ?taskId) |
| `GET /api/runs/:id` | Run detail |
| `GET /api/tasks` | List tasks (?status, ?sessionId) |
| `GET /api/tasks/:id` | Task detail |
| `GET /api/sessions` | List sessions |
| `GET /api/sessions/:id` | Session detail |
| `GET /api/sessions/:id/transcript` | Transcript entries (?limit) |
| `GET /api/automation` | List automation jobs |
| `GET /api/automation/:id` | Automation job detail |
| `GET /api/automation/:id/logs` | Run history (?limit) |
| `GET /api/projects` | List registered projects |
| `GET /api/superpowers` | List superpowers |

### Write endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /api/tasks` | Create a task |
| `PATCH /api/tasks/:id` | Update task status/fields |
| `DELETE /api/tasks/:id` | Delete a done/failed task |
| `PATCH /api/runs/:id` | Cancel a running run |
| `POST /api/automation` | Register automation job |
| `PATCH /api/automation/:id` | Update job (enable/disable, schedule) |
| `DELETE /api/automation/:id` | Delete automation job |
| `POST /api/automation/:id/run` | Trigger immediate run |
| `DELETE /api/sessions/:id` | Delete a session |
| `POST /api/projects` | Register a project |
| `PATCH /api/projects` | Touch project lastActiveAt |
| `DELETE /api/projects` | Unregister a project |

### Example: trigger an automation run via curl

```bash
curl -X POST http://localhost:3100/api/automation/nightly-tests/run
```

### Example: create a task

```bash
curl -X POST http://localhost:3100/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title": "Fix login bug", "objective": "Fix the 500 error on /login", "executionRequired": true}'
```
