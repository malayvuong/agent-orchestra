# Phase B — Local Registry + Lockfile

> **Start date:** After Phase A completes. **Duration:** ~2 weeks.
> **Owner:** Backend/CLI Dev (1.0 FTE)
> **Prerequisite:** Phase A complete

---

## Objective

Enable reproducible skill installations from local paths and git URLs with checksum verification. No remote registry. Skills are installed from the local filesystem or cloned from git repositories, tracked in a lockfile, and verified by checksum at both install and load time.

## Dependencies

| Dependency | Source | Required By |
|-----------|--------|-------------|
| Phase A skill types and loader | `packages/core/skills/` | All tasks |
| Lockfile manager | `packages/registry/lockfile.ts` | Task B.2 |

## Deliverables

1. Lockfile system (`skills.lock`)
2. CLI commands — `skills install <local-path-or-git-url>`, `skills remove`, `skills verify`, `skills pin`
3. Updated `SkillLoader` with checksum verification at load time

---

## Tasks

### Task B.1 — Lockfile System

**Goal:** Implement a lockfile (`skills.lock`) for reproducible skill installations.

**Subtasks:**

- B.1.1 — **Lockfile format** (`skills.lock` in workspace root):
  ```yaml
  # AUTO-GENERATED — do not edit manually
  # Run 'agent-orchestra skills install' to regenerate
  lockfileVersion: 1
  generatedAt: "2026-05-01T10:30:00Z"

  skills:
    custom-skill:
      version: "0.1.0"
      source: "local"
      path: ".agent-orchestra/skills/custom-skill"
      checksum:
        algorithm: "sha256"
        digest: "f6e5d4c3b2a1..."
      installedAt: "2026-05-01T10:30:00Z"

    git-skill:
      version: "1.0.0"
      source: "git"
      url: "https://github.com/example/my-skill.git"
      ref: "v1.0.0"
      checksum:
        algorithm: "sha256"
        digest: "a1b2c3d4e5f6..."
      installedAt: "2026-05-01T10:30:00Z"
  ```

- B.1.2 — **Implement `packages/registry/lockfile.ts`:**
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
     * Resolve skill versions from lockfile.
     * If lockfile exists, use locked versions. Otherwise, record the
     * version from the local path or git ref being installed.
     */
    resolve(
      requested: { skillId: string; version?: string }[]
    ): ResolvedSkill[]
  }
  ```

- B.1.3 — **Version resolution strategy (local-only):**
  ```
  1. If skills.lock exists AND skill is locked → use locked version exactly
  2. If skills.lock exists BUT skill is NOT locked → install from provided path/URL
  3. If no skills.lock → install from provided path/URL, create lockfile
  4. Pinned skills are never modified by subsequent installs
  ```

- B.1.4 — **Checksum verification on load:**
  - At job start, verify installed skill checksums against lockfile
  - If mismatch: log error, refuse to load that skill, continue with others
  - If `--strict` flag: abort job on any checksum mismatch

**Acceptance criteria:**
- [ ] Lockfile created on first `skills install`
- [ ] Subsequent installs use locked versions when present
- [ ] Checksum verification catches tampered skills
- [ ] Lockfile entries track source type (`local` or `git`)

**Files created:**
- `packages/registry/lockfile.ts`
- `packages/registry/lockfile.test.ts`

---

### Task B.2 — CLI Install/Management Commands (Local Only)

**Goal:** Implement CLI commands for installing from local paths and git URLs, pinning, removing, and verifying skills. No remote registry commands.

**Subtasks:**

- B.2.1 — **`skills install <local-path-or-git-url>`:**
  ```
  $ agent-orchestra skills install ./path/to/my-skill
  Copying my-skill from local path... done
  Computing checksum... ok
  Installed my-skill@0.1.0 to .agent-orchestra/skills/my-skill/
  Updated skills.lock

  $ agent-orchestra skills install https://github.com/example/my-skill.git
  Cloning my-skill from git... done
  Computing checksum... ok
  Installed my-skill@1.0.0 to .agent-orchestra/skills/my-skill/
  Updated skills.lock

  $ agent-orchestra skills install https://github.com/example/my-skill.git#v0.9.0
  Cloning my-skill from git (ref: v0.9.0)... done
  Installed my-skill@0.9.0 (pinned to ref)
  ```

  Implementation:
  ```
  1. Detect source type: local path or git URL
  2. For local path: copy skill directory to .agent-orchestra/skills/{id}/
  3. For git URL: clone repo (optionally at a specific ref/tag/branch)
  4. Parse SKILL.md frontmatter for skill ID and version
  5. Compute SHA-256 checksum of installed files
  6. Update skills.lock via LockfileManager
  ```

- B.2.2 — **`skills remove <id>`:**
  ```
  $ agent-orchestra skills remove my-skill
  Removed my-skill from .agent-orchestra/skills/
  Updated skills.lock
  ```

  Implementation:
  ```
  1. Check if skill is referenced in any skillset → warn if yes
  2. Remove skill directory
  3. Remove from skills.lock
  ```

- B.2.3 — **`skills verify`:**
  ```
  $ agent-orchestra skills verify
  Verifying installed skills against skills.lock...
  my-skill@0.1.0: ok
  git-skill@1.0.0: ok
  another-skill@0.2.0: CHECKSUM MISMATCH (expected: abc123, got: def456)

  1 error found. Run 'skills install' to fix.
  ```

- B.2.4 — **`skills pin <id> <version>`:**
  ```
  $ agent-orchestra skills pin my-skill 1.0.0
  Pinned my-skill to 1.0.0 (will not be overwritten on reinstall)
  Updated skills.lock
  ```

**Acceptance criteria:**
- [ ] `install` copies from local path or clones from git, computes checksum, updates lockfile
- [ ] `install` supports git ref syntax (`url#ref`) for pinning to a tag/branch/commit
- [ ] `remove` cleans up files and lockfile entry
- [ ] `verify` checks checksum integrity of all installed skills
- [ ] `pin` prevents version changes on subsequent installs

**Files modified:**
- `apps/cli/` (add commands)

---

### Task B.3 — SkillLoader Update for Checksum Verification

**Goal:** Update the existing `SkillLoader` (from Phase A) to verify checksums of installed skills at load time.

**Subtasks:**

- B.3.1 — **Updated discovery order:**
  ```
  1. <workspace>/.agent-orchestra/skills/    (project-level installed + local)
  2. <workspace>/.agents/skills/             (Agent Skills standard path)
  3. ~/.agent-orchestra/skills/              (user-level global installs)
  ```
  Skills installed via `skills install` go into path #1, so no change to discovery logic — only the installation path and verification logic matter.

- B.3.2 — **Checksum verification at load time:**
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

- B.3.3 — **Source tracking:**
  - Each loaded skill records its `SkillSource` (`local` vs `git`)
  - CLI `skills list` shows source indicator: `[local]` vs `[git]`

**Acceptance criteria:**
- [ ] Locally installed skills load alongside workspace skills
- [ ] Checksum verification runs at load time using lockfile data
- [ ] Tampered skills are rejected (or flagged when `--no-verify` is used)
- [ ] Source type is tracked and displayed in `skills list`

**Files modified:**
- `packages/core/skills/loader.ts`

---

## Exit Criteria for Phase B

- [ ] `skills install <local-path>` copies and installs a skill from the filesystem
- [ ] `skills install <git-url>` clones and installs a skill from a git repository
- [ ] `skills remove` cleans up skill files and lockfile entries
- [ ] `skills verify` validates all installed skill checksums against the lockfile
- [ ] `skills pin` locks a skill to a specific version
- [ ] Lockfile (`skills.lock`) ensures reproducible installations
- [ ] Checksum verification at both install time and load time
- [ ] End-to-end test: install from local path → load in job → verify checksum → confirm injection
