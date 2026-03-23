---
name: API Design Review
description: Deep review of REST and GraphQL API design — resource modeling, versioning, pagination, error handling, authentication, and contract consistency.
version: 2026.3.1
license: MIT
triggers:
  lenses:
    - logic
    - consistency
  keywords:
    - api
    - rest
    - graphql
    - endpoint
    - openapi
    - swagger
---

When reviewing API design, apply the following checks.

## Resource Modeling

Verify resources are nouns, not verbs. Flag endpoint paths like `/getUsers` or `/createOrder` — use `GET /users` and `POST /orders`. Check that collection endpoints use plural nouns (`/users` not `/user`). Verify nested resources reflect real ownership relationships (`/users/{id}/orders` not `/user-orders`).

Flag endpoints that combine multiple unrelated operations — each endpoint should do one thing. Check that resource identifiers are consistent (all UUID, all slug, all numeric) across the API surface.

## HTTP Methods and Status Codes

Verify `GET` requests are safe (no side effects) and idempotent. Flag `GET` endpoints that create, modify, or delete resources. Verify `PUT` is used for full replacement and `PATCH` for partial updates — flag `PUT` endpoints that accept partial payloads.

Check status codes match semantics: `201` for creation with `Location` header, `204` for successful deletion with no body, `404` for missing resources, `409` for conflicts, `422` for validation errors. Flag `200` returned for all responses regardless of outcome.

## Pagination

Flag collection endpoints that return unbounded results. Verify pagination is implemented with either cursor-based (`?after=<cursor>&limit=20`) or offset-based (`?page=1&per_page=20`) approach. Check that pagination metadata is included in the response (`total`, `next_cursor`, `has_more`).

Flag pagination that uses page numbers for large datasets — cursor-based pagination is more efficient and avoids the "shifting window" problem when data is inserted during pagination.

## Error Response Format

Verify all error responses follow a consistent structure. Flag APIs that return different error shapes from different endpoints. A good error response includes: error code (machine-readable), message (human-readable), and optional field-level validation details.

Flag error messages that expose internal implementation details (database table names, stack traces, file paths). Check that validation errors identify the specific field that failed and why.

## Versioning

Check that the API has a versioning strategy. Flag APIs that modify existing endpoint contracts without a version bump. Verify version is conveyed through URL path (`/v1/users`), header (`Accept: application/vnd.api.v1+json`), or query parameter — but consistently, not mixed.

Flag deprecated endpoints that lack a `Sunset` header or deprecation notice in documentation.

## Authentication and Authorization

Verify all non-public endpoints require authentication. Flag APIs that pass credentials in query parameters — use `Authorization` header. Check that authentication errors return `401` (not authenticated) and authorization errors return `403` (not permitted) — not `404` to hide resources.

Verify rate limiting headers are present (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`). Flag authentication endpoints without rate limiting or brute-force protection.

## Request and Response Design

Flag inconsistent field naming: choose either `camelCase` or `snake_case` and use it everywhere. Flag date fields that use non-ISO-8601 formats. Verify nullable fields are explicitly documented — not silently omitted from responses.

Check that `POST`/`PUT` responses return the created/updated resource — not just an ID or status. Flag APIs that require the client to make a second `GET` request to see the result of a write operation.

## GraphQL-Specific

For GraphQL APIs: verify query depth and complexity limits are enforced to prevent denial-of-service. Flag resolvers that trigger N+1 queries — verify DataLoader or equivalent batching is used. Check that mutations return the modified object to enable cache updates.

For each finding, report: the endpoint or schema location, the design pattern violated, and the recommended fix.
