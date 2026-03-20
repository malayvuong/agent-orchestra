# SkillSets

A SkillSet is a named group of skills with a shared token budget. SkillSets let you define curated collections of skills for specific review workflows — for example, a `security-audit` SkillSet that combines security, dependency, and auth skills, or a `quick-review` SkillSet that uses only lightweight always-on skills.

## How SkillSets Work

When an agent runs with a SkillSet, only skills in that SkillSet are eligible for injection. The combined token budget for all injected skills in the SkillSet is capped at `contextBudgetPercent` percent of the agent's total context window. If multiple skills match and the combined size exceeds the budget, higher-priority skills (matched by lens) take precedence over keyword-matched skills.

Without a SkillSet, the agent loads all available skills and injects matching ones up to a default budget.

## YAML Configuration Format

SkillSets are defined in `.agent-orchestra/skillsets.yaml` at the project level, or `~/.agent-orchestra/skillsets.yaml` at the user level. Project-level definitions override user-level definitions with the same ID.

```yaml
skillsets:
  - id: security-audit
    name: Security Audit
    description: Full security review including OWASP, dependency vulnerabilities, and auth patterns.
    skills:
      - security-review
      - code-quality
    contextBudgetPercent: 25

  - id: quick-review
    name: Quick Review
    description: Lightweight always-on quality review for fast PR checks.
    skills:
      - code-quality
    contextBudgetPercent: 10

  - id: full-review
    name: Full Review
    description: Comprehensive review covering security, performance, testing, and code quality.
    skills:
      - code-quality
      - security-review
      - test-conventions
      - perf-review
    contextBudgetPercent: 30
```

## Field Reference

### `id` (string, required)

Unique identifier for the SkillSet. Must match `[a-z0-9-]+`. Used to reference the SkillSet in agent configuration and CLI flags.

### `name` (string, required)

Human-readable display name.

### `description` (string, required)

Short description of the SkillSet's purpose.

### `skills` (array of strings, required)

List of skill IDs to include in this SkillSet. Each ID must correspond to a skill directory name under `.agent-orchestra/skills/`. Skills listed here that cannot be found are warned at load time but do not prevent the SkillSet from loading.

### `contextBudgetPercent` (number, required)

Integer from 0 to 100. The maximum percentage of the agent's context window that all injected skills in this SkillSet may occupy combined. Recommended values:

| Use Case | Suggested Budget |
|---|---|
| Lightweight always-on quality review | 10% |
| Standard code review | 20% |
| Deep security or compliance audit | 25–30% |
| Comprehensive multi-dimension review | 30–40% |

Setting this too high leaves less room for the code being reviewed. Setting it too low may cause high-value skills to be truncated or excluded.

## Budget Allocation Behavior

When the injector selects skills for a given review:

1. Always-on skills (no triggers) are included first, up to their share of the budget.
2. Trigger-matched skills are ranked by specificity: lens matches rank above keyword matches.
3. Skills are added in rank order until the budget is exhausted.
4. If a skill does not fit in full, its summary is injected instead (progressive disclosure).
5. If even the summary does not fit, the skill is skipped and a warning is logged.

## Referencing a SkillSet

Specify the SkillSet ID when invoking an agent via the CLI:

```bash
agent-orchestra review --skillset security-audit
```

Or configure a default SkillSet in `.agent-orchestra/config.yaml`:

```yaml
defaultSkillset: full-review
```

## Seed SkillSets

The following skills are included in the project seed and can be referenced immediately:

| Skill ID | Description | Trigger |
|---|---|---|
| `code-quality` | General code quality guidelines | always-on |
| `security-review` | OWASP Top 10 checklist | lens: `security` |
| `test-conventions` | Testing patterns and naming | lens: `testing` |
| `perf-review` | Performance review checklist | lens: `performance` |
| `migration-guide` | Framework migration patterns | keywords: `migrate`, `migration`, `upgrade` |
