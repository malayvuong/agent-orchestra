# Superpowers Overview

## What Are Superpowers?

Superpowers are curated, opinionated workflow presets that bundle together multiple Agent Orchestra concepts into a single activatable unit. Instead of manually configuring skills, agent lenses, protocols, and runtime settings for each review, a superpower provides a one-command shortcut that sets everything up correctly.

A superpower defines:

- **Skills** -- which prompt skills to load and inject into agent context
- **Agent configuration** -- architect and reviewer roles, lenses, provider/model preferences
- **Protocol** -- which review protocol to use (e.g., `single_challenger`)
- **Runtime defaults** -- skill budget allocation, approval requirements, capability expectations

## How Superpowers Map to Existing Concepts

Superpowers sit on top of the existing Agent Orchestra architecture. They do not introduce new execution primitives -- they compose existing ones:

| Superpower Field | Maps To |
|---|---|
| `skillIds` / `skillSetIds` | Skills loaded via `SkillMatcher` and injected via `SkillInjector` |
| `agentPreset.reviewer.lens` | The `lens` field on `AgentAssignment` |
| `agentPreset.reviewer.provider` / `.model` | The `providerKey` and `modelOrCommand` on `AgentAssignment` |
| `agentPreset.architect` | Architect `AgentAssignment` with optional provider/model override |
| `protocol` | The `Protocol` type used by `Orchestrator.createJob()` |
| `runtimeDefaults.skillBudgetPercent` | Passed to `ContextBuilder` budget management |
| `capabilityExpectation` | Informational -- indicates what capabilities a superpower's skills may need |
| `requiresApproval` | Whether advanced capabilities require explicit user approval before execution |

## Maturity Levels

Every superpower declares a maturity level that indicates its risk profile and whether user approval is needed:

### safe

Read-only operations with no side effects. These superpowers run reviews and analysis without modifying any files or making network requests beyond the LLM provider API. No approval is required.

Examples: `security-review`, `test-generation`

### controlled

Operations that may read additional files or make HTTP requests for analysis purposes. These are lower risk but involve capabilities beyond pure prompt-based review. The superpower may specify `capabilityExpectation` entries like `fs.read` or `net.http`.

Examples: `dependency-audit`

### advanced

Operations that may write files, spawn processes, or perform other side-effecting actions. These superpowers require explicit user approval before execution. The `requiresApproval` field is typically `true`.

Examples: `auto-fix-lint`

## How to Use from CLI

### List available superpowers

```bash
agent-orchestra superpowers list
```

This displays all registered superpowers with their ID, category, maturity level, and description.

### Show superpower details

```bash
agent-orchestra superpowers show security-review
```

This displays the full configuration of a superpower, including its skills, protocol, reviewer lens, expected capabilities, and whether approval is required.

### Run a review with a superpower

```bash
agent-orchestra run --target src/ --superpower security-review
```

The `--superpower` flag activates the preset. The superpower's settings become the defaults, but you can still override individual options:

```bash
# Use the security-review superpower but override the provider and model
agent-orchestra run --target src/ --superpower security-review --provider anthropic --model claude-sonnet-4-20250514

# Use a superpower but override the lens
agent-orchestra run --target src/ --superpower test-generation --lens regression
```

### Precedence rules

When `--superpower` is combined with other CLI flags:

1. Explicit CLI arguments always take precedence over superpower defaults
2. Superpower defaults take precedence over the CLI's built-in defaults
3. `--brief` and `--target` are always user-supplied (superpowers do not set these)

For example, if `security-review` sets `lens: security` and `protocol: single_challenger`, but you pass `--lens logic`, the review will use `logic` as the lens while keeping the superpower's protocol.

## Server API

The superpowers are also available via the HTTP API:

- `GET /api/superpowers` -- list all superpowers (summary view)
- `GET /api/superpowers/:id` -- get full superpower details

See the server documentation for response format details.
