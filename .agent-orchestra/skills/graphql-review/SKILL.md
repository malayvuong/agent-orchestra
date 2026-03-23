---
name: GraphQL Review
description: Deep review of GraphQL implementations — query complexity, N+1 resolution, schema design, authorization, subscriptions, and common GraphQL-specific vulnerabilities.
version: 2026.3.1
license: MIT
triggers:
  lenses:
    - security
    - performance
  keywords:
    - graphql
    - resolver
    - schema
    - query
    - mutation
    - subscription
    - dataloader
---

When reviewing GraphQL implementations, apply the following checks.

## Query Depth and Complexity

Verify query depth limiting is enforced — without it, attackers can craft deeply nested queries that exhaust server resources. Flag schemas without `depthLimit` or equivalent middleware. Recommended maximum depth: 7-10 levels depending on schema shape.

Verify query complexity analysis is enabled — assign cost to each field and reject queries that exceed a total cost budget. Flag fields that return lists without a complexity multiplier — `users { posts { comments { replies } } }` can return millions of records.

Check that introspection is disabled in production — introspection exposes the entire schema to attackers for reconnaissance. Flag `introspection: true` in production configuration.

## N+1 Resolution

Verify DataLoader (or equivalent batching mechanism) is used for every resolver that fetches data from a database or external service. Flag resolvers that execute a database query per parent item — in a `users { posts }` query with 100 users, the `posts` resolver fires 100 times without DataLoader.

Check that DataLoader instances are created per-request, not shared across requests — shared DataLoaders cache data across users and create data leakage. Verify batch functions handle the case where some keys have no data (return `null` in the correct position).

## Schema Design

Verify `ID` type is used for entity identifiers, not `String` or `Int`. Flag nullable fields that should be non-null — the schema should reflect reality, not be permissive for convenience. Check that list fields use `[Type!]!` (non-null list of non-null items) when empty lists and null items are not valid states.

Flag input types that reuse output types — input and output types should be separate to avoid exposing server-computed fields in mutations. Verify mutation inputs use dedicated input types (`CreateUserInput`, `UpdatePostInput`) not the entity type itself.

Check pagination: verify relay-style cursor pagination (`first`, `after`, `last`, `before`) or offset pagination with mandatory limits. Flag collection fields without pagination — these return unbounded result sets.

## Authorization

Verify authorization is checked in resolvers or middleware, not in the client. Flag schemas where sensitive fields (email, phone, salary) are queryable without field-level authorization. Check that authorization is checked at the resolver level, not just the query level — a user authorized to query their own data should not see other users' private fields through nested queries.

Flag mutations without authorization checks. Verify that `viewer` or `currentUser` patterns correctly scope data access — a query like `user(id: "other-user") { email }` should be denied or return null for non-admin users.

## Subscriptions

Verify WebSocket connections for subscriptions are authenticated — flag subscription endpoints that accept unauthenticated connections. Check that subscriptions have a maximum number of concurrent subscriptions per client to prevent resource exhaustion.

Flag subscriptions that broadcast to all subscribers without filtering — each subscription should only receive events relevant to its filter criteria. Verify subscription cleanup occurs when the client disconnects.

## Error Handling

Verify errors follow the GraphQL error specification with `message`, `locations`, `path`, and optional `extensions`. Flag error responses that include stack traces, database errors, or internal file paths. Check that partial errors are supported — a query that succeeds for some fields but fails for others should return both data and errors, not fail entirely.

Flag mutation resolvers that swallow errors and return null — the client cannot distinguish between "not found" and "error." Use union types (`CreateUserResult = User | ValidationError | NotFoundError`) for typed error responses.

## Performance

Flag resolvers that perform expensive computations synchronously on the event loop. Verify field-level caching is considered for frequently accessed computed fields. Check that query result caching respects authorization — cached results must not leak data across users.

For each finding, report: the schema type or resolver, the specific GraphQL pattern violated, and the recommended fix.
