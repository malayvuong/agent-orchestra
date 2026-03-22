# Plan Review Superpower

The `plan-review` superpower reviews implementation plans, roadmaps, RFCs, and planning documents for common issues that lead to execution failures.

## What It Checks

- **Sequencing issues** — steps ordered incorrectly, prerequisites not met before dependent work begins
- **Dependency problems** — hidden dependencies, circular dependency chains, undeclared external requirements
- **Scope discipline** — over-scoping, premature complexity, missing MVP cuts, scope creep indicators
- **Implementation readiness** — steps too vague to execute, missing exit criteria, unbounded tasks
- **Risk gaps** — unclear assumptions, missing mitigations, rollout risks, single points of failure

## Usage

```bash
# Review a plan file
agent-orchestra run --target ./docs/phase-plan.md --superpower plan-review

# Iterative debate — architect and reviewer go back and forth until convergence
agent-orchestra run --target ./docs/plan.md --superpower plan-review --debate-rounds 3

# Review + auto-apply fixes to the original file
agent-orchestra run --target ./docs/plan.md --superpower plan-review --debate-rounds 2 --auto-apply

# Use specific providers for each agent
agent-orchestra run --target ./plan.md --superpower plan-review \
  --architect-provider codex-cli --reviewer-provider claude-cli

# With a custom brief to focus the review
agent-orchestra run --target ./rfc-auth.md --superpower plan-review --brief "Focus on Phase 2 dependencies"
```

## When To Use It

Use `plan-review` when you have:

- An implementation plan before starting development
- A roadmap or phased rollout document
- An RFC that needs review for execution feasibility
- A migration plan with sequencing concerns
- A project plan that needs a second pair of eyes on scope and dependencies

## How It Works

The `plan-review` superpower uses the `single_challenger` protocol with iterative debate:

1. **Architect analysis** — scans the plan document for structural issues, missing steps, and sequencing problems
2. **Reviewer challenge** — reviews through the `implementation_readiness` lens, challenging assumptions and identifying gaps
3. **Architect response** — acknowledges valid findings, applies them, counter-argues where needed, discovers new issues from the debate
4. **Reviewer follow-up** — re-reads the original document, verifies the architect's response against the source, finds remaining gaps
5. Steps 3-4 repeat until the reviewer finds no new issues (**convergence**) or max rounds is reached
6. **Synthesis** — all findings are deduplicated and prioritized
7. **Auto-apply** (if `--auto-apply`) — architect rewrites the original file incorporating all confirmed fixes

### Debate rounds

- `--debate-rounds 1` — single round (default, legacy behavior: analysis → review → rebuttal → synthesis)
- `--debate-rounds 2` — two iterative cycles (recommended for most plans)
- `--debate-rounds 3` — three cycles (for complex plans with many dependencies)
- Maximum cap: `2^(agents+1)` — prevents runaway debates

The debate **converges naturally** — if the reviewer finds 0 new issues, iteration stops early regardless of the configured max.

## Skills

The superpower bundles five purpose-built skills:

| Skill | Focus |
|---|---|
| `sequencing-check` | Ordering problems, prerequisite violations |
| `dependency-check` | Hidden/circular dependencies, external requirements |
| `scope-discipline` | Over-scoping, premature complexity, MVP cuts |
| `implementation-readiness` | Actionability, exit criteria, specification gaps |
| `risk-check` | Assumptions, mitigations, rollout and timeline risks |

## Finding Types

Plan review produces findings in the standard format, but with plan-appropriate language:

- **Missing prerequisite before X** — a step depends on work not yet planned
- **Circular dependency detected** — A needs B, B needs C, C needs A
- **Exit criteria not measurable** — a step has no verifiable completion condition
- **Scope too broad for current milestone** — work exceeds stated goals
- **Risk mitigation missing** — a risk is identified but no mitigation is planned
- **Step is not actionable enough** — too vague for an engineer to begin work

## Configuration

| Property | Value |
|---|---|
| Category | review |
| Maturity | safe |
| Protocol | single_challenger (with iterative debate) |
| Reviewer lens | implementation_readiness |
| Skill budget | 30% |
| Approval required | No |
| Capabilities | None (prompt-only) |
| Recommended debate rounds | 2-3 |
| Auto-apply | Supported (rewrites plan with fixes) |
