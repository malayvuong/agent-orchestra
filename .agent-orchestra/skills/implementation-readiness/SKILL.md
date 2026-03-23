---
name: Implementation Readiness
description: Assesses whether each step in a plan is concrete enough to execute — checks for measurable exit criteria, task specificity, and actionability.
version: 2026.3.1
license: MIT
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
    - execute
---

When reviewing an implementation plan, assess whether each step is ready for implementation.

## Actionability

For each step, ask: could a competent engineer begin working on this step right now? Flag steps that:
- Describe a goal without specifying how to achieve it
- Use vague language ("improve performance", "enhance security", "refactor")
- Lack concrete deliverables or artifacts
- Cannot be assigned to a single person or team

## Exit Criteria

Check whether each step has measurable completion criteria. Flag steps where:
- "Done" is subjective or undefined
- Success cannot be verified by someone other than the author
- There is no way to test or validate the result
- Acceptance criteria are missing or ambiguous

## Estimation Feasibility

Assess whether steps can be reasonably estimated:
- Flag steps that are too large to estimate (should be broken down)
- Flag steps that combine unrelated work (should be split)
- Flag steps where the work is described but the scope is unbounded
- Check for "spike" or "research" tasks that lack a timebox

## Technical Specification Gaps

Identify missing technical details:
- API contracts or interfaces not defined
- Data models or schema changes not specified
- Integration points with other systems not documented
- Error handling and edge cases not considered
- Migration strategy for existing data or users not addressed

For each finding, report: the underspecified step, what information is missing, and what level of detail would make it implementable.