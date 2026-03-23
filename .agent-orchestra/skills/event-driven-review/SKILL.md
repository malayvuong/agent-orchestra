---
name: Event-Driven Architecture Review
description: Deep review of event-driven systems — message handling, idempotency, ordering guarantees, dead letter queues, schema evolution, and common messaging pitfalls.
version: 2026.3.1
license: MIT
triggers:
  lenses:
    - logic
    - risk
  keywords:
    - event
    - message
    - queue
    - kafka
    - rabbitmq
    - pubsub
    - event sourcing
---

When reviewing event-driven architecture, apply the following checks.

## Idempotency

Verify every message consumer is idempotent — processing the same message twice must produce the same result. Flag consumers that create resources without checking for duplicates first. Check for an idempotency mechanism: deduplication by message ID, optimistic locking with version fields, or upsert semantics.

Flag "at-most-once" delivery configurations on operations that must not be lost (payments, order confirmations). Verify critical operations use "at-least-once" delivery with idempotent consumers, not "exactly-once" semantics (which most systems cannot truly guarantee).

## Message Ordering

Identify operations that depend on message order and verify the messaging system guarantees it (partition-level ordering in Kafka, FIFO queues in SQS). Flag consumers that assume global ordering across partitions or topics — most systems only guarantee ordering within a partition.

Check partition key design: messages that must be processed in order (all events for a single user, all updates to a single entity) should share a partition key. Flag partition keys with low cardinality (e.g., event type) that create hot partitions.

## Dead Letter Queue

Verify a dead letter queue (DLQ) exists for every consumer. Flag consumers that retry indefinitely without a DLQ — a poison message blocks the entire queue forever. Check that DLQ messages are monitored and alerted on — a growing DLQ indicates a systemic problem.

Verify DLQ messages retain enough context to diagnose the failure: original message, error details, consumer version, timestamp. Flag DLQ configurations that discard the original message payload after moving to the DLQ.

## Schema Evolution

Verify message schemas are versioned and backward-compatible. Flag required fields added to existing event schemas without a schema version bump — old consumers will fail on the new field. Check that consumers tolerate unknown fields (forward compatibility).

Flag event schemas that include internal implementation details (database IDs, internal enum values) — events should carry business-meaningful data. Verify a schema registry is used for binary formats (Avro, Protobuf) to detect incompatible changes at publish time.

## Event Design

Verify events carry the state change, not just a notification. Flag events like `{ "type": "order_updated", "orderId": "123" }` that force consumers to call back to the source for the actual data — this creates coupling and race conditions. Prefer `{ "type": "order_updated", "orderId": "123", "status": "shipped", "updatedAt": "..." }`.

Flag events that are too large (> 1MB) — extract large payloads to object storage and include a reference. Flag events that contain the entire entity state when only a few fields changed — consider separate event types for different state transitions.

## Consumer Error Handling

Flag consumers that log errors and continue without tracking failure rate. Verify circuit breakers or backoff mechanisms exist for consumers that fail repeatedly. Check that transient errors (network timeout, temporary unavailability) trigger retries, while permanent errors (invalid message, business rule violation) go directly to DLQ.

Flag consumers that acknowledge messages before processing completes — if the consumer crashes mid-processing, the message is lost. Verify messages are acknowledged only after successful processing and persistence.

## Event Sourcing Specific

If the system uses event sourcing: verify events are immutable once stored. Flag event handlers that modify stored events. Check that the event store supports efficient snapshot creation — replaying millions of events for every aggregate load is not scalable.

Verify projection rebuilds are supported — if a projection bug is discovered, can the projection be deleted and rebuilt from the event store? Flag projections that maintain state not derivable from events.

For each finding, report: the queue/topic and consumer, the specific messaging pattern violated, and the recommended fix.
