import { AGENT_ORCHESTRA_VERSION } from '@malayvuong/agent-orchestra-shared'

type BuiltinSkillTemplate = {
  id: string
  content: string
}

function skillDoc(frontmatter: string, body: string): string {
  return `---\n${frontmatter}\nversion: ${AGENT_ORCHESTRA_VERSION}\nlicense: MIT\n---\n\n${body.trim()}\n`
}

const BUILTIN_SKILLS: BuiltinSkillTemplate[] = [
  {
    id: 'sequencing-check',
    content: skillDoc(
      `name: Sequencing Check
description: Detects ordering problems, prerequisite violations, and temporal dependencies in implementation plans.
triggers:
  lenses:
    - sequencing
    - implementation_readiness
  roles:
    - architect
    - reviewer
  keywords:
    - plan
    - phase
    - milestone
    - roadmap
    - sequencing
    - ordering`,
      `
When reviewing an implementation plan, check for sequencing and ordering issues.

## Prerequisite Violations

For each step or phase, verify that all prerequisites are satisfied by prior steps. Flag any step that depends on work not yet completed or not scheduled earlier. Look for implicit dependencies where a step assumes infrastructure, permissions, data, or capabilities that only exist after a later step.

## Temporal Dependencies

Identify steps that have hard temporal ordering requirements. Flag cases where parallel execution is assumed but sequential execution is required. Check whether critical-path items are identified and prioritized appropriately.

## Early vs. Late Ordering

Flag steps that appear too early or too late. Look for chicken-and-egg situations where two steps each require the other to go first.

## Phase Boundary Issues

Check that phase transitions have clear entry and exit criteria. Flag work that spans phase boundaries without acknowledgment. Verify that rollback points exist at phase boundaries.

For each finding, report: the specific steps involved, what prerequisite is violated, and a suggested reordering or dependency resolution.
`,
    ),
  },
  {
    id: 'dependency-check',
    content: skillDoc(
      `name: Dependency Check
description: Finds hidden dependencies, circular dependencies, and undeclared external requirements in implementation plans.
triggers:
  lenses:
    - dependency
    - implementation_readiness
  roles:
    - architect
    - reviewer
  keywords:
    - dependency
    - depends
    - requires
    - blocking
    - prerequisite`,
      `
When reviewing an implementation plan, check for dependency issues.

## Hidden Dependencies

Identify dependencies that are not explicitly stated but are implied by the plan. Look for infrastructure, team, data, and external service dependencies that must exist before work can start.

## Circular Dependencies

Detect circular dependency chains where two or more steps block each other. Suggest how to break the cycle with interface contracts, stubs, or phased rollout.

## Undeclared External Requirements

Flag any step that implicitly requires budget approval, vendor action, regulatory review, hardware provisioning, or cross-team coordination that is not scheduled.

## Dependency Graph Completeness

Verify that every non-trivial step is either independent or has its dependencies explicitly listed. Flag orphan steps that appear disconnected from the rest of the plan.

For each finding, report: the steps involved, the missing or circular dependency, and a concrete recommendation to resolve it.
`,
    ),
  },
  {
    id: 'scope-discipline',
    content: skillDoc(
      `name: Scope Discipline
description: Flags over-scoping, premature complexity, scope creep indicators, and missing MVP cuts in implementation plans.
triggers:
  lenses:
    - scope
    - implementation_readiness
    - simplification
  roles:
    - architect
    - reviewer
  keywords:
    - scope
    - mvp
    - phase
    - milestone
    - feature
    - priority`,
      `
When reviewing an implementation plan, check for scope discipline issues.

## Over-Scoping

Flag steps or features that go beyond what is needed for the stated goal. Look for optional features, premature optimization, parallel solution tracks, or scaling work before the baseline is proven.

## Premature Complexity

Identify unnecessary complexity introduced too early, such as abstraction layers before the second use case, generic frameworks for one scenario, distributed-system patterns for single-service problems, or caching before measurement.

## Missing MVP Cuts

Check whether the plan identifies what can be deferred. Flag plans with no explicit out-of-scope section, no priority tiers, no minimum viable definition, or polish work mixed into core delivery.

## Scope Creep Indicators

Look for language like "while we're at it" or steps that expand scope without adjusting timeline or resources.

For each finding, report: the specific scope issue, why it is problematic for the current milestone, and what should be deferred or cut.
`,
    ),
  },
  {
    id: 'implementation-readiness',
    content: skillDoc(
      `name: Implementation Readiness
description: Assesses whether each step in a plan is concrete enough to execute.
triggers:
  lenses:
    - implementation_readiness
  roles:
    - architect
    - reviewer
  keywords:
    - plan
    - implementation
    - task
    - step
    - actionable
    - execute`,
      `
When reviewing an implementation plan, assess whether each step is ready for implementation.

## Actionability

For each step, ask whether a competent engineer could begin work immediately. Flag steps that describe a goal without a concrete task, use vague language, lack deliverables, or cannot be assigned clearly.

## Exit Criteria

Check whether each step has measurable completion criteria. Flag work where "done" is subjective, acceptance criteria are missing, or results cannot be validated independently.

## Estimation Feasibility

Flag steps that are too large to estimate, combine unrelated work, or contain unbounded research with no timebox.

## Technical Specification Gaps

Identify missing API contracts, data model changes, integration points, edge cases, or migration strategy details.

For each finding, report: the underspecified step, what information is missing, and what level of detail would make it implementable.
`,
    ),
  },
  {
    id: 'risk-check',
    content: skillDoc(
      `name: Risk Check
description: Highlights unclear assumptions, missing mitigations, rollout risks, and timeline risks in implementation plans.
triggers:
  lenses:
    - risk
    - implementation_readiness
  roles:
    - architect
    - reviewer
  keywords:
    - risk
    - assumption
    - mitigation
    - rollback
    - rollout`,
      `
When reviewing an implementation plan, check for risk management issues.

## Unclear Assumptions

Identify assumptions about scale, third-party behavior, team capacity, or timelines that are not validated.

## Missing Risk Mitigations

Check whether high-risk steps have fallbacks if a dependency slips, a key person is unavailable, or the technical approach fails.

## Rollout Risks

Assess deployment safety, rollback readiness, gradual rollout mechanisms, monitoring, migration safety, and acknowledged downtime.

## Timeline Risks

Flag missing estimates, no contingency, no slack on the critical path, or external dependencies without a service-level commitment.

## Single Points of Failure

Flag plan elements that concentrate critical knowledge or execution in one person, one system, or one irreversible step.

For each finding, report: the specific risk, its impact, and a recommended mitigation strategy.
`,
    ),
  },
  {
    id: 'security-review',
    content: skillDoc(
      `name: Security Review
description: OWASP Top 10 checklist for code review.
triggers:
  lenses:
    - security`,
      `
When reviewing code from a security perspective, apply the following OWASP-oriented checks systematically.

## Injection

Check all locations where user-supplied data reaches a query engine or command interpreter. Flag string concatenation used to build queries or commands and verify parameterized APIs are used consistently.

## Broken Authentication

Review credential handling, session lifecycle, hard-coded secrets, and bypass risks in authentication flows.

## Cross-Site Scripting

Identify unsafe rendering paths and flag direct HTML injection APIs with untrusted data.

## Insecure Deserialization

Flag deserialization of untrusted data without schema validation or safe loaders.

## SSRF

Identify outbound requests built from user-controlled URLs or hosts and verify internal endpoints are blocked.

## Vulnerable Dependencies

Note outdated or risky dependencies, missing lockfiles, and supply-chain exposure.

For each finding, report: the file and line range, the OWASP category, the specific risk, and a remediation recommendation.
`,
    ),
  },
  {
    id: 'test-conventions',
    content: skillDoc(
      `name: Test Conventions
description: Testing patterns and conventions for code review.
triggers:
  lenses:
    - testing`,
      `
When reviewing test code, apply the following conventions to assess quality and completeness.

## Test Naming

Test names should read as behavior documentation and describe the observable outcome.

## Arrange-Act-Assert Structure

Each test should separate setup, action, and assertions clearly.

## Boundary and Edge Cases

Check for empty inputs, null-like values, boundaries, negative cases, and non-happy-path coverage.

## Mock vs Real Dependencies

Use real implementations for pure logic and mocks only for external boundaries like HTTP, database, filesystem, time, or randomness.

## Test Isolation

Each test must run independently with proper cleanup.

## Coverage Expectations

Critical paths should cover both success and failure behavior.

## Assertion Quality

Assertions should be specific and verify behavior rather than vague truthiness.
`,
    ),
  },
  {
    id: 'code-quality',
    content: skillDoc(
      `name: Code Quality
description: General code quality guidelines injected for every agent review.`,
      `
Apply the following code quality guidelines to every piece of code you review.

## Naming

Names should communicate intent without requiring the implementation for context.

## Function Length and Responsibility

Flag functions that are too long, mix responsibilities, or require more than one sentence to describe cleanly.

## Error Handling

Every async operation should have explicit error handling. Flag swallowed exceptions, empty catches, and error messages without enough context.

## Logging

Logs should include useful structured context and must not leak sensitive data.

## DRY Principle

Flag duplication that should be extracted, but also flag abstractions that are harder to understand than the duplication they replace.

## Code Clarity

Prefer readable conditions, named constants, and extracted predicates over dense boolean logic and magic values.
`,
    ),
  },
]

export function getBuiltinSkillFiles(): Array<{ relativePath: string; content: string }> {
  return BUILTIN_SKILLS.map((skill) => ({
    relativePath: `.agent-orchestra/skills/${skill.id}/SKILL.md`,
    content: skill.content,
  }))
}

export function getBuiltinSkillsetsYaml(): string {
  return `# Agent Orchestra — Built-in skill sets
# Auto-generated by: agent-orchestra init
# This file is safe to keep alongside your own custom .agent-orchestra/skillsets.yaml.

skillsets:
  - id: security-review
    name: Security Review
    description: OWASP-guided review helpers for security-focused runs.
    skills:
      - security-review
    contextBudgetPercent: 30

  - id: plan-review
    name: Plan Review
    description: Skills for reviewing implementation plans, roadmaps, and RFCs for sequencing, scope, dependencies, risks, and implementation readiness.
    skills:
      - sequencing-check
      - dependency-check
      - scope-discipline
      - implementation-readiness
      - risk-check
    contextBudgetPercent: 30
`
}
