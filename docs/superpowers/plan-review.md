# Plan Review Superpower

The `plan-review` superpower reviews implementation plans, roadmaps, RFCs, and planning documents for common issues that lead to execution failures.

## What It Checks

- **Sequencing issues** — steps ordered incorrectly, prerequisites not met before dependent work begins
- **Dependency problems** — hidden dependencies, circular dependency chains, undeclared external requirements
- **Scope discipline** — over-scoping, premature complexity, missing MVP cuts, scope creep indicators
- **Implementation readiness** — steps too vague to execute, missing exit criteria, unbounded tasks
- **Risk gaps** — unclear assumptions, missing mitigations, rollout risks, single points of failure

## Usage

Install the CLI first if you have not already:

```bash
npm install -g @malayvuong/agent-orchestra
```

```bash
# Review a plan file
ao run --target ./docs/phase-plan.md --superpower plan-review

# Iterative debate — architect and reviewer go back and forth until convergence
ao run --target ./docs/plan.md --superpower plan-review --max-rounds 10

# Review + auto-apply fixes to the original file
ao run --target ./docs/plan.md --superpower plan-review --max-rounds 10 --auto-apply

# Use specific providers for each agent
ao run --target ./plan.md --superpower plan-review \
  --architect-provider codex-cli --reviewer-provider claude-cli

# With a custom brief to focus the review
ao run --target ./rfc-auth.md --superpower plan-review --brief "Focus on Phase 2 dependencies"
```

### Provider defaults

If you let Agent Orchestra auto-resolve providers, review runs default to:

- `claude-cli` -> `claude-opus-4-6`
- `codex-cli` -> `gpt-5.4`
- `openai` -> `gpt-5.4`
- `anthropic` -> `claude-sonnet-4-6`

If your workspace was initialized before these defaults changed, run:

```bash
ao init --refresh-agents
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

### Max rounds

`round` here means one persisted protocol step, not a pair of agent turns.

- `--max-rounds 5` — minimal end-to-end pass: analysis → review → rebuttal → convergence → final_check
- `--max-rounds 7` — adds one reviewer follow-up and a second architect response
- `--max-rounds 10` — default and recommended for plan/spec review with sustained back-and-forth
- Legacy `--debate-rounds` still works as a deprecated alias, but `--max-rounds` is the canonical control now

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
| Recommended max rounds | 7-10 |
| Auto-apply | Supported (rewrites plan with fixes) |
