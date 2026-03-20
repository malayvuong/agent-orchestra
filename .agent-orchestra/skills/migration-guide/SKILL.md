---
name: Migration Guide
description: Framework migration patterns for code review. Covers dependency audits, breaking change detection, incremental migration strategy, and rollback planning.
version: 1.0.0
license: MIT
triggers:
  keywords:
    - migrate
    - migration
    - upgrade
---

When reviewing migration code — framework upgrades, library replacements, or API version transitions — apply the following checks.

## Dependency Audit

Verify the `package.json` diff is intentional and minimal. Flag transitive dependency version conflicts introduced by the upgrade (use `pnpm why <package>` patterns). Check that peer dependency requirements are satisfied. Identify any removed dependencies that may still be needed by application code not yet migrated. Confirm `pnpm-lock.yaml` or equivalent is updated consistently.

## Breaking Change Detection

Cross-reference the migration against the library's official changelog or migration guide. For each changed API, verify all call sites in the codebase have been updated — not just the files in the current PR. Flag deprecated API usage that still functions but will be removed in a future version. Check type signature changes: TypeScript compilation errors may be suppressed but runtime errors remain.

## Incremental Migration Strategy

Large migrations must be broken into independently deployable steps. Flag PRs that attempt to migrate everything at once. Verify compatibility shims or adapters are used where old and new API must coexist during transition. Check that feature flags or environment variables gate new behavior so rollback is possible without a code deployment.

## Rollback Plan

Every migration PR must have a clear rollback path. Verify database schema migrations are reversible (down migrations exist). Check that environment variable or configuration changes are documented and reversible. Flag migrations that delete data or make irreversible API contract changes without explicit stakeholder sign-off noted in the PR description.

## Regression Surface

Identify which test fixtures, snapshots, or golden files need updating as a result of behavioral changes. Flag snapshot updates that mask real behavioral differences — each changed snapshot should be manually reviewed, not bulk-accepted. Verify integration and end-to-end tests cover the migrated paths. Check that CI passes on the exact dependency versions in the lockfile, not just resolved ranges.

## Configuration and Environment

Verify new required environment variables are documented in `.env.example`. Flag configuration keys that changed names without a deprecation alias. Check that secrets rotation is included in the migration plan if API keys or credentials changed format.
