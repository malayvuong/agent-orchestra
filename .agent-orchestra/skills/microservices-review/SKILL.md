---
name: Microservices Architecture Review
description: Deep review of microservices patterns — service boundaries, inter-service communication, data ownership, resilience patterns, and distributed system pitfalls.
version: 2026.3.1
license: MIT
triggers:
  lenses:
    - logic
    - risk
  keywords:
    - microservice
    - service
    - grpc
    - api gateway
    - circuit breaker
    - saga
---

When reviewing microservices architecture, apply the following checks.

## Service Boundaries

Flag services that share a database — this is a distributed monolith, not microservices. Each service should own its data and expose it only through its API. Flag direct database queries from one service to another service's tables.

Flag services that require synchronous calls to multiple other services to complete a single request — this creates a distributed call chain where any service failure cascades. Verify critical paths have at most 2-3 synchronous hops.

Check that service boundaries align with business domains (bounded contexts), not technical layers. Flag a "user service" that also handles authentication, notifications, and billing — these are separate domains.

## Inter-Service Communication

Verify synchronous calls (HTTP, gRPC) are used only when the caller needs an immediate response. Flag synchronous calls for operations that could be eventual (sending emails, updating analytics, generating reports) — use async messaging for these.

Check that service-to-service calls include timeouts, retries with exponential backoff, and circuit breakers. Flag HTTP calls without timeout configuration — the default is often infinite, causing thread exhaustion when a downstream service hangs.

Verify idempotency keys are used for retry-safe operations. Flag `POST` endpoints called with retries that can create duplicate resources. Check that message consumers are idempotent — messages may be delivered more than once.

## Circuit Breaker Pattern

Verify circuit breakers are configured on all outbound service calls. Flag circuit breakers with thresholds that are too sensitive (1 failure triggers open) or too lenient (100 failures before open). Check that the circuit breaker has a half-open state that allows test requests through to detect recovery.

Verify fallback behavior is defined for each circuit breaker — what does the service do when its dependency is unavailable? Flag services that return 500 when a non-critical dependency is down — degrade gracefully with cached data or partial responses.

## Data Consistency

Flag distributed transactions (two-phase commit) across services — these are fragile and slow. Verify the saga pattern is used for multi-service operations: each service performs its local transaction and publishes an event; compensating transactions handle rollback.

Check that compensating transactions are defined for every step in a saga. Flag sagas where one step has no rollback mechanism — if step 3 of 5 fails, steps 1 and 2 must be reversible.

Verify eventual consistency windows are acceptable for the business case. Flag user-facing flows that require immediate consistency across services but use eventual consistency — users will see stale or conflicting data.

## Service Discovery and Configuration

Verify services do not hardcode the addresses of their dependencies. Flag `http://user-service:8080` in code — use service discovery, DNS, or environment-injected configuration. Check that configuration changes do not require redeployment.

Verify health checks distinguish between "service is alive" (liveness) and "service can handle requests" (readiness). Flag health checks that return 200 when the service cannot reach its database.

## API Versioning and Contracts

Verify services maintain backward-compatible APIs — flag breaking changes (removed fields, changed types, new required fields) without API version bumps. Check that integration contracts are tested (consumer-driven contract tests or schema validation).

Flag services that deploy together and must be released in a specific order — this indicates hidden coupling. Truly independent services can be deployed in any order.

## Observability

Verify distributed tracing spans the full request path across services. Flag services that do not propagate trace context to downstream calls. Check that each service emits metrics for its own health and for every dependency call.

For each finding, report: the services involved, the specific pattern violated, the production risk, and the recommended fix.
