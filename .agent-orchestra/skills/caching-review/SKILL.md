---
name: Caching Strategy Review
description: Deep review of caching implementation — invalidation patterns, TTL strategy, cache stampede prevention, consistency guarantees, and common caching bugs.
version: 2026.3.1
license: MIT
triggers:
  lenses:
    - performance
    - logic
  keywords:
    - cache
    - redis
    - memcached
    - ttl
    - invalidation
    - cdn
---

When reviewing caching implementation, apply the following checks.

## Cache Invalidation

Flag cache writes without a corresponding invalidation strategy. For every cached value, verify there is a clear answer to: "when does this cache entry become stale, and what triggers its removal?" Flag time-based expiration as the only invalidation mechanism for data that changes on user action — users expect immediate consistency after their own writes.

Check for write-through vs write-behind patterns. Verify that after a database write, the cache is either invalidated (delete) or updated (set) in the same transaction boundary. Flag patterns where the cache is updated but the database write can fail — this creates phantom data visible only in cache.

Flag cache keys that do not include all the parameters that affect the cached value. Example: caching a user's dashboard without including the user ID in the key serves the wrong data to other users.

## Cache Stampede

Flag hot cache keys that, when expired, trigger expensive recomputation from many concurrent requests simultaneously. Verify at least one stampede prevention mechanism is in place:

- Lock-based: only one request recomputes while others wait or serve stale
- Probabilistic early expiration: recompute before TTL expires with increasing probability
- Background refresh: a separate process refreshes the cache before expiration

Flag TTL values that cause synchronized expiration across many keys (e.g., all keys set with exactly 3600s TTL at startup expire simultaneously).

## Consistency

Flag eventually-consistent caches on data where users expect read-after-write consistency — profile updates, settings changes, permission changes. Verify that the user who made the change sees the updated value immediately, even if other users see stale data briefly.

Check for race conditions between cache invalidation and database replication lag. Flag patterns where the cache is invalidated, then immediately re-populated from a read replica that hasn't received the write yet — this re-caches stale data.

Flag caches that store derived or aggregated data without tracking which source records contribute to the aggregate — any source change should invalidate the aggregate, but without tracking, stale aggregates persist.

## TTL Strategy

Flag TTL values without documented justification — every TTL should reflect a conscious decision about acceptable staleness. Flag extremely long TTLs (> 24 hours) on user-facing data without explicit invalidation paths. Flag extremely short TTLs (< 1 second) that provide no meaningful caching benefit but add complexity.

Check that TTL is set on every cache write — flag cache entries without expiration that can grow unbounded. Verify TTLs have jitter (random offset) to prevent synchronized expiration across keys.

## Cache Key Design

Verify cache keys are namespaced to prevent collisions between different features. Flag cache keys built from user input without sanitization or hashing — special characters can break key parsing. Check that cache keys include a version or schema identifier so cache format changes don't serve corrupted data.

Flag cache keys that are too long (> 250 bytes for Memcached, varies for Redis) — hash the key or redesign the namespace. Verify cache keys are deterministic — the same inputs must always produce the same key.

## Serialization

Flag caching of objects with circular references — most serializers will fail or produce corrupt data. Check that cached objects are serialized to a compact format (JSON, MessagePack, Protocol Buffers) — not language-specific serialization (pickle, PHP serialize) which is both slow and a deserialization attack vector.

Verify cached data is deserialized with schema validation — the cached format may be from a previous code version with different field names or types.

## Memory and Eviction

Flag in-memory caches without size limits — they grow until the process runs out of memory. Verify LRU or LFU eviction is configured. Check that cache metrics (hit rate, miss rate, eviction rate) are monitored — a cache with < 80% hit rate may not be worth the complexity.

Flag caching of large objects (> 1MB) without compression. Verify that cache failures (Redis down, network timeout) are handled gracefully — the application should fall through to the source, not crash.

For each finding, report: the cache key or pattern, the specific caching issue, the production impact, and the recommended fix.
