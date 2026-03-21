# Contributing to Agent Orchestra

Thank you for your interest in contributing! This guide will help you get started.

## Prerequisites

- **Node.js** >= 20
- **pnpm** (install via `corepack enable` or `npm install -g pnpm`)

## Setup

```bash
git clone https://github.com/your-org/agent-orchestra.git
cd agent-orchestra
pnpm install
pnpm build
```

## Running Tests

```bash
pnpm test            # Run all tests once
pnpm test:watch      # Run tests in watch mode
```

## Code Quality

```bash
pnpm lint            # Lint all packages
pnpm format          # Format code with Prettier
pnpm typecheck       # TypeScript type checking
```

Run all three before submitting a PR to ensure CI will pass.

## How to Add a Skill

Skills live in `packages/core/src/skills/builtin/`. Each skill is a directory containing a `SKILL.md` file.

1. Create a new directory under `packages/core/src/skills/builtin/`:
   ```
   packages/core/src/skills/builtin/your-skill/
     SKILL.md
   ```

2. Write your `SKILL.md` with the required frontmatter and sections:
   ```markdown
   ---
   name: your-skill
   version: 1.0.0
   description: Brief description of what the skill does
   triggers:
     - pattern or keyword that activates this skill
   ---

   # Your Skill

   Instructions for the AI agent when this skill is activated.
   ```

3. Register the skill if needed and add tests.

For full details on the SKILL.md format and advanced options, see [docs/skills/getting-started.md](docs/skills/getting-started.md).

## How to Add Core Code

Core library code lives in `packages/core/src/`. The package is organized by feature area:

- `packages/core/src/skills/` -- Skill system (parser, loader, matcher, injector)
- `packages/core/src/context/` -- Context budget management
- `packages/core/src/config/` -- Configuration handling

When adding new functionality:

1. Add your code in the appropriate subdirectory of `packages/core/src/`.
2. Export public APIs from the package's `index.ts`.
3. Write tests alongside your code (e.g., `your-module.test.ts`).
4. Run `pnpm test` from the repo root to verify.

## Pull Request Process

1. **Branch from `main`** -- create a feature branch with a descriptive name (e.g., `feat/new-skill-type`).
2. **Make your changes** -- keep commits focused and atomic.
3. **Ensure CI passes** -- run `pnpm lint`, `pnpm typecheck`, and `pnpm test` locally before pushing.
4. **Describe your changes** -- in the PR description, explain what changed and why.
5. **Request review** -- a maintainer will review your PR and may request changes.

## Commit Convention

We prefer [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]
```

Common types:
- `feat` -- new feature
- `fix` -- bug fix
- `docs` -- documentation only
- `test` -- adding or updating tests
- `refactor` -- code change that neither fixes a bug nor adds a feature
- `chore` -- maintenance tasks (deps, CI, etc.)

Examples:
```
feat(skills): add migration-guide built-in skill
fix(core): handle empty SKILL.md frontmatter gracefully
docs: update contributing guide
```
