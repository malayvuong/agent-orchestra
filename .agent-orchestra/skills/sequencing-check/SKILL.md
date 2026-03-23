---
name: Sequencing Check
description: Detects ordering problems, prerequisite violations, and temporal dependencies in implementation plans.
version: 2026.3.1
license: MIT
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
    - ordering
---

When reviewing an implementation plan, check for sequencing and ordering issues.

## Prerequisite Violations

For each step or phase, verify that all prerequisites are satisfied by prior steps. Flag any step that depends on work not yet completed or not scheduled earlier. Look for implicit dependencies — where a step assumes infrastructure, permissions, data, or capabilities that only exist after a later step.

## Temporal Dependencies

Identify steps that have hard temporal ordering requirements (e.g., "database migration before API deployment"). Flag cases where parallel execution is assumed but sequential execution is required. Check whether critical-path items are identified and prioritized appropriately.

## Early vs. Late Ordering

Flag steps that appear too early (building on foundations not yet laid) or too late (blocking other work unnecessarily). Look for "chicken-and-egg" situations where two steps each require the other to go first.

## Phase Boundary Issues

Check that phase transitions have clear entry and exit criteria. Flag work that spans phase boundaries without acknowledgment. Verify that rollback points exist at phase boundaries.

For each finding, report: the specific steps involved, what prerequisite is violated, and a suggested reordering or dependency resolution.