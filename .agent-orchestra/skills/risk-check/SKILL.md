---
name: Risk Check
description: Highlights unclear assumptions, missing risk mitigations, rollout risks, and timeline risks in implementation plans.
version: 2026.3.1
license: MIT
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
    - rollout
---

When reviewing an implementation plan, check for risk management issues.

## Unclear Assumptions

Identify assumptions that the plan relies on but does not validate. Look for:
- Assumptions about system load, data volume, or user behavior
- Assumptions about third-party service availability or performance
- Assumptions about team capacity, skills, or availability
- Assumptions about timeline that depend on external factors

## Missing Risk Mitigations

For identified risks, check whether mitigations exist:
- What happens if a critical dependency is delayed?
- What happens if a key team member is unavailable?
- What happens if a technical approach doesn't work?
- Is there a fallback plan for each high-risk step?

## Rollout Risks

Assess deployment and rollout safety:
- Is there a rollback plan for each deployment step?
- Are feature flags or gradual rollout mechanisms planned?
- Is there a monitoring and alerting plan for the rollout?
- Are there data migration risks that could cause data loss?
- Is downtime required, and is it acknowledged?

## Timeline Risks

Check for timeline-related risks:
- Steps with no time estimate at all
- Steps where the estimate assumes everything goes right
- No buffer time for unexpected issues
- Critical path with no slack
- Dependencies on external teams or vendors with no SLA

## Single Points of Failure

Flag plan elements that create single points of failure:
- Knowledge concentrated in one person
- Critical steps with no backup plan
- Infrastructure without redundancy
- Decisions that are irreversible once executed

For each finding, report: the specific risk, its potential impact, and a recommended mitigation strategy.