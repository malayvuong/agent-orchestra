# Project Manager Guide

Agent Orchestra can track multiple projects across your machine. The project manager keeps a central registry at `~/.agent-orchestra/projects.json` so you can see all your workspaces from one place.

## Register a project

```bash
# Register current directory
ao project add

# Register a specific path
ao project add /path/to/project

# With metadata
ao project add --name "My API" --tag backend --tag production --port 3100
```

Projects are also auto-registered when you run `ao setup`.

## List all projects

```bash
ao project list
```

Output shows live status for each project:

```
Projects (3):

  ● My API
    Path: /Users/you/projects/my-api
    Kind: node-ts  |  Last active: 2m ago  daemon: http://localhost:3100/

  ○ Data Pipeline
    Path: /Users/you/projects/pipeline
    Kind: python  |  Last active: 3h ago

  ✗ Old Project
    Path: /Users/you/projects/old
    Kind: unknown  |  Last active: 14d ago

  Legend: ● daemon running  ○ initialized  ✗ not found
```

## Check project status

```bash
# Current directory
ao project status

# Specific path
ao project status /path/to/project
```

Shows detailed info including data counts:

```
Project: My API
  Path: /Users/you/projects/my-api
  Kind: node-ts
  Registered: 4/1/2026, 10:00:00 AM
  Last active: 4/2/2026, 8:30:00 AM (2m ago)
  Initialized: yes
  Daemon port: 3100
  Daemon status: running
  Dashboard: http://localhost:3100/

  Data:
    Review jobs: 12
    Runs: 47
    Tasks: 23
    Automation jobs: 3
```

## Remove a project

```bash
ao project remove
ao project remove /path/to/project
```

This only removes the project from the registry. No files are deleted.

## Dashboard view

The **Projects** tab in the web dashboard shows all registered projects with:

- Name and path
- Project kind
- Daemon port (if configured)
- Last active timestamp
- Tags

You can add and remove projects directly from the dashboard UI.

## How it works

The registry is a simple JSON file at `~/.agent-orchestra/projects.json`:

```json
{
  "version": 1,
  "projects": [
    {
      "path": "/Users/you/projects/my-api",
      "name": "My API",
      "kind": "node-ts",
      "daemonPort": 3100,
      "registeredAt": 1743465600000,
      "lastActiveAt": 1743552600000,
      "tags": ["backend", "production"]
    }
  ]
}
```

This file is user-level (not per-project) so it works across all workspaces.
