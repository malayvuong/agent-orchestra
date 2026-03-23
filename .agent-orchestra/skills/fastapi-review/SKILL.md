---
name: FastAPI Review
description: Deep review of FastAPI applications — dependency injection, Pydantic validation, async patterns, middleware, security, and OpenAPI contract correctness.
version: 2026.3.1
license: MIT
triggers:
  lenses:
    - logic
    - security
    - performance
  keywords:
    - fastapi
    - pydantic
    - starlette
    - uvicorn
    - python api
---

When reviewing FastAPI code, apply the following framework-specific checks.

## Dependency Injection

Verify `Depends()` is used for shared logic (auth, database sessions, config). Flag endpoint functions that instantiate database connections or HTTP clients directly — these should be injected dependencies for testability and lifecycle management.

Check that dependencies with cleanup logic use `yield` syntax to ensure teardown runs after the response is sent. Flag dependencies that open resources (DB connections, file handles) without corresponding cleanup.

Verify dependency scoping: request-scoped dependencies should not be cached across requests. Flag `@lru_cache` on dependencies that should be fresh per request (e.g., current user, database session).

## Pydantic Model Validation

Verify all endpoint inputs use Pydantic models or typed parameters — not raw `dict` or `Any`. Flag endpoints that accept `body: dict` instead of a typed model. Check that Pydantic models use `Field()` with appropriate constraints (`min_length`, `max_length`, `ge`, `le`, `regex`) for user-facing inputs.

Flag models that use `model_config = ConfigDict(extra='allow')` on external input models — this permits arbitrary fields and defeats input validation.

Check that response models are defined with `response_model` parameter or return type annotation. Flag endpoints that return raw dicts or untyped responses — this breaks OpenAPI documentation and client code generation.

## Async vs Sync

Verify `async def` is used for endpoints that perform I/O (database queries, HTTP calls, file reads). Flag `def` endpoints that call `await` — this is a syntax error. Flag `async def` endpoints that call blocking I/O functions (e.g., `open()`, `requests.get()`, `time.sleep()`) without wrapping in `run_in_executor` — this blocks the entire event loop.

Check that database drivers are async-compatible (e.g., `asyncpg`, `aiosqlite`, `motor`) when used in async endpoints. Flag mixing sync ORMs (SQLAlchemy sync session) with async endpoints without proper thread pool delegation.

## Security

Verify authentication dependencies check tokens on every protected endpoint — not just at the router level where sub-routes might bypass it. Flag endpoints that return user data without filtering sensitive fields (password hashes, internal IDs, tokens).

Check that CORS middleware is configured with specific allowed origins — not `allow_origins=["*"]` in production. Verify rate limiting is applied to authentication endpoints.

Flag SQL queries built with f-strings or `.format()` — use parameterized queries even with ORMs. Check that file upload endpoints validate file type, size, and content — not just the extension.

## Error Handling

Verify custom exception handlers are registered for expected error types. Flag bare `except Exception` blocks that swallow errors silently. Check that error responses use consistent structure (not sometimes a string, sometimes a dict).

Verify that internal error details (stack traces, database errors, file paths) are not returned to the client in production. Flag `HTTPException(detail=str(e))` where `e` could contain sensitive information.

## Middleware and Lifecycle

Check startup and shutdown event handlers for proper resource initialization and cleanup. Flag middleware that modifies the request body — this can break request parsing for downstream handlers. Verify logging middleware does not log request/response bodies containing sensitive data (passwords, tokens, PII).

## OpenAPI Contract

Verify endpoint docstrings are present — they become the API documentation. Flag endpoints without `tags` parameter — untagged endpoints clutter the OpenAPI UI. Check that status codes in `responses` parameter match the actual status codes returned by the endpoint logic.

For each finding, report: the endpoint path, the specific FastAPI pattern violated, and the recommended fix.
