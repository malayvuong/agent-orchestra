---
name: Monitoring & Alerting Review
description: Deep review of monitoring setup — SLO definition, alert quality, dashboard design, incident response readiness, and common alert anti-patterns.
version: 2026.3.1
license: MIT
triggers:
  lenses:
    - logic
    - risk
  keywords:
    - monitoring
    - alerting
    - slo
    - sli
    - dashboard
    - prometheus
    - grafana
    - pagerduty
---

When reviewing monitoring and alerting configuration, apply the following checks.

## SLO and SLI Definition

Verify the service has defined SLOs (Service Level Objectives) with measurable SLIs (Service Level Indicators). Flag services without explicit availability, latency, or error rate targets. Check that SLOs are expressed as percentages over a rolling window (e.g., "99.9% of requests complete within 500ms over 30 days"), not vague statements.

Verify SLIs are measured from the user's perspective (at the load balancer or API gateway), not internal service metrics. Flag SLIs that measure component health (CPU usage, memory) instead of user-visible behavior (request success rate, response time).

## Alert Quality

Flag alerts that fire on raw thresholds without duration windows — a momentary spike should not page someone at 3am. Verify alerts use sustained conditions: "error rate > 1% for 5 minutes" not "error rate > 1% at any instant."

Flag alerts without clear ownership — every alert must route to a specific team or person. Flag alerts without a runbook link — an oncall engineer receiving an alert at 3am needs immediate guidance, not a ticket to investigate.

Check for alert fatigue: flag services with more than 10 active alerting rules — most should be informational, with only 3-5 paging alerts. Flag alerts that fire more than once per week without resolution — these are either misconfigured or accepted background noise that should be silenced.

## Symptom vs Cause Alerting

Verify alerts fire on symptoms (user-visible impact: error rate, latency, availability) not causes (CPU usage, memory, disk). Flag CPU alerts as paging alerts — high CPU without user impact is not urgent. Flag disk space alerts set at 90% with no action until 95% — alert at the threshold where action is needed.

Flag alerts on individual instance metrics for services that are horizontally scaled — a single unhealthy instance in a pool of 20 is not a user-facing incident.

## Dashboard Design

Verify dashboards have a clear hierarchy: overview dashboard → service dashboard → debug dashboard. Flag dashboards with more than 20 panels — these are unusable during an incident. Check that the overview dashboard answers "is the service healthy?" in under 5 seconds of looking at it.

Verify dashboards show the four golden signals: latency, traffic, errors, saturation. Flag dashboards that show only infrastructure metrics (CPU, memory, disk) without request-level metrics.

Check that dashboards use consistent time ranges and refresh intervals. Flag dashboards with panels that query different time windows — this creates misleading visual correlations.

## Metric Design

Flag metrics with unbounded label cardinality (user ID, request ID, IP address as labels) — these explode storage and query cost. Verify histogram buckets match the expected latency distribution — default buckets are often wrong for specific services.

Flag counters that are used as gauges (reset on restart without handling) and gauges that should be counters (monotonically increasing values). Verify rate calculations use `rate()` or `irate()` over counters, not raw counter values.

## Incident Response Readiness

Verify escalation policies exist — if the primary oncall does not acknowledge within N minutes, the alert escalates. Flag services without a documented incident response procedure. Check that post-incident review (postmortem) is a defined process, not ad-hoc.

Verify monitoring covers dependencies: if the service calls a database, cache, or external API, there should be metrics on those dependency calls (latency, error rate). Flag services that can detect their own failures but not their dependencies' failures.

## Common Anti-Patterns

Flag monitoring that was added after an incident but never reviewed — accumulated reactive monitoring becomes noise. Flag percentage-based alerts on low-traffic services (1 error out of 10 requests = 10% error rate). Verify low-traffic services use absolute counts, not percentages.

Flag missing monitors for critical business flows (user registration, payment, checkout) — even if individual API endpoints are monitored, the end-to-end flow may not be.

For each finding, report: the alert rule or dashboard, the specific monitoring issue, and the recommended fix.
