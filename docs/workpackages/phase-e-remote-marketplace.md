# Phase E — Remote Marketplace (Gated)

> **Duration:** ~3 weeks.
> **Owner:** Backend/CLI Dev (1.0 FTE) + Technical Writer (0.25 FTE)
> **Prerequisites:** Phase D complete, gate criteria met
> **Note:** Marketplace must NOT distribute skills above the current runtime maturity level.

---

## Gate Criteria

This phase is **gated**. Work MUST NOT begin until all of the following conditions are satisfied:

| # | Criterion | Rationale |
|---|-----------|-----------|
| 1 | >10 real skills exist in the local ecosystem | Proves enough content to justify a remote registry |
| 2 | >3 external contributors have submitted skills | Demonstrates community engagement beyond the core team |
| 3 | Demonstrated community demand for a shared registry | Validates the marketplace is wanted, not speculative |
| 4 | Skill format stable for >4 weeks (no breaking changes) | Ensures registry consumers are not broken by format churn |
| 5 | Phase D is fully operational | Runtime and local management must be solid before going remote |

> **Decision authority:** The gate review is conducted by the project lead. All five criteria must be met; partial passes do not qualify.

---

## Objective

Create a public registry repo for community skills with CI validation, and CLI commands for searching/installing from the remote registry.

## Dependencies

| Dependency | Source | Required By |
|-----------|--------|-------------|
| Phase D skill types and loader | `packages/core/skills/` | All tasks |
| Security RFC (draft) | `docs/rfcs/rfc-001-skill-security.md` | Task E.1 (trust tiers) |
| Agent Skills standard | External reference | Task E.1 |

## Deliverables

1. **Registry repo** (separate repository): `agent-orchestra-registry/`
2. `packages/registry/` — Registry client library
3. Updated CLI — `skills search` and `skills install <id>` from remote registry, `skills update` (remote version check)
4. CI validation pipeline for registry PRs
5. Contributor documentation

---

## Tasks

### Task E.1 — Registry Repo Structure

**Goal:** Create the separate registry repository with directory structure, validation schemas, and contribution guidelines.

**Subtasks:**

- E.1.1 — **Create repository `agent-orchestra-registry`** with structure:
  ```
  agent-orchestra-registry/
    skills/
      security-review/
        SKILL.md
        references/
        README.md
      dependency-audit/
        SKILL.md
      test-conventions/
        SKILL.md
    plugins/                          # empty, reserved for future phases
      .gitkeep
    registry.json                     # auto-generated index
    schema/
      skill-manifest.schema.json      # JSON Schema for SKILL.md frontmatter
      registry-entry.schema.json      # JSON Schema for registry.json entries
    scripts/
      validate.ts                     # validation script for CI
      build-registry.ts               # generates registry.json from skill dirs
    docs/
      CONTRIBUTING.md
      SKILL-FORMAT.md
      REVIEW-GUIDELINES.md
    .github/
      workflows/
        validate-pr.yml               # CI for PRs
        build-registry.yml            # CI for main branch
      PULL_REQUEST_TEMPLATE.md
    LICENSE                           # Apache-2.0
    SECURITY.md
    README.md
  ```

- E.1.2 — **`registry.json` format** (auto-generated, NOT hand-edited):
  ```json
  {
    "version": 1,
    "generatedAt": "2026-04-28T00:00:00Z",
    "skills": [
      {
        "id": "security-review",
        "name": "Security Review",
        "version": "1.0.0",
        "description": "OWASP-based security review checklist",
        "skillType": "prompt",
        "license": "MIT",
        "compatibility": { "agentOrchestra": ">=1.3.0" },
        "triggers": { "lenses": ["security"] },
        "checksum": { "algorithm": "sha256", "digest": "abc123..." },
        "publishedAt": "2026-04-28T00:00:00Z",
        "author": "agent-orchestra-team",
        "trustTier": "official"
      }
    ],
    "plugins": []
  }
  ```

- E.1.3 — **Trust tiers** (from security RFC):

  | Tier | Meaning | Review Required | Allowed Types |
  |------|---------|----------------|--------------|
  | `official` | Maintained by core team | Core team review | prompt, tool, plugin |
  | `verified` | Community, reviewed by maintainer | Maintainer review + CI pass | prompt, tool |
  | `community` | Community, CI-validated only | CI pass only | prompt only |
  | `experimental` | Unreviewed | None (flagged as experimental) | prompt only |

- E.1.4 — **Seed registry with 3-5 starter skills:**
  - `security-review` — OWASP checklist for code review (lens: security)
  - `test-conventions` — testing conventions and patterns (lens: testing)
  - `code-quality` — general code quality guidelines (always-on)
  - `perf-review` — performance review checklist (lens: performance)
  - `migration-guide` — framework migration patterns (keyword: migrate, migration)

**Acceptance criteria:**
- [ ] Registry repo created with complete structure
- [ ] 5 starter skills with valid SKILL.md files
- [ ] `registry.json` auto-generated from skill directories
- [ ] JSON schemas validate all manifest fields
- [ ] CONTRIBUTING.md with clear PR guidelines

**Files created:** Entire `agent-orchestra-registry/` repo

---

### Task E.2 — Registry Client Library

**Goal:** Implement the client that fetches, caches, and resolves skills from the remote registry.

**Subtasks:**

- E.2.1 — **Create `packages/registry/client.ts`:**
  ```ts
  export type RegistryConfig = {
    /** URL to registry.json (default: official registry URL) */
    registryUrl: string
    /** Local cache directory (default: ~/.agent-orchestra/cache/registry/) */
    cacheDir: string
    /** Cache TTL in seconds (default: 3600 = 1 hour) */
    cacheTtlSeconds: number
  }

  export class RegistryClient {
    constructor(private config: RegistryConfig) {}

    /**
     * Fetch the latest registry index.
     * Uses HTTP ETag/If-None-Match for efficient polling.
     */
    async fetchIndex(): Promise<RegistryIndex>

    /**
     * Search skills by query (name, description, tags).
     */
    async search(query: string, filters?: {
      skillType?: SkillType
      trustTier?: string
      lens?: AgentLens
    }): Promise<RegistryEntry[]>

    /**
     * Download a skill package to local cache.
     * Verifies checksum after download.
     */
    async download(skillId: string, version?: string): Promise<SkillPackage>

    /**
     * Get all available versions of a skill.
     */
    async versions(skillId: string): Promise<string[]>

    /**
     * Check for updates to installed skills.
     */
    async checkUpdates(installed: InstalledSkill[]): Promise<UpdateAvailable[]>
  }
  ```

- E.2.2 — **Skill package download mechanism:**
  ```
  1. Fetch registry.json (cached, ETag-based)
  2. Find skill entry by ID + version
  3. Download skill directory as tarball from registry repo:
     URL pattern: {registryUrl}/skills/{skillId}/archive/{version}.tar.gz
     OR: git clone + sparse checkout of skill directory (simpler for MVP)
  4. Verify SHA-256 checksum against registry.json entry
  5. Extract to local cache: ~/.agent-orchestra/cache/skills/{skillId}/{version}/
  ```

- E.2.3 — **For MVP, use git-based download** (avoid needing a package server):
  ```ts
  async download(skillId: string, version?: string): Promise<SkillPackage> {
    // 1. Sparse clone of registry repo, only the skill directory
    // 2. Checkout the tag matching the version
    // 3. Copy to cache directory
    // 4. Verify checksum
    // 5. Return SkillPackage with local path
  }
  ```
  This can be upgraded to a proper package server in future phases.

- E.2.4 — **Local cache management:**
  - Cache directory: `~/.agent-orchestra/cache/`
  - Structure: `cache/registry/registry.json`, `cache/skills/{id}/{version}/`
  - `cache clean` — remove all cached downloads
  - `cache info` — show cache size and contents

**Acceptance criteria:**
- [ ] Fetches registry.json with ETag caching
- [ ] Downloads skills via git sparse checkout
- [ ] Verifies SHA-256 checksum after download
- [ ] Search works by name, description, lens filter
- [ ] Update check compares installed versions vs registry

**Files created:**
- `packages/registry/client.ts`
- `packages/registry/client.test.ts`
- `packages/registry/types.ts`
- `packages/registry/index.ts`

---

### Task E.3 — CLI Remote Commands

**Goal:** Implement CLI commands for searching, installing, and updating skills from the remote registry.

**Subtasks:**

- E.3.1 — **`skills search <query>`:**
  ```
  $ agent-orchestra skills search security

  Registry results:
    security-review     v1.1.0  [official]  OWASP-based security review
    secrets-detector    v0.5.0  [verified]  Detect hardcoded secrets
    dep-audit           v1.0.0  [community] Dependency vulnerability audit

  Filters: --type prompt|tool|plugin, --tier official|verified|community
  ```

- E.3.2 — **`skills install <id>[@version]`:**
  ```
  $ agent-orchestra skills install security-review
  Fetching registry index... done
  Downloading security-review@1.0.0... done
  Verifying checksum... ok
  Installed security-review@1.0.0 to .agent-orchestra/skills/security-review/
  Updated skills.lock

  $ agent-orchestra skills install security-review@0.9.0
  Downloading security-review@0.9.0... done
  Installed security-review@0.9.0 (pinned)
  ```

  Implementation:
  ```
  1. Parse skill ID and optional version
  2. Fetch registry index via RegistryClient
  3. Resolve version (exact or latest compatible)
  4. Download skill package
  5. Verify checksum
  6. Extract to .agent-orchestra/skills/{id}/
  7. Update skills.lock via LockfileManager
  ```

- E.3.3 — **`skills update [id]`** (remote version check):
  ```
  $ agent-orchestra skills update
  Checking for updates...
  security-review: 1.0.0 -> 1.1.0 (update available)
  test-conventions: 1.0.0 (up to date)

  $ agent-orchestra skills update security-review
  Updating security-review to 1.1.0... done
  Updated skills.lock
  ```

**Acceptance criteria:**
- [ ] `search` queries registry with filters (type, tier)
- [ ] `install` downloads, verifies checksum, extracts, and updates lockfile
- [ ] `update` checks remote registry for newer versions and applies them
- [ ] All commands provide clear terminal output with progress indicators

**Files modified:**
- `apps/cli/` (add/update commands)

---

### Task E.4 — Registry CI Pipeline

**Goal:** Automated validation for PRs adding skills to the registry repo.

**Subtasks:**

- E.4.1 — **`.github/workflows/validate-pr.yml`:**
  ```yaml
  name: Validate Skill PR
  on:
    pull_request:
      paths: ['skills/**', 'plugins/**']

  jobs:
    validate:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with: { node-version: '20' }
        - run: npm ci
        - name: Validate changed skills
          run: npx tsx scripts/validate.ts --changed
        - name: Check for hardcoded secrets
          run: npx tsx scripts/secret-scan.ts --changed
        - name: Verify SKILL.md frontmatter
          run: npx tsx scripts/lint-frontmatter.ts --changed
  ```

- E.4.2 — **`scripts/validate.ts`** checks:
  - SKILL.md exists in skill directory
  - Frontmatter parses as valid YAML
  - Required fields present: `name`, `description`
  - `license` field present (required for registry, even if optional in standard)
  - `compatibility.agentOrchestra` field present
  - Triggers reference valid lens/role values
  - Directory name matches skill ID convention (`[a-z0-9-]+`)
  - No executable files in skill directory (only prompt skills allowed in `skills/`)

- E.4.3 — **`scripts/secret-scan.ts`** checks:
  - No API keys, tokens, passwords in skill content
  - Pattern matching: `sk-...`, `ghp_...`, `AKIA...`, common secret patterns
  - Scan both SKILL.md and any reference files

- E.4.4 — **`.github/workflows/build-registry.yml`** (on merge to main):
  ```yaml
  name: Build Registry Index
  on:
    push:
      branches: [main]
      paths: ['skills/**', 'plugins/**']

  jobs:
    build:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - run: npx tsx scripts/build-registry.ts
        - name: Commit registry.json
          run: |
            git add registry.json
            git commit -m "chore: rebuild registry index" || true
            git push
  ```

- E.4.5 — **`scripts/build-registry.ts`:**
  - Scan all `skills/*/SKILL.md` files
  - Parse frontmatter + compute SHA-256 checksums
  - Generate `registry.json` with all entries
  - Validate no duplicate IDs

**Acceptance criteria:**
- [ ] PR validation catches: missing fields, invalid YAML, secrets, bad IDs
- [ ] Registry index auto-rebuilds on merge to main
- [ ] Checksums are computed deterministically
- [ ] CI runs in <60 seconds

**Files created:** (in registry repo)
- `.github/workflows/validate-pr.yml`
- `.github/workflows/build-registry.yml`
- `scripts/validate.ts`
- `scripts/secret-scan.ts`
- `scripts/lint-frontmatter.ts`
- `scripts/build-registry.ts`

---

## Exit Criteria for Phase E

- [ ] Gate criteria verified and documented before work began
- [ ] Registry repo created with 5 starter skills
- [ ] CI validates PRs and auto-builds registry.json
- [ ] CLI `skills search` queries the remote registry with filters
- [ ] CLI `skills install <id>` downloads, verifies, and installs from remote registry
- [ ] CLI `skills update` checks remote registry for newer versions
- [ ] Trust tier labeling in registry entries
- [ ] CONTRIBUTING.md and SKILL-FORMAT.md documentation complete
- [ ] End-to-end test: search registry -> install from registry -> load in job -> verify injection
- [ ] No skills above the current runtime maturity level are distributed
