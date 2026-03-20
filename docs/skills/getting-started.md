# Getting Started with Skills

Skills are prompt modules that inject context into agent reviews. A skill is a `SKILL.md` file that lives in a named directory inside `.agent-orchestra/skills/`. When an agent runs, the skill loader discovers all installed skills, and the skill matcher selects which ones to inject based on the current review context.

## Directory Structure

```
your-project/
  .agent-orchestra/
    skills/
      security-review/
        SKILL.md          ← skill content and metadata
      test-conventions/
        SKILL.md
      my-custom-skill/
        SKILL.md
```

The directory name becomes the skill ID. Directory names must match `[a-z0-9-]+`.

## Creating Your First Skill

1. Create a directory under `.agent-orchestra/skills/`:

```
mkdir -p .agent-orchestra/skills/my-skill
```

2. Create `SKILL.md` inside it with YAML frontmatter and a markdown body:

```markdown
---
name: My Skill
description: A short description of what this skill does.
version: 1.0.0
license: MIT
triggers:
  lenses:
    - security
---

When reviewing code, check for...
```

3. The skill is automatically discovered the next time the agent runs. No registration step is needed.

## SKILL.md Format Overview

A `SKILL.md` file has two parts separated by `---` delimiters:

**Frontmatter** — YAML metadata that controls how and when the skill is injected. Required fields are `name` and `description`. Optional fields include `version`, `license`, `triggers`, and `compatibility`.

**Body** — Markdown text written as instructions to an AI agent. This is the prompt content that gets injected into the agent's context. Write it in the imperative: "When reviewing X, check for Y."

## Trigger Types

Skills without a `triggers` section are always-on — they are injected for every agent review. Skills with triggers are only injected when the trigger conditions match:

- `triggers.lenses` — inject when the agent is running with a matching lens (e.g., `security`, `testing`, `performance`)
- `triggers.keywords` — inject when the review context contains a matching keyword
- `triggers.roles` — inject only for agents with a matching role (`architect`, `reviewer`, `builder`)

## Quick Example

```markdown
---
name: Database Safety
description: Checks for safe database access patterns including parameterized queries and connection handling.
version: 1.0.0
license: MIT
triggers:
  lenses:
    - security
  keywords:
    - database
    - sql
    - query
---

When reviewing code that accesses a database, apply the following checks.

## Parameterized Queries

Verify all query parameters are passed as bound variables, never interpolated into query strings. Flag any string concatenation used to build SQL or NoSQL queries.

## Connection Handling

Verify database connections are returned to the pool after use. Check that connections are released in finally blocks or via RAII patterns, not only on the success path.
```

## Next Steps

- Read [Skill Format Reference](./skill-format.md) for the complete frontmatter field reference.
- Read [SkillSets](./skillsets.md) to learn how to group and budget skills for specific review workflows.
