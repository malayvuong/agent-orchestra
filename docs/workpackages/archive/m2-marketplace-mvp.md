# M2 — Marketplace MVP: Registry Repo + CLI Management

> **Start date:** After M1 completes (~2026-04-28). **Duration:** ~4 weeks (27 days).
> **Owner:** Backend/CLI Dev (1.0 FTE) + Technical Writer (0.25 FTE)
> **Prerequisite:** M1 complete

---

## Objective

Create a public registry repo for community skills, a CLI for installing/managing skills from the registry, and a lockfile system for reproducible skill versions. No executable skills yet — registry only handles prompt-type skills and metadata for future tool/plugin types.

## Dependencies

| Dependency | Source | Required By |
|-----------|--------|-------------|
| M1 skill types and loader | `packages/core/skills/` | All tasks |
| M0 security RFC (draft) | `docs/rfcs/rfc-001-skill-security.md` | Task 2.4 (trust tiers) |
| Agent Skills standard | External reference | Task 2.1 |

## Deliverables

1. **Registry repo** (separate repository): `agent-orchestra-registry/`
2. `packages/registry/` — Registry client library
3. Updated CLI — `skills search/install/pin/remove/update` commands
4. Lockfile system (`skills.lock`)
5. CI validation pipeline for registry PRs
6. Contributor documentation

---

## Tasks

### Task 2.1 — Registry Repo Structure

**Goal:** Create the separate registry repository with directory structure, validation schemas, and contribution guidelines.

**Subtasks:**

- 2.1.1 — **Create repository `agent-orchestra-registry`** with structure:
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
    plugins/                          # empty in M2, reserved for M3+
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

- 2.1.2 — **`registry.json` format** (auto-generated, NOT hand-edited):
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

- 2.1.3 — **Trust tiers** (from M0 security RFC):

  | Tier | Meaning | Review Required | Allowed Types |
  |------|---------|----------------|--------------|
  | `official` | Maintained by core team | Core team review | prompt, tool, plugin |
  | `verified` | Community, reviewed by maintainer | Maintainer review + CI pass | prompt, tool |
  | `community` | Community, CI-validated only | CI pass only | prompt only (M2) |
  | `experimental` | Unreviewed | None (flagged as experimental) | prompt only |

- 2.1.4 — **Seed registry with 3-5 starter skills:**
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

### Task 2.2 — Registry Client Library

**Goal:** Implement the client that fetches, caches, and resolves skills from the registry.

**Subtasks:**

- 2.2.1 — **Create `packages/registry/client.ts`:**
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

- 2.2.2 — **Skill package download mechanism:**
  ```
  1. Fetch registry.json (cached, ETag-based)
  2. Find skill entry by ID + version
  3. Download skill directory as tarball from registry repo:
     URL pattern: {registryUrl}/skills/{skillId}/archive/{version}.tar.gz
     OR: git clone + sparse checkout of skill directory (simpler for MVP)
  4. Verify SHA-256 checksum against registry.json entry
  5. Extract to local cache: ~/.agent-orchestra/cache/skills/{skillId}/{version}/
  ```

- 2.2.3 — **For MVP, use git-based download** (avoid needing a package server):
  ```ts
  async download(skillId: string, version?: string): Promise<SkillPackage> {
    // 1. Sparse clone of registry repo, only the skill directory
    // 2. Checkout the tag matching the version
    // 3. Copy to cache directory
    // 4. Verify checksum
    // 5. Return SkillPackage with local path
  }
  ```
  This can be upgraded to a proper package server in future.

- 2.2.4 — **Local cache management:**
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

### Task 2.3 — Lockfile System

**Goal:** Implement a lockfile (`skills.lock`) for reproducible skill installations.

**Subtasks:**

- 2.3.1 — **Lockfile format** (`skills.lock` in workspace root):
  ```yaml
  # AUTO-GENERATED — do not edit manually
  # Run 'agent-orchestra skills install' to regenerate
  lockfileVersion: 1
  generatedAt: "2026-05-01T10:30:00Z"

  skills:
    security-review:
      version: "1.0.0"
      source: "registry"
      registryUrl: "https://registry.agent-orchestra.dev"
      checksum:
        algorithm: "sha256"
        digest: "a1b2c3d4e5f6..."
      installedAt: "2026-05-01T10:30:00Z"

    custom-skill:
      version: "0.1.0"
      source: "local"
      path: ".agent-orchestra/skills/custom-skill"
      checksum:
        algorithm: "sha256"
        digest: "f6e5d4c3b2a1..."
      installedAt: "2026-05-01T10:30:00Z"
  ```

- 2.3.2 — **Implement `packages/registry/lockfile.ts`:**
  ```ts
  export class LockfileManager {
    constructor(private workspacePath: string) {}

    /**
     * Read existing lockfile. Returns null if not found.
     */
    read(): Lockfile | null

    /**
     * Write lockfile to workspace root.
     */
    write(lockfile: Lockfile): void

    /**
     * Add or update a skill entry in the lockfile.
     */
    upsert(skillId: string, entry: LockfileEntry): void

    /**
     * Remove a skill entry from the lockfile.
     */
    remove(skillId: string): void

    /**
     * Verify all installed skills match their lockfile checksums.
     * Returns list of mismatches.
     */
    verify(): LockfileVerifyResult

    /**
     * Resolve skill versions: if lockfile exists, use locked versions.
     * Otherwise, resolve latest compatible versions from registry.
     */
    resolve(
      requested: { skillId: string; versionRange?: string }[],
      registry: RegistryClient
    ): Promise<ResolvedSkill[]>
  }
  ```

- 2.3.3 — **Version resolution strategy:**
  ```
  1. If skills.lock exists AND skill is locked → use locked version exactly
  2. If skills.lock exists BUT skill is NOT locked → resolve latest from registry
  3. If no skills.lock → resolve all from registry, create lockfile
  4. Version range: semver range matching (e.g., "^1.0.0" = ">=1.0.0 <2.0.0")
  5. On `skills update` → re-resolve and update lockfile
  ```

- 2.3.4 — **Checksum verification on load:**
  - At job start, verify installed skill checksums against lockfile
  - If mismatch: log error, refuse to load that skill, continue with others
  - If `--strict` flag: abort job on any checksum mismatch

**Acceptance criteria:**
- [ ] Lockfile created on first `skills install`
- [ ] Subsequent installs use locked versions
- [ ] `skills update` re-resolves and updates lockfile
- [ ] Checksum verification catches tampered skills
- [ ] Version range resolution follows semver rules

**Files created:**
- `packages/registry/lockfile.ts`
- `packages/registry/lockfile.test.ts`

---

### Task 2.4 — CLI Install/Management Commands

**Goal:** Implement CLI commands for installing, pinning, removing, and updating skills.

**Subtasks:**

- 2.4.1 — **`skills install <id>[@version]`:**
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

- 2.4.2 — **`skills remove <id>`:**
  ```
  $ agent-orchestra skills remove security-review
  Removed security-review from .agent-orchestra/skills/
  Updated skills.lock
  ```

  Implementation:
  ```
  1. Check if skill is referenced in any skillset → warn if yes
  2. Remove skill directory
  3. Remove from skills.lock
  ```

- 2.4.3 — **`skills update [id]`:**
  ```
  $ agent-orchestra skills update
  Checking for updates...
  security-review: 1.0.0 → 1.1.0 (update available)
  test-conventions: 1.0.0 (up to date)

  $ agent-orchestra skills update security-review
  Updating security-review to 1.1.0... done
  Updated skills.lock
  ```

- 2.4.4 — **`skills search <query>`:**
  ```
  $ agent-orchestra skills search security

  Registry results:
    security-review     v1.1.0  [official]  OWASP-based security review
    secrets-detector    v0.5.0  [verified]  Detect hardcoded secrets
    dep-audit           v1.0.0  [community] Dependency vulnerability audit

  Filters: --type prompt|tool|plugin, --tier official|verified|community
  ```

- 2.4.5 — **`skills verify`:**
  ```
  $ agent-orchestra skills verify
  Verifying installed skills against skills.lock...
  security-review@1.0.0: ok
  test-conventions@1.0.0: ok
  custom-skill@0.1.0: CHECKSUM MISMATCH (expected: abc123, got: def456)

  1 error found. Run 'skills install' to fix.
  ```

- 2.4.6 — **`skills pin <id> <version>`:**
  ```
  $ agent-orchestra skills pin security-review 1.0.0
  Pinned security-review to 1.0.0 (will not update)
  Updated skills.lock
  ```

**Acceptance criteria:**
- [ ] All 6 commands work end-to-end
- [ ] `install` downloads, verifies, extracts, and updates lockfile
- [ ] `remove` cleans up files and lockfile
- [ ] `update` shows available updates and applies them
- [ ] `search` queries registry with filters
- [ ] `verify` checks checksum integrity
- [ ] `pin` prevents version changes on update

**Files modified:**
- `apps/cli/` (add commands)

---

### Task 2.5 — Registry CI Pipeline

**Goal:** Automated validation for PRs adding skills to the registry repo.

**Subtasks:**

- 2.5.1 — **`.github/workflows/validate-pr.yml`:**
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

- 2.5.2 — **`scripts/validate.ts`** checks:
  - SKILL.md exists in skill directory
  - Frontmatter parses as valid YAML
  - Required fields present: `name`, `description`
  - `license` field present (required for registry, even if optional in standard)
  - `compatibility.agentOrchestra` field present
  - Triggers reference valid lens/role values
  - Directory name matches skill ID convention (`[a-z0-9-]+`)
  - No executable files in skill directory (M2 only allows prompt skills in `skills/`)

- 2.5.3 — **`scripts/secret-scan.ts`** checks:
  - No API keys, tokens, passwords in skill content
  - Pattern matching: `sk-...`, `ghp_...`, `AKIA...`, common secret patterns
  - Scan both SKILL.md and any reference files

- 2.5.4 — **`.github/workflows/build-registry.yml`** (on merge to main):
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

- 2.5.5 — **`scripts/build-registry.ts`:**
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

### Task 2.6 — SkillLoader Update for Registry Skills

**Goal:** Update the existing `SkillLoader` (from M1) to also load registry-installed skills.

**Subtasks:**

- 2.6.1 — **Updated discovery order:**
  ```
  1. <workspace>/.agent-orchestra/skills/    (project-level installed + local)
  2. <workspace>/.agents/skills/             (Agent Skills standard path)
  3. ~/.agent-orchestra/skills/              (user-level global installs)
  ```
  Registry-installed skills go into path #1 (by `skills install`), so no change to discovery logic — only the installation path matters.

- 2.6.2 — **Checksum verification at load time:**
  ```ts
  // In SkillLoader.loadFromWorkspace():
  const lockfile = this.lockfileManager.read()
  for (const skill of loadedSkills) {
    if (lockfile?.skills[skill.id]) {
      const expected = lockfile.skills[skill.id].checksum.digest
      const actual = this.computeChecksum(skill.source.path)
      if (expected !== actual) {
        this.logger.error(`Checksum mismatch for ${skill.id}`)
        // Remove from loaded skills unless --no-verify flag
      }
    }
  }
  ```

- 2.6.3 — **Source tracking:**
  - Each loaded skill records its `SkillSource` (local vs registry)
  - CLI `skills list` shows source indicator: `[local]` vs `[registry]`

**Acceptance criteria:**
- [ ] Registry-installed skills load alongside local skills
- [ ] Checksum verification runs at load time
- [ ] Source is tracked and displayed

**Files modified:**
- `packages/core/skills/loader.ts`

---

## Exit Criteria for M2

- [ ] Registry repo created with 5 starter skills
- [ ] CI validates PRs and auto-builds registry.json
- [ ] CLI `skills install/remove/update/search/verify/pin` all work
- [ ] Lockfile system ensures reproducible installations
- [ ] Checksum verification at install and load time
- [ ] Trust tier labeling in registry entries
- [ ] CONTRIBUTING.md and SKILL-FORMAT.md documentation complete
- [ ] End-to-end test: install from registry → load in job → verify injection
