---
name: Dependency Check
description: Finds hidden dependencies, circular dependencies, and undeclared external requirements in implementation plans.
version: 2026.3.1
license: MIT
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
    - prerequisite
---

When reviewing an implementation plan, check for dependency issues.

## Hidden Dependencies

Identify dependencies that are not explicitly stated but are implied by the plan. Look for:
- Infrastructure that must exist before a step can begin (databases, queues, APIs, services)
- Team or personnel dependencies (skills, availability, approvals)
- Data dependencies (seed data, migrations, imports)
- External service dependencies (third-party APIs, licenses, vendor agreements)

## Circular Dependencies

Detect circular dependency chains where A depends on B, B depends on C, and C depends on A. Even two-step cycles (A needs B, B needs A) must be flagged. Suggest how to break the cycle (interface contracts, stubs, phased rollout).

## Undeclared External Requirements

Flag any step that implicitly requires:
- Budget approval not mentioned in the plan
- Third-party vendor action or SLA
- Regulatory or compliance review
- Hardware or infrastructure provisioning lead time
- Cross-team coordination not scheduled

## Dependency Graph Completeness

Verify that the plan's dependency graph is complete — every non-trivial step should either be independent or have its dependencies explicitly listed. Flag orphan steps that appear disconnected from the rest of the plan.

For each finding, report: the steps involved, the missing or circular dependency, and a concrete recommendation to resolve it.