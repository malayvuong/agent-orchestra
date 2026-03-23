---
name: Database Migration Review
description: Deep review of database migrations — reversibility, zero-downtime safety, index strategy, data integrity, and cross-version compatibility.
version: 2026.3.1
license: MIT
triggers:
  lenses:
    - logic
    - risk
  keywords:
    - migration
    - database
    - schema
    - sql
    - alter table
    - index
---

When reviewing database migrations, apply the following checks.

## Reversibility

Verify every migration has a corresponding down/rollback migration. Flag `DROP TABLE`, `DROP COLUMN`, or `DROP INDEX` operations without a down migration that recreates the dropped object. Check that data migrations (not just schema changes) are reversible — if the up migration transforms data, the down migration must be able to reverse it.

Flag irreversible operations that are not explicitly marked as such. If a migration is intentionally irreversible, it must be documented with a comment explaining why and what the recovery plan is.

## Zero-Downtime Safety

Flag `ALTER TABLE` operations that lock the table for writes on large tables. The following operations are typically unsafe on tables with > 1M rows:

- Adding a `NOT NULL` column without a default value
- Changing a column type
- Adding a unique constraint (requires full table scan)
- Renaming a column or table (breaks application code referencing the old name)

For each, verify the migration uses the safe alternative:

- Add column as nullable → backfill → add NOT NULL constraint
- Create new column → backfill → swap references → drop old column
- Create index `CONCURRENTLY` (PostgreSQL) or use online schema change tools

## Index Strategy

Flag queries that are expected to be common but lack supporting indexes. Verify composite indexes have the correct column order — the most selective column should be first. Flag redundant indexes: if an index on `(a, b)` exists, a separate index on `(a)` alone is redundant.

Flag `CREATE INDEX` without `CONCURRENTLY` on production databases — standard index creation locks the table for writes. Check that indexes on foreign key columns exist — missing FK indexes cause slow joins and cascade deletes.

Flag indexes on low-cardinality columns (boolean, enum with < 5 values) — these rarely improve query performance. Verify partial indexes are considered for queries that filter on a constant condition (`WHERE status = 'active'`).

## Data Integrity

Verify foreign key constraints exist for all references between tables. Flag `ON DELETE CASCADE` on relationships where cascading deletion could destroy large amounts of data unintentionally — prefer `ON DELETE RESTRICT` or `ON DELETE SET NULL` with explicit application-level cleanup.

Check that `NOT NULL` constraints are applied to fields that should never be empty. Flag nullable columns for data that the application treats as required — the constraint should be in the database, not just the application.

Verify `UNIQUE` constraints exist for natural keys (email, username, external ID). Flag tables with duplicate data that should have unique constraints.

## Data Migration Safety

Flag data migrations that load the entire table into memory (`SELECT *`). Verify batch processing is used for large data migrations — process in chunks of 1000-10000 rows with commits between batches.

Check that data migrations handle NULL values and edge cases. Flag migrations that assume all rows have a certain value without verifying. Verify data migrations are idempotent — running the migration twice should produce the same result.

## Cross-Version Compatibility

For applications that deploy with rolling updates (old and new code running simultaneously), verify migrations are backward-compatible. The sequence must be:

1. Deploy migration that adds new columns/tables (backward-compatible)
2. Deploy new application code that uses the new schema
3. Deploy cleanup migration that removes old columns (after old code is fully drained)

Flag migrations that rename or remove columns while old application code is still running. Flag migrations that add `NOT NULL` constraints before the application populates the new column.

## Naming Conventions

Verify table names are plural and consistent (`users`, not `user` or `Users`). Check that foreign key columns follow the pattern `<table_singular>_id`. Verify index names are descriptive (`idx_users_email` not `index_1`).

Flag migrations without a meaningful name or description. Each migration file should describe what it does, not just when it was created.

For each finding, report: the migration file, the specific risk, the potential production impact, and the safe alternative.
