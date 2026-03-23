# CalVer Hard-Cut Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert release/app versions and the `skills/registry` subsystem from SemVer to a hard-cut CalVer format `YYYY.M.PATCH`.

**Architecture:** Introduce a small CalVer utility in the registry layer, route all registry version ordering and validation through it, and hard-cut parser/installer/lockfile flows to reject SemVer-era skill versions. Update package/app version surfaces and docs/tests in the same slice so publish-time, runtime, and registry behavior stay aligned.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, Commander, npm publishing metadata

---

## Chunk 1: CalVer Utility And Registry Ordering

### Task 1: Add failing tests for CalVer compare/validation

**Files:**
- Create: `packages/registry/src/__tests__/calver.test.ts`
- Modify: `packages/registry/src/__tests__/client.test.ts`

- [ ] **Step 1: Write the failing test**

Add tests covering:
- valid `2026.3.1`
- invalid `2026.03.1`, `2026.3.01`, `1.2.3`
- compare ordering across year/month/patch
- registry “highest version” selection using CalVer

- [ ] **Step 2: Run test to verify it fails**

Run: `PATH=/Users/malayvuong/.nvm/versions/node/v24.11.1/bin:$PATH pnpm vitest run packages/registry/src/__tests__/calver.test.ts packages/registry/src/__tests__/client.test.ts`
Expected: FAIL because CalVer utility does not exist and registry logic still assumes SemVer.

- [ ] **Step 3: Write minimal implementation**

**Files:**
- Create: `packages/registry/src/calver.ts`
- Modify: `packages/registry/src/client.ts`

Implement:
- `isValidCalver()`
- `parseCalver()`
- `compareCalver()`

Replace inline SemVer comparison in `RegistryClient`.

- [ ] **Step 4: Run test to verify it passes**

Run: `PATH=/Users/malayvuong/.nvm/versions/node/v24.11.1/bin:$PATH pnpm vitest run packages/registry/src/__tests__/calver.test.ts packages/registry/src/__tests__/client.test.ts`
Expected: PASS

## Chunk 2: Hard-Cut Parser/Installer/Lockfile Behavior

### Task 2: Add failing tests for SemVer rejection

**Files:**
- Modify: `packages/registry/src/__tests__/installer.test.ts`
- Modify: `packages/registry/src/__tests__/integration.test.ts`
- Modify: `packages/registry/src/__tests__/lockfile.test.ts`
- Modify: `packages/core/src/skills/__tests__/parser.test.ts`

- [ ] **Step 1: Write the failing test**

Add tests proving:
- SemVer skill metadata is rejected
- zero-padded CalVer is rejected
- lockfile entries with SemVer skill versions are rejected or ignored by the supported validation path
- default version fallback is CalVer-compatible

- [ ] **Step 2: Run test to verify it fails**

Run: `PATH=/Users/malayvuong/.nvm/versions/node/v24.11.1/bin:$PATH pnpm vitest run packages/registry/src/__tests__/installer.test.ts packages/registry/src/__tests__/integration.test.ts packages/registry/src/__tests__/lockfile.test.ts packages/core/src/skills/__tests__/parser.test.ts`
Expected: FAIL because parser/installer still accept SemVer-era values or default to `0.0.0`.

- [ ] **Step 3: Write minimal implementation**

**Files:**
- Modify: `packages/registry/src/installer.ts`
- Modify: `packages/core/src/skills/parser.ts`
- Modify: `packages/registry/src/lockfile.ts`
- Modify: `packages/registry/src/types.ts` if needed only for validation flow support

Implement strict CalVer validation and replace default fallback versions with a CalVer-compatible value.

- [ ] **Step 4: Run test to verify it passes**

Run: `PATH=/Users/malayvuong/.nvm/versions/node/v24.11.1/bin:$PATH pnpm vitest run packages/registry/src/__tests__/installer.test.ts packages/registry/src/__tests__/integration.test.ts packages/registry/src/__tests__/lockfile.test.ts packages/core/src/skills/__tests__/parser.test.ts`
Expected: PASS

## Chunk 3: Release/App Version Surfaces

### Task 3: Update runtime version surfaces and package manifests

**Files:**
- Modify: `package.json`
- Modify: `apps/cli/package.json`
- Modify: `apps/server/package.json`
- Modify: `packages/shared/package.json`
- Modify: `packages/core/package.json`
- Modify: `packages/providers/package.json`
- Modify: `packages/registry/package.json`
- Modify: `apps/cli/src/program.ts`
- Modify: `apps/cli/src/mcp/server.ts`
- Modify: `apps/server/src/index.ts`

- [ ] **Step 1: Write the failing test**

Add or update tests covering CLI/server/MCP version strings where they are asserted.

- [ ] **Step 2: Run test to verify it fails**

Run: `PATH=/Users/malayvuong/.nvm/versions/node/v24.11.1/bin:$PATH pnpm vitest run apps/cli/src/__tests__/mcp-tools.test.ts apps/cli/src/__tests__/mcp-server.test.ts`
Expected: FAIL or require snapshot/text updates because runtime version is still SemVer.

- [ ] **Step 3: Write minimal implementation**

Update manifests and runtime surfaces to the current CalVer release string.

- [ ] **Step 4: Run test to verify it passes**

Run: `PATH=/Users/malayvuong/.nvm/versions/node/v24.11.1/bin:$PATH pnpm vitest run apps/cli/src/__tests__/mcp-tools.test.ts apps/cli/src/__tests__/mcp-server.test.ts`
Expected: PASS

## Chunk 4: Documentation And Full Verification

### Task 4: Update docs and run full validation

**Files:**
- Modify only the docs that currently claim `0.0.1` or SemVer as the active release/package policy for this repo:
  - `docs/PROJECT-REPORT.md`
  - `docs/skills/skill-format.md`
  - `docs/skills/getting-started.md`
  - any release-facing docs surfaced by ripgrep during implementation

- [ ] **Step 1: Update docs to match hard-cut CalVer**

Keep edits narrow to release/package/runtime policy and active skill version examples.

- [ ] **Step 2: Run targeted tests**

Run: `PATH=/Users/malayvuong/.nvm/versions/node/v24.11.1/bin:$PATH pnpm vitest run packages/registry/src/__tests__/calver.test.ts packages/registry/src/__tests__/client.test.ts packages/registry/src/__tests__/installer.test.ts packages/registry/src/__tests__/integration.test.ts packages/registry/src/__tests__/lockfile.test.ts packages/core/src/skills/__tests__/parser.test.ts apps/cli/src/__tests__/mcp-tools.test.ts apps/cli/src/__tests__/mcp-server.test.ts`
Expected: PASS

- [ ] **Step 3: Run repo verification**

Run:
- `PATH=/Users/malayvuong/.nvm/versions/node/v24.11.1/bin:$PATH pnpm lint`
- `PATH=/Users/malayvuong/.nvm/versions/node/v24.11.1/bin:$PATH pnpm typecheck`
- `PATH=/Users/malayvuong/.nvm/versions/node/v24.11.1/bin:$PATH pnpm test`

Expected: all pass
