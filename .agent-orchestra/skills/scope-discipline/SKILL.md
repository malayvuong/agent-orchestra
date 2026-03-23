---
name: Scope Discipline
description: Flags over-scoping, premature complexity, scope creep indicators, and missing MVP cuts in implementation plans.
version: 2026.3.1
license: MIT
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
    - priority
---

When reviewing an implementation plan, check for scope discipline issues.

## Over-Scoping

Flag steps or features that go beyond what is needed for the stated goal. Look for:
- Features described as "nice to have" that are scheduled as required work
- Optimization work planned before the basic functionality is proven
- Multiple implementation options being pursued in parallel instead of picking one
- Infrastructure scaling work planned before baseline load is measured

## Premature Complexity

Identify unnecessary complexity introduced too early:
- Abstraction layers built before the second use case exists
- Generic frameworks created for a single known use case
- Distributed system patterns applied to single-service problems
- Caching layers added before performance is measured

## Missing MVP Cuts

Check whether the plan identifies what can be deferred. Flag plans that:
- Have no explicit "out of scope" or "deferred" section
- Treat all features as equal priority with no tiering
- Lack a clear definition of "done" for the minimum viable version
- Include polish, documentation, or hardening work interleaved with core feature work

## Scope Creep Indicators

Look for language that suggests scope creep:
- "While we're at it, we should also..."
- "It would be easy to add..."
- "We might as well..."
- Steps that expand scope without justification
- Features added without corresponding timeline or resource adjustments

For each finding, report: the specific scope issue, why it's problematic for the current milestone, and what should be deferred or cut.