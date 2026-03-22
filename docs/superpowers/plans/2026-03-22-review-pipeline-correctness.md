# Review Pipeline Correctness Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the review/apply pipeline truthful and auditable for nested folder scopes, Markdown-linked entry files, multi-file auto-apply, per-agent provider selection, and superpower skill injection.

**Architecture:** Introduce two shared composition seams in the CLI layer: `targeting` for scope discovery/content assembly and `providers/superpowers` for pure planning before any provider or prompt execution. In core, extend the persisted job/round model just enough to carry target provenance, materialized skills, and truthful apply results, then teach `SingleChallengerRunner` to use those values without reloading ambient state.

**Tech Stack:** TypeScript, Vitest, Commander, Node fs/path APIs, existing `@agent-orchestra/core` + `@agent-orchestra/providers` packages.

---

## Chunk 1: Shared Target Resolution

### Task 1: Build and test the shared target resolver

**Files:**
- Create: `apps/cli/src/targeting/resolve-target.ts`
- Create: `apps/cli/src/targeting/markdown-links.ts`
- Create: `apps/cli/src/targeting/read-scope.ts`
- Create: `apps/cli/src/__tests__/target-resolution.test.ts`

- [ ] **Step 1: Write the failing tests for directory recursion, Markdown expansion, cycle handling, and path normalization**

Add cases covering:
- recursive directory targets include nested files
- Markdown entry file includes itself plus repo-local linked files
- Markdown expansion is recursive but deduplicated on cycles
- external links are ignored
- unreadable linked files do not fail the entry file
- workspace-relative labels round-trip back to canonical absolute paths

- [ ] **Step 2: Run the new target-resolution suite and verify RED**

Run: `pnpm vitest run apps/cli/src/__tests__/target-resolution.test.ts`
Expected: FAIL because the shared targeting modules do not exist yet.

- [ ] **Step 3: Implement the minimal resolver, link extraction, and scope reader**

Implementation notes:
- normalize to canonical absolute workspace paths
- order `resolvedFiles` deterministically by workspace-relative path
- keep `ResolvedTarget.discovery` reasons explicit
- have `read-scope.ts` produce the aggregated `--- relative/path ---` brief text without silent truncation

- [ ] **Step 4: Run the target-resolution suite and verify GREEN**

Run: `pnpm vitest run apps/cli/src/__tests__/target-resolution.test.ts`
Expected: PASS

### Task 2: Wire CLI and MCP to the shared targeting seam

**Files:**
- Modify: `apps/cli/src/commands/run.ts`
- Modify: `apps/cli/src/mcp/handlers.ts`
- Modify: `apps/cli/src/__tests__/mcp-tools.test.ts`
- Create: `apps/cli/src/__tests__/run-targeting.test.ts`

- [ ] **Step 1: Write failing wiring tests**

Add cases covering:
- `run` no longer reads only top-level directory files
- MCP `review_target` uses the same shared resolver as CLI
- a Markdown hub target expands linked repo-local files

- [ ] **Step 2: Run the wiring tests and verify RED**

Run: `pnpm vitest run apps/cli/src/__tests__/run-targeting.test.ts apps/cli/src/__tests__/mcp-tools.test.ts`
Expected: FAIL because `run.ts` and `handlers.ts` still use private `readTarget()` implementations.

- [ ] **Step 3: Replace the duplicated `readTarget()` logic with the shared targeting modules**

- [ ] **Step 4: Re-run the wiring tests and verify GREEN**

Run: `pnpm vitest run apps/cli/src/__tests__/run-targeting.test.ts apps/cli/src/__tests__/mcp-tools.test.ts`
Expected: PASS

## Chunk 2: Provider Planning and Skill Materialization

### Task 3: Add a pure provider-planning step before any provider instantiation

**Files:**
- Create: `apps/cli/src/providers/resolve-provider.ts`
- Modify: `apps/cli/src/commands/run.ts`
- Modify: `apps/cli/src/mcp/handlers.ts`
- Create: `apps/cli/src/__tests__/provider-resolution.test.ts`
- Modify: `apps/cli/src/__tests__/per-agent-provider.test.ts`

- [ ] **Step 1: Write failing tests for per-agent provider planning**

Add cases covering:
- explicit architect/reviewer config avoids eager unused OpenAI creation
- CLI `auto` resolves only after per-agent precedence is computed
- MCP uses the same precedence model without a hardcoded OpenAI default
- MCP builds a router-capable executor when architect/reviewer differ

- [ ] **Step 2: Run the provider suite and verify RED**

Run: `pnpm vitest run apps/cli/src/__tests__/provider-resolution.test.ts apps/cli/src/__tests__/per-agent-provider.test.ts`
Expected: FAIL because provider creation is still eager and MCP still passes a single provider.

- [ ] **Step 3: Implement the provider-plan helper and wire both CLI and MCP through it**

Implementation notes:
- keep provider planning pure until the final instantiation step
- instantiate `ProviderRouter` only after normalized provider/model plans exist
- register concrete providers by agent ID for every enabled agent

- [ ] **Step 4: Re-run the provider suite and verify GREEN**

Run: `pnpm vitest run apps/cli/src/__tests__/provider-resolution.test.ts apps/cli/src/__tests__/per-agent-provider.test.ts`
Expected: PASS

### Task 4: Materialize superpower skills on the create-and-run path

**Files:**
- Create: `apps/cli/src/superpowers/resolve-run-skills.ts`
- Modify: `apps/cli/src/commands/run.ts`
- Modify: `apps/cli/src/mcp/handlers.ts`
- Modify: `packages/core/src/types/orchestrator.ts`
- Modify: `packages/core/src/protocols/single-challenger.ts`
- Modify: `packages/core/src/protocols/__tests__/single-challenger.test.ts`
- Create: `apps/cli/src/__tests__/superpower-skill-wiring.test.ts`

- [ ] **Step 1: Write failing tests for skill materialization and prompt injection**

Add cases covering:
- CLI flattens skill IDs + skillset IDs to concrete `SkillDefinition[]`
- MCP does the same flattening path
- `SingleChallengerRunner` calls `ContextBuilder.buildFor(..., { skills, lifecyclePoint })`
- `runtimeConfigPatch.skillBudgetPercent` is visible in the job used for prompt building

- [ ] **Step 2: Run the skill-wiring suite and verify RED**

Run: `pnpm vitest run apps/cli/src/__tests__/superpower-skill-wiring.test.ts packages/core/src/protocols/__tests__/single-challenger.test.ts`
Expected: FAIL because no shared materialization helper exists and the runner still calls `buildFor(agent, job)` without skills.

- [ ] **Step 3: Implement the shared materialization helper and thread `resolvedSkills` into protocol deps**

- [ ] **Step 4: Re-run the skill-wiring suite and verify GREEN**

Run: `pnpm vitest run apps/cli/src/__tests__/superpower-skill-wiring.test.ts packages/core/src/protocols/__tests__/single-challenger.test.ts`
Expected: PASS

## Chunk 3: Core Persistence and Truthful Apply

### Task 5: Extend the job model with target provenance and keep storage/orchestrator compatible

**Files:**
- Modify: `packages/core/src/types/job.ts`
- Modify: `packages/core/src/storage/types.ts`
- Modify: `packages/core/src/storage/job-store.ts`
- Modify: `packages/core/src/orchestrator/orchestrator.ts`
- Modify: `packages/core/src/storage/__tests__/job-store.test.ts`
- Modify: `packages/core/src/orchestrator/__tests__/orchestrator.test.ts`

- [ ] **Step 1: Write failing tests for `targetResolution` persistence through `createJob()`**

Add cases covering:
- `JobStore.create()` persists `targetResolution`
- `Orchestrator.createJob()` requires and forwards `targetResolution`
- legacy jobs without `targetResolution` still load

- [ ] **Step 2: Run the job/orchestrator suites and verify RED**

Run: `pnpm vitest run packages/core/src/storage/__tests__/job-store.test.ts packages/core/src/orchestrator/__tests__/orchestrator.test.ts`
Expected: FAIL because `Job` and `CreateJobParams` do not carry `targetResolution`.

- [ ] **Step 3: Implement the minimal type and persistence changes**

- [ ] **Step 4: Re-run the job/orchestrator suites and verify GREEN**

Run: `pnpm vitest run packages/core/src/storage/__tests__/job-store.test.ts packages/core/src/orchestrator/__tests__/orchestrator.test.ts`
Expected: PASS

### Task 6: Replace single-file apply with truthful multi-file apply rounds

**Files:**
- Modify: `packages/core/src/types/protocol.ts`
- Modify: `packages/core/src/storage/__tests__/round-store.test.ts`
- Modify: `packages/core/src/protocols/single-challenger.ts`
- Modify: `packages/core/src/protocols/__tests__/single-challenger.test.ts`
- Modify: `apps/cli/src/commands/run.ts`
- Create: `apps/cli/src/__tests__/auto-apply-reporting.test.ts`

- [ ] **Step 1: Write failing tests for apply parsing, apply persistence, and truthful reporting**

Add cases covering:
- valid multi-file apply blocks write only changed in-scope files
- unchanged files land in `unchangedFiles`
- malformed or out-of-scope blocks land in `skippedFiles`
- apply round persists `state: 'apply'` with `applySummary`
- CLI output no longer claims `applied` when zero files were written

- [ ] **Step 2: Run the apply suites and verify RED**

Run: `pnpm vitest run packages/core/src/protocols/__tests__/single-challenger.test.ts packages/core/src/storage/__tests__/round-store.test.ts apps/cli/src/__tests__/auto-apply-reporting.test.ts`
Expected: FAIL because apply is still single-file, stored as analysis, and CLI reporting is optimistic.

- [ ] **Step 3: Implement `runApplyStep()` and wire the CLI summary to persisted `applySummary`**

Implementation notes:
- do not reuse `runStep()` for apply
- persist the apply round only after file writes finish
- keep legacy rounds readable

- [ ] **Step 4: Re-run the apply suites and verify GREEN**

Run: `pnpm vitest run packages/core/src/protocols/__tests__/single-challenger.test.ts packages/core/src/storage/__tests__/round-store.test.ts apps/cli/src/__tests__/auto-apply-reporting.test.ts`
Expected: PASS

## Chunk 4: Read Surfaces and Final Verification

### Task 7: Surface provenance and apply summaries in CLI and MCP read models

**Files:**
- Modify: `apps/cli/src/commands/job.ts`
- Modify: `apps/cli/src/mcp/handlers.ts`
- Create: `apps/cli/src/__tests__/job-command.test.ts`
- Modify: `apps/cli/src/__tests__/mcp-tools.test.ts`

- [ ] **Step 1: Write failing tests for read-model output**

Add cases covering:
- `job show` renders target-resolution summary and apply rounds
- `job show` still renders legacy jobs without the new fields
- MCP `get_job` returns compact target provenance
- MCP `show_findings` includes apply summary counts when present

- [ ] **Step 2: Run the read-model suites and verify RED**

Run: `pnpm vitest run apps/cli/src/__tests__/job-command.test.ts apps/cli/src/__tests__/mcp-tools.test.ts`
Expected: FAIL because the read surfaces only expose `scope.primaryTargets` and basic round counts.

- [ ] **Step 3: Implement the read-side formatting and compatibility guards**

- [ ] **Step 4: Re-run the read-model suites and verify GREEN**

Run: `pnpm vitest run apps/cli/src/__tests__/job-command.test.ts apps/cli/src/__tests__/mcp-tools.test.ts`
Expected: PASS

### Task 8: Run focused regression verification

**Files:**
- Modify only if verification exposes a real defect in one of the files above

- [ ] **Step 1: Run the focused full suite for this slice**

Run: `pnpm vitest run apps/cli/src/__tests__/target-resolution.test.ts apps/cli/src/__tests__/run-targeting.test.ts apps/cli/src/__tests__/provider-resolution.test.ts apps/cli/src/__tests__/superpower-skill-wiring.test.ts apps/cli/src/__tests__/auto-apply-reporting.test.ts apps/cli/src/__tests__/job-command.test.ts apps/cli/src/__tests__/mcp-tools.test.ts packages/core/src/protocols/__tests__/single-challenger.test.ts packages/core/src/storage/__tests__/job-store.test.ts packages/core/src/storage/__tests__/round-store.test.ts packages/core/src/orchestrator/__tests__/orchestrator.test.ts`
Expected: PASS

- [ ] **Step 2: Run typecheck for touched packages**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Run one manual smoke check through the CLI**

Run: `pnpm exec tsx apps/cli/src/index.ts run --target docs/superpowers/specs/2026-03-22-review-pipeline-correctness-design.md --superpower plan-review --path /Users/malayvuong/Sites/2026/agent-orchestra`
Expected: job creation succeeds, target loading uses the shared resolver, and final reporting uses truthful apply/job semantics.

## Notes

- Keep all changes additive and local to the seams above; do not refactor unrelated command registration or protocol infrastructure.
- Respect the dirty worktree. Do not revert unrelated user changes.
- TODOs intentionally deferred by the spec remain deferred: plain-text path extraction, external link traversal, create/delete/rename apply operations, diff-based apply, baseline comparison, final-vs-original scoring.
