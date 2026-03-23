---
name: Logging & Observability Review
description: Deep review of logging implementation — structured logging, correlation IDs, log levels, PII handling, distributed tracing, and incident response readiness.
version: 2026.3.1
license: MIT
triggers:
  lenses:
    - logic
    - security
  keywords:
    - logging
    - log
    - trace
    - observability
    - monitoring
    - debug
---

When reviewing logging and observability code, apply the following checks.

## Structured Logging

Flag `console.log()`, `print()`, or string-interpolated log messages in production code — use structured logging with key-value pairs (JSON format). Unstructured logs cannot be searched, filtered, or aggregated by log management systems.

Verify every log entry includes: timestamp (ISO 8601), log level, service name, and a message. Flag log messages that are ambiguous without context — "Error occurred" tells an oncall engineer nothing. Good: `{"level":"error","service":"payment","action":"charge","userId":"u123","error":"timeout after 5000ms"}`.

## Log Levels

Verify log levels are used consistently: `ERROR` for actionable failures that need investigation, `WARN` for degraded but functional states, `INFO` for significant business events, `DEBUG` for development diagnostics. Flag `ERROR` level for expected business conditions (user not found, validation failure) — these are `WARN` or `INFO`.

Flag `DEBUG` level logs in production code paths that execute per-request — these create massive log volume when debug logging is accidentally enabled. Verify debug logging can be toggled per-module without redeployment.

## Sensitive Data

Flag logging of: passwords, tokens, session IDs, credit card numbers, SSN, API keys, or full request/response bodies that may contain PII. Verify log output is sanitized — mask or redact sensitive fields before logging.

Check that error messages forwarded to logs do not include stack traces with file paths, database connection strings, or internal hostnames that aid attackers. Flag `JSON.stringify(request.body)` or `repr(request.data)` in log statements — these dump entire payloads including sensitive fields.

## Correlation and Tracing

Verify every request generates or propagates a correlation ID (request ID, trace ID) that appears in all log entries for that request. Flag log entries that cannot be correlated to a specific user action or request — debugging production issues requires tracing a single request across services.

Check that distributed tracing headers (`traceparent`, `X-Request-ID`) are propagated to downstream service calls, database queries, and queue messages. Flag services that start a new trace instead of continuing the parent trace.

## Error Logging

Verify every `catch` block either logs the error or re-throws it — flag silent `catch {}` blocks that swallow errors. Check that error logs include the error message, stack trace (at appropriate level), and the context that caused the error (input parameters, state).

Flag error logging inside retry loops — log once after all retries are exhausted, not on every attempt. Flag errors that are logged and then re-thrown — this causes duplicate log entries when the caller also logs.

## Performance

Flag logging inside tight loops or per-item processing in batch operations — aggregate and log a summary instead. Flag synchronous file-based logging in request handlers — use async log writers or buffer flushes.

Check that log volume is estimated for production traffic. Flag log configurations that would produce > 1GB/hour per instance without a retention and rotation strategy.

## Metrics and Health

Verify key business metrics are emitted (request count, error rate, latency percentiles, queue depth). Flag services without a `/health` or `/readyz` endpoint. Check that metric labels have bounded cardinality — flag labels that include user IDs, request IDs, or unbounded values (these explode metric storage).

For each finding, report: the file and log statement, the specific logging issue, and the recommended fix.
