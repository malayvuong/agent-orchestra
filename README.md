# Agent Orchestra

<!-- TODO: replace badge URLs once CI and npm publishing are configured -->
![CI Status](https://img.shields.io/github/actions/workflow/status/TODO/agent-orchestra/ci.yml?branch=main&label=CI)
![npm version](https://img.shields.io/npm/v/@agent-orchestra/cli?label=CLI)
![License](https://img.shields.io/github/license/TODO/agent-orchestra)

Agent Orchestra is an AI agent orchestration platform for multi-agent code review and planning. It provides a skills and skillset system that lets agents load specialized capabilities -- security auditing, performance analysis, test convention enforcement, and more -- via the **Agent Skills** open standard. Skills are plain `SKILL.md` files with YAML frontmatter and markdown instructions, injected into agent context at runtime through trigger-based matching and progressive disclosure.

## Features

- **Skills system** -- prompt injection with progressive disclosure and context budget management. Skills are automatically discovered, matched by trigger conditions, and injected into agent context with token-aware truncation.
- **CLI-first workflow** -- manage, inspect, and simulate skill matching from the terminal.
- **Agent Skills standard compatible** -- skills are portable `SKILL.md` files that any compatible tool can consume.
- **Context budget management** -- token estimation and progressive disclosure ensure skills fit within model context limits without mid-sentence truncation.
- **5 built-in skills** -- security review, test conventions, code quality, performance review, and migration guide ship out of the box.
- **Extensible via SKILL.md** -- create custom skills by adding a directory with a `SKILL.md` file. No registration step required.

## Quick Start

```bash
npm install -g @agent-orchestra/cli

cd your-project

# List all discovered skills in the workspace
agent-orchestra skills list

# Show details of a specific skill
agent-orchestra skills show security-review

# Simulate which skills match for a given lens and role
agent-orchestra skills match --lens security --role reviewer --brief "Review auth module"
```

Skills are loaded from `.agent-orchestra/skills/` in your project root. No configuration file is needed.

## Create Your First Skill

1. Create a skill directory:

```bash
mkdir -p .agent-orchestra/skills/my-skill
```

2. Create `SKILL.md` with YAML frontmatter and a markdown body:

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

3. Verify it loads:

```bash
agent-orchestra skills list
```

The skill is automatically discovered -- no registration step is needed. The directory name (`my-skill`) becomes the skill ID.

## Built-in Skills

| Skill ID | Trigger Type | Description |
|---|---|---|
| `security-review` | lens: `security` | OWASP Top 10 checklist covering injection, broken auth, XSS, insecure deserialization, SSRF, and dependency vulnerabilities. |
| `test-conventions` | lens: `testing` | Testing patterns and conventions including naming, AAA structure, boundary testing, mock vs real dependencies, and coverage expectations. |
| `code-quality` | always-on | General code quality guidelines covering naming, function length, error handling, logging, and DRY principles. |
| `perf-review` | lens: `performance` | Performance checklist covering N+1 queries, unnecessary allocations, cache opportunities, async patterns, and bundle size. |
| `migration-guide` | keywords: `migrate`, `migration`, `upgrade` | Framework migration patterns covering dependency audits, breaking change detection, incremental migration strategy, and rollback planning. |

## CLI Commands

| Command | Description |
|---|---|
| `skills list` | List all loaded skills with version, trigger type, and source path. |
| `skills show <id>` | Show detailed information about a specific skill including token counts and summary. |
| `skills match` | Simulate skill matching for a given agent lens, role, and job brief. Accepts `--lens`, `--role`, and `--brief` options. |
| `skills validate [path]` | Validate skill definitions in a directory. |

All commands accept `--path <path>` to specify the workspace root (defaults to the current directory).

## Project Structure

Agent Orchestra is a pnpm monorepo:

```
packages/core/       Skill engine: parser, loader, matcher, context builder, types
packages/shared/     Shared constants and error definitions
apps/cli/            CLI application (@agent-orchestra/cli)
apps/server/         Web dashboard (future)
docs/skills/         Skill format documentation and guides
docs/workpackages/   Phased implementation plan
```

## Development

Requires Node.js >= 20 and pnpm.

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Lint
pnpm lint

# Format
pnpm format

# Type-check all packages
pnpm typecheck
```

## Documentation

- [Getting Started with Skills](docs/skills/getting-started.md) -- creating and discovering skills
- [SKILL.md Format Reference](docs/skills/skill-format.md) -- complete frontmatter field reference, trigger matching rules, and body writing guidelines

## Roadmap

Agent Orchestra follows a phased implementation plan with gated progression:

| Phase | Focus |
|---|---|
| **Phase A** | Prompt Skills -- schema freeze, parser, loader, matcher, context builder, CLI |
| **Phase B** | Local Registry -- `skills install`, lockfile, checksum verification |
| **Phase C** | Read-only MCP Tools -- MCP client (stdio + SSE), tool-calling loop, audit logging |
| **Phase D** | Permissioning -- policy engine, approval UX, SSRF protection |
| **Phase E** | Remote Marketplace (gated) -- registry, remote install, trust tiers |
| **Phase F** | Sandbox and Signing (gated) -- container isolation, cosign, SLSA provenance |

Each phase builds on the previous one. Phases E and F are gated behind adoption and security milestones. See [docs/workpackages/README.md](docs/workpackages/README.md) for the full plan, dependency graph, and exit criteria.

## License

[MIT](LICENSE)
