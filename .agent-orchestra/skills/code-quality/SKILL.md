---
name: Code Quality
description: General code quality guidelines injected for every agent review. Covers naming, function length, error handling, logging, and DRY principles.
version: 2026.3.1
license: MIT
---

Apply the following code quality guidelines to every piece of code you review.

## Naming

Names must communicate intent without requiring the reader to consult the implementation. Variables should be nouns describing what they hold. Functions should be verbs describing what they do. Boolean variables and functions should use `is`, `has`, or `can` prefixes. Avoid single-letter names outside loop indices. Flag names like `data`, `info`, `temp`, `obj`, or `val` that add no information.

## Function Length and Responsibility

Functions longer than 30 lines are a review signal — they may be doing too much. Each function should have a single, clearly articulable responsibility. If you cannot describe a function's purpose in one sentence without using "and", flag it for extraction. Deeply nested logic (more than 3 levels) should be refactored to early returns or extracted helpers.

## Error Handling

Every async operation must have explicit error handling. Flag empty catch blocks, swallowed exceptions, and unhandled promise rejections. Error messages must include enough context for diagnosis: what operation failed, what input was provided, what was expected. Errors must never expose stack traces or internal paths to end users.

## Logging

Log entries must include structured context: at minimum, the operation name and relevant IDs. Flag log statements that concatenate sensitive data (passwords, tokens, PII). Debug logs should not appear in production code paths. Log levels must be used correctly: `error` for failures requiring action, `warn` for degraded-but-functional states, `info` for significant lifecycle events, `debug` for tracing.

## DRY Principle

Flag logic that is duplicated more than twice. Shared logic should be extracted to a named function or module. Copy-pasted code blocks with minor variation are a smell for a parameterized abstraction. However, flag over-abstraction too: if the abstraction is harder to understand than the duplication, prefer explicit duplication.

## Code Clarity

Prefer positive conditions over double negatives. Flag logic that requires reading the implementation to understand the intent. Magic numbers and strings must be extracted to named constants. Complex boolean expressions should be extracted to well-named predicate functions.
