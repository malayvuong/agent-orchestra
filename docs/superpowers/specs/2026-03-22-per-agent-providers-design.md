# Per-Agent Provider Configuration — Design Spec

**Date:** 2026-03-22
**Status:** Approved

## Problem

The protocol runner uses a single LLM provider for all agents. Users want to assign different providers to architect and reviewer agents — e.g., architect uses Codex CLI, reviewer uses Claude CLI, second reviewer uses Grok API.

## Design

### ProviderRouter

A `ProviderRouter` replaces the single `providerExecutor` in the protocol runner. It maps agent IDs to provider instances with a default fallback.

```typescript
class ProviderRouter {
  forAgent(agent: AgentAssignment): ProviderExecutor
}
```

Backward-compatible: when constructed with a single provider, `forAgent()` always returns that provider.

### Config file (`.agent-orchestra/agents.yaml`)

```yaml
architect:
  provider: codex-cli
  model: o4-mini

reviewers:
  - provider: claude-cli
    model: sonnet
    lens: security
  - provider: grok
    model: grok-3
    lens: scope
```

### CLI flags

`--architect-provider`, `--architect-model`, `--reviewer-provider`, `--reviewer-model` override config for ad-hoc runs.

### Precedence

CLI flags > agents.yaml > superpower defaults > auto-detect

### New providers

Grok and Deepseek use `OpenAIProvider` with custom `baseUrl`. No new classes.

### Protocol runner change

Single line change: `providerExecutor.run(...)` → `providerRouter.forAgent(agent).run(...)`

## Non-goals

- Multi-reviewer protocol (reviewer_wave) — config supports it but execution deferred
- Per-round provider switching
