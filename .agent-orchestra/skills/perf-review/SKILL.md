---
name: Performance Review
description: Performance review checklist covering N+1 queries, unnecessary allocations, cache opportunities, async patterns, and bundle size.
version: 2026.3.1
license: MIT
triggers:
  lenses:
    - performance
---

When reviewing code from a performance perspective, apply the following checks.

## N+1 Query Detection

Identify loops that execute database queries or API calls per iteration. Flag any query inside a `for`, `while`, or `map`/`forEach` call. The fix is almost always to batch the operation: use `WHERE id IN (...)`, `DataLoader`, or a single join. Check ORM relationships for lazy-loading traps — accessing a relational property inside a loop without eager loading is a classic N+1 source.

## Unnecessary Allocations

Flag large object or array creation inside hot loops. Intermediate arrays created by chained `.map().filter().map()` calls can often be replaced with a single `.reduce()` or `for` loop. Check for repeated string concatenation in loops — use array join or template literals built outside the loop. Flag closure creation inside render functions or tight loops where stable references would suffice.

## Caching Opportunities

Identify expensive computations (regex compilation, JSON parsing, cryptographic operations, external fetches) that produce the same result for the same inputs. Flag these as candidates for memoization or module-level caching. Check that cache invalidation logic exists and is correct. Verify time-based caches include TTL and that stale data cannot cause correctness issues.

## Async and Concurrency Patterns

Flag sequential `await` calls that could run concurrently with `Promise.all`. Check for async operations inside loops where `Promise.all(items.map(...))` would be more efficient. Verify that concurrent operations have bounded parallelism to avoid overwhelming downstream services. Flag blocking synchronous operations (fs.readFileSync, crypto operations) on hot paths in async code.

## Bundle Size

For front-end code, flag whole-library imports where tree-shakeable named imports are available (e.g., `import _ from 'lodash'` vs `import { debounce } from 'lodash'`). Identify large dependencies added for small utility functions. Flag synchronous dynamic imports in critical rendering paths.

## Memory and Resource Leaks

Check that event listeners, timers, and observers are cleaned up when components unmount or objects are disposed. Flag unbounded caches or queues that can grow without limit. Verify streams are closed after use and that database connections are returned to the pool.
