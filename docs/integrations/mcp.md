# MCP Server Integration

Agent Orchestra can run as an MCP (Model Context Protocol) tool server, allowing MCP-capable AI agents and clients to discover and invoke Agent Orchestra tools directly.

## Quick Start

```bash
# Start MCP server (stdio transport)
agent-orchestra serve --mcp

# With a specific workspace
agent-orchestra serve --mcp --path /path/to/project
```

## Transport

The default transport is **stdio**, which is the standard for local MCP tool servers. The MCP server communicates over stdin/stdout using the MCP protocol, with diagnostic output on stderr.

## Available Tools

| Tool | Description |
|---|---|
| `list_superpowers` | List all available superpower presets with metadata |
| `review_target` | Run a multi-agent review on a file or directory |
| `review_plan` | Review an implementation plan (convenience wrapper for plan-review) |
| `show_findings` | Retrieve findings for a completed review job |
| `list_skills` | List installed skills with trigger conditions |
| `evaluate_policy` | Check if a capability is allowed under current policy |
| `get_job` | Retrieve full details of a review job |

## Tool Schemas

### list_superpowers

No parameters. Returns all available superpowers with id, name, category, maturity, description, and approval requirements.

### review_target

```json
{
  "target": "src/auth.ts",
  "superpower": "security-review",
  "brief": "Focus on authentication flow",
  "lens": "security"
}
```

- `target` (required): File or directory path relative to workspace
- `superpower` (optional): Superpower preset ID
- `brief` (optional): Job description or focus area
- `lens` (optional): Review lens override

Returns job ID, status, findings summary, and counts.

### review_plan

```json
{
  "target": "docs/implementation-plan.md",
  "brief": "Focus on Phase 2 dependencies"
}
```

- `target` (required): Path to plan document
- `brief` (optional): Focus area

Internally uses the `plan-review` superpower.

### show_findings

```json
{
  "jobId": "abc123"
}
```

Returns synthesis findings, counts by severity, and job metadata.

### list_skills

No parameters. Returns all loaded skills with id, name, version, description, and trigger conditions.

### evaluate_policy

```json
{
  "capability": "fs.write",
  "scope": ["./src/**"]
}
```

- `capability` (required): One of `fs.read`, `fs.write`, `net.http`, `proc.spawn`, `secrets.read`
- `scope` (optional): File paths, URLs, or commands to evaluate

Returns the policy action (allow, deny, require_approval) and reason.

### get_job

```json
{
  "jobId": "abc123"
}
```

Returns job details including status, agents, scope, and timestamps.

## Safety

The MCP server respects all existing policy and approval behavior:

- **Superpowers requiring approval** (e.g., `auto-fix-lint`, `dependency-audit`) return a `requires_approval` status instead of executing. The calling agent must confirm with the user before proceeding.
- **Policy evaluation** uses the same `PolicyEngine` and system rules as the CLI.
- **System rules** (SSRF prevention, etc.) are non-overridable and apply in MCP mode.
- The MCP server does **not** auto-approve any capability requests.

## Client Configuration

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "agent-orchestra": {
      "command": "agent-orchestra",
      "args": ["serve", "--mcp", "--path", "/path/to/your/project"]
    }
  }
}
```

### Cursor / Other MCP Clients

Configure the MCP server command as:

```
agent-orchestra serve --mcp --path /path/to/your/project
```

## Limitations

- Only `stdio` transport is currently supported
- `review_target` and `review_plan` require an LLM provider API key (e.g., `OPENAI_API_KEY`)
- Reviews are synchronous — the tool blocks until the full review completes
- Plugin installation, sandbox controls, and marketplace management are not exposed via MCP
- No streaming of intermediate results during reviews

## Architecture

The MCP server is a thin adapter layer. All tool handlers call existing core services:

```
MCP Client → MCP Server (stdio)
  → list_superpowers    → loadSuperpowerCatalog()
  → review_target       → SuperpowerResolver + Orchestrator.createJob() + runJob()
  → review_plan         → same as review_target with superpower='plan-review'
  → show_findings       → FileJobStore + FileRoundStore
  → list_skills         → SkillLoader.loadFromWorkspace()
  → evaluate_policy     → PolicyEngine.evaluate()
  → get_job             → FileJobStore.load()
```

No new runtime path, orchestrator, or execution engine is introduced.
