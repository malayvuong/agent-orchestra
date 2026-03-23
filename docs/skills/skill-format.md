# SKILL.md Format Reference

This document describes the complete format for `SKILL.md` files.

## File Structure

A `SKILL.md` file must start with a YAML frontmatter block delimited by `---`, followed by the markdown body:

```
---
<YAML frontmatter>
---
<markdown body>
```

The file must begin with `---` (no preceding whitespace or content). Both the opening and closing `---` delimiters are required.

## Frontmatter Fields

### `name` (string, required)

Human-readable name for the skill. Used in logs and the skill registry UI.

```yaml
name: Security Review
```

### `description` (string, required)

One or two sentences describing what the skill does. Used in skill discovery and SkillSet configuration.

```yaml
description: OWASP Top 10 checklist for code review.
```

### `version` (string, optional)

CalVer of the skill in `YYYY.M.PATCH` format. Defaults to the current Agent Orchestra release CalVer if omitted.

```yaml
version: 2026.3.1
```

### `license` (string, optional)

SPDX license identifier for the skill content.

```yaml
license: MIT
```

### `triggers` (object, optional)

Controls when the skill is injected. If the `triggers` field is absent entirely, the skill is always-on and injected for every agent review.

```yaml
triggers:
  lenses:
    - security
    - performance
  keywords:
    - migrate
    - upgrade
  roles:
    - reviewer
  lifecycle:
    - pre_round
```

See [Trigger Matching Rules](#trigger-matching-rules) below.

### `compatibility` (object, optional)

Constrains which versions of agent-orchestra and which platforms the skill is compatible with.

```yaml
compatibility:
  agentOrchestra: ">=1.0.0"
  platforms:
    - linux
    - darwin
```

### `allowed-tools` (array, optional)

Reserved for future use. Lists tool names the skill is permitted to invoke.

## Trigger Matching Rules

The skill injector evaluates triggers as follows:

**No triggers field** — skill is always injected (always-on). Use this for universal quality guidelines.

**Triggers field present** — the skill is injected if any of the specified trigger conditions match the current review context. Trigger conditions within a triggers block are evaluated with OR logic: a skill matches if it has at least one matching lens, keyword, role, or lifecycle event.

### `triggers.lenses`

Valid values: `logic`, `consistency`, `regression`, `testing`, `performance`, `security`, `cross_system_contract`, `scope`, `dependency`, `sequencing`, `simplification`, `risk`, `implementation_readiness`.

The skill is injected when the agent's current lens is in this list.

### `triggers.keywords`

An array of lowercase strings. The skill is injected when any keyword appears (case-insensitive substring match) in the review request, file paths, or branch name.

### `triggers.roles`

Valid values: `architect`, `reviewer`, `builder`.

The skill is injected only when the agent has a matching role.

### `triggers.lifecycle`

Valid values: `pre_round`, `post_round`, `pre_synthesis`, `post_synthesis`.

The skill is injected only at the specified review lifecycle phase.

## Progressive Disclosure

When a skill's prompt content exceeds the token budget, the injector uses progressive disclosure: it injects a summary (the first paragraphs that fit within the budget) rather than truncating mid-sentence. The summary is generated at load time.

To ensure the most critical instructions survive truncation, place the highest-priority content in the first paragraphs of the skill body.

## Body Writing Guidelines

The markdown body is injected verbatim (after HTML stripping) into the agent's system context. Write it as direct instructions to an AI agent:

- Use imperative voice: "When reviewing X, check for Y."
- Structure with headings for scanability.
- Each section should be independently useful if truncated.
- Target 400–600 tokens (~1600–2400 characters) for most skills.
- Avoid HTML tags — they are stripped during loading.

## Validation Rules

The loader enforces these rules at load time:

- File must begin with `---` frontmatter.
- `name` and `description` are required.
- `triggers.lenses` values must be from the valid lens list (unknown values are warned and ignored).
- `triggers.roles` values must be `architect`, `reviewer`, or `builder`.
- The skill ID (derived from the directory name) must match `[a-z0-9-]+`.
- Potential prompt injection patterns are detected and warned (not rejected).

Unknown frontmatter fields produce a warning but do not cause loading to fail, allowing forward compatibility with future fields.

## SkillSet Configuration

Skills can be grouped into SkillSets for use in specific review workflows. See [SkillSets](./skillsets.md).
