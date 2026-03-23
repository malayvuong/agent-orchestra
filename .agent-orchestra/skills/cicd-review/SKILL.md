---
name: CI/CD Pipeline Review
description: Deep review of CI/CD pipelines — GitHub Actions, secrets management, caching strategy, build optimization, deployment safety, and security hardening.
version: 2026.3.1
license: MIT
triggers:
  lenses:
    - security
    - logic
  keywords:
    - ci
    - cd
    - github actions
    - pipeline
    - workflow
    - deploy
---

When reviewing CI/CD configuration, apply the following checks.

## Secrets Management

Flag secrets hardcoded in workflow files — use repository or environment secrets. Flag `echo ${{ secrets.TOKEN }}` — this prints the secret to logs even though GitHub masks known values; log masking is not guaranteed for derived values.

Verify secrets are scoped to the minimum required environment (production secrets only available in the production environment). Flag workflows that pass secrets to third-party actions via environment variables without reviewing the action source.

Check that `GITHUB_TOKEN` permissions are restricted with `permissions:` block — the default token has write access to the repository. Flag `permissions: write-all`.

## Action Security

Flag third-party actions pinned to a branch (`uses: owner/action@main`) instead of a commit SHA (`uses: owner/action@abc123`). Branch references can be silently updated to malicious code. Verify high-privilege actions (deploy, publish, release) use SHA-pinned versions.

Flag `pull_request_target` trigger with `actions/checkout` of the PR branch — this executes untrusted PR code with write permissions. Flag `workflow_dispatch` without input validation.

## Caching

Verify dependency caching is enabled for package managers (npm, pnpm, pip, cargo). Flag workflows that install dependencies from scratch on every run. Check that cache keys include the lockfile hash to invalidate on dependency changes.

Flag Docker layer caching that uses `type=gha` without `scope` — this can leak layers between unrelated workflows. Verify build caches are scoped to the branch.

## Build Optimization

Flag sequential steps that could run in parallel using a matrix strategy. Flag duplicate `npm install` or `pip install` across multiple jobs — use a shared setup job with artifact upload. Check that `--frozen-lockfile` (pnpm) or `--ci` (npm) is used — installing without lockfile verification can produce non-reproducible builds.

Flag test suites that run the entire suite on every PR — use test splitting or affected-file detection for large repositories.

## Deployment Safety

Verify production deployments have a manual approval step (environment protection rules). Flag direct pushes to production without a staging/preview deployment. Check that rollback procedures exist — deployment workflows should support reverting to the previous version.

Flag deployments that do not verify health after deploying (no smoke test or health check step). Verify database migrations run before the new application version starts, not after.

## Workflow Structure

Flag `continue-on-error: true` on critical steps (tests, security scans, linting) — failures should block the pipeline. Flag missing `timeout-minutes` on jobs — default timeout is 6 hours, which wastes resources on hung jobs.

Verify status checks are required for the default branch — flag repositories where PRs can be merged without passing CI. Check that branch protection rules enforce up-to-date branches before merging.

For each finding, report: the workflow file and step, the specific CI/CD pattern violated, and the recommended fix.
