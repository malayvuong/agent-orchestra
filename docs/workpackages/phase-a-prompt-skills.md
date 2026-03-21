# Phase A — Prompt Skills Core (Survival Mode)

> **Formerly:** M1 — Prompt Skills Foundation
> **Start date:** After Phase 0 (Bootstrap) completes. **Duration:** ~4 weeks.
> **Owner:** Backend/CLI Dev (1.0 FTE)
> **Maturity level:** L0 (Prompt-only)
> **Exit criteria:** 5 real skills working, 1 demo repo, `SkillDefinition` schema frozen

### Seed Skills (Phase A Deliverables)

These 5 skills must be created and working by Phase A exit. They serve as both validation of the skill system AND useful starting content.

| # | Skill ID | Type | Trigger | Description | Token Budget |
|---|----------|------|---------|-------------|-------------|
| 1 | `security-review` | prompt | lens: `security` | OWASP Top 10 checklist contextualized for code review. Covers: injection, broken auth, XSS, insecure deserialization, SSRF, dependency vulnerabilities. | ~600 tokens |
| 2 | `test-conventions` | prompt | lens: `testing` | Testing patterns and conventions: naming, AAA structure, boundary testing, mock vs real, coverage expectations. | ~500 tokens |
| 3 | `code-quality` | prompt | always-on (no triggers) | General code quality guidelines: naming, function length, error handling, logging, DRY. Injected for every agent. | ~400 tokens |
| 4 | `perf-review` | prompt | lens: `performance` | Performance review checklist: N+1 queries, unnecessary allocations, cache opportunities, async patterns, bundle size. | ~500 tokens |
| 5 | `migration-guide` | prompt | keyword: `migrate`, `migration`, `upgrade` | Framework migration patterns: dependency audit, breaking change detection, incremental migration strategy, rollback plan. | ~550 tokens |

**Total budget for all 5:** ~2,550 tokens (fits within 20% of a 16k context budget = 3,200 tokens).

Each skill will be created as a directory in `.agent-orchestra/skills/` with a valid `SKILL.md` following Agent Skills standard format.

---

## Objective

Ship the foundational skill system as fast as possible: load prompt-only skills from the local workspace, match them to agents by lens/role/keyword triggers, inject them into `AgentContext` via `ContextBuilder`, and respect the `ContextBudgetManager` allocation. No executable skills, no network calls, no sandbox, no marketplace.

**Security deliverables (embedded, not separate RFC):**
- Freeze `SkillDefinition` TypeScript schema
- Freeze skill type taxonomy: `prompt | tool | plugin`
- Freeze capability enum: `fs.read | fs.write | proc.spawn | net.http | secrets.read`
- Document non-overridable SSRF rules as code constants
- Content sanitization warnings for potential prompt injection in SKILL.md

## Dependencies

| Dependency | Source | Required By |
|-----------|--------|-------------|
| Spec v1.3 core types | `packages/core/` | Task 1.1 |
| `ContextBuilder` implementation | `packages/core/context/` | Task 1.5 |
| `ContextBudgetManager` implementation | `packages/core/context/` | Task 1.6 |
| `AgentLens` / `AgentRole` types | `packages/core/types.ts` (§4.3, §4.4) | Task 1.3 |
| Agent Skills standard spec | External reference | Task 1.2 |

## Deliverables

1. `packages/core/skills/` — Skill loading, parsing, matching, injection
2. Updated `ContextBuilder` — Skill-aware context assembly
3. Updated `ContextBudgetManager` — Skill budget allocation
4. CLI support for listing loaded skills
5. Test fixtures and unit tests
6. Documentation in `docs/skills/`

---

## Tasks

### Task 1.1 — Core Skill Types

**Goal:** Define the TypeScript types for the skill system in `packages/core/`.

**Subtasks:**

- 1.1.1 — **Create `packages/core/skills/types.ts`** with all skill-related types:
  ```ts
  // SkillType — only 'prompt' is implemented in M1
  export type SkillType = 'prompt' | 'tool' | 'plugin'

  // SkillSource — only 'local' is implemented in M1
  export type SkillSource =
    | { type: 'local'; path: string }
    | { type: 'registry'; registryUrl: string; name: string }  // M2
    | { type: 'git'; repoUrl: string; ref: string; path: string }  // M2

  export type SkillTrigger = {
    keywords?: string[]
    lenses?: AgentLens[]
    roles?: AgentRole[]
    lifecycle?: ('pre_round' | 'post_round' | 'pre_synthesis' | 'post_synthesis')[]
  }

  export type SkillDefinition = {
    id: string
    version: string
    name: string
    description: string
    skillType: SkillType
    source: SkillSource
    license?: string
    compatibility?: {
      agentOrchestra?: string
      platforms?: string[]
    }
    triggers?: SkillTrigger
    // M1: only prompt entrypoint
    promptContent: string             // parsed from SKILL.md body
    promptSummary: string             // first 500 tokens for progressive disclosure
  }

  export type SkillSet = {
    id: string
    name: string
    description: string
    skillIds: string[]
    contextBudgetPercent: number      // 0-100, default: 20
  }

  export type SkillLoadResult = {
    skills: SkillDefinition[]
    errors: { path: string; error: string }[]
  }

  export type SkillMatchResult = {
    matched: SkillDefinition[]
    reason: Map<string, string>       // skillId → "lens:security" | "keyword:owasp" | etc.
  }
  ```

- 1.1.2 — **Create `packages/core/skills/index.ts`** — barrel export for all skill modules.

- 1.1.3 — **Add skill-related fields to existing types (non-breaking):**
  - `AgentContext` (spec §6): add optional `skillContext?: string` field
  - `AgentAssignment` (spec §4.9): add optional `skillSetId?: string` field
  - `JobRuntimeConfig` (spec §4.16): add optional `skillBudgetPercent?: number` field (default: 20)

**Acceptance criteria:**
- [ ] All types compile with `tsc --strict`
- [ ] No changes to existing required fields (backward compatible)
- [ ] Types exported from `packages/core/` barrel

**Files created:**
- `packages/core/skills/types.ts`
- `packages/core/skills/index.ts`

**Files modified:**
- `packages/core/types.ts` (add optional fields)

---

### Task 1.2 — SKILL.md Parser

**Goal:** Parse `SKILL.md` files (Agent Skills standard format) into `SkillDefinition` objects.

**Subtasks:**

- 1.2.1 — **Implement `packages/core/skills/parser.ts`:**
  ```ts
  export class SkillParser {
    /**
     * Parse a SKILL.md file into a SkillDefinition.
     * Expected format:
     *   ---
     *   name: skill-name
     *   description: one-line description
     *   version: 1.0.0
     *   license: MIT
     *   compatibility:
     *     agentOrchestra: ">=1.3.0"
     *   triggers:
     *     lenses: [security, testing]
     *     keywords: [owasp, vulnerability]
     *   allowed-tools: [fs.read]
     *   ---
     *
     *   Markdown body (prompt content)
     */
    parse(filePath: string, rawContent: string): SkillDefinition | SkillParseError

    /**
     * Parse YAML frontmatter from SKILL.md
     */
    parseFrontmatter(raw: string): SkillFrontmatter | SkillParseError

    /**
     * Extract markdown body (everything after second ---)
     */
    parseBody(raw: string): string

    /**
     * Generate summary (first ~500 tokens) for progressive disclosure
     */
    generateSummary(body: string, maxTokens: number): string
  }
  ```

- 1.2.2 — **Frontmatter schema validation:**
  - Required fields: `name`, `description`
  - Optional fields: `version`, `license`, `compatibility`, `triggers`, `allowed-tools`
  - Unknown fields: warn but do not reject (forward compatibility)
  - Validate `triggers.lenses` values against `AgentLens` union type
  - Validate `triggers.roles` values against `AgentRole` union type

- 1.2.3 — **Content sanitization (security — from M0 threat model):**
  - Strip any HTML tags from markdown body
  - Detect and warn on potential prompt injection patterns:
    - `IGNORE PREVIOUS INSTRUCTIONS`
    - `You are now...`
    - `System prompt:`
    - `<system>`, `</system>` tags
  - Do NOT block the skill (log warning only in M1; M3 adds enforcement)

- 1.2.4 — **Token estimation for summary generation:**
  - Use the same `TokenEstimator` interface from spec §20.5
  - Import from `packages/core/context/token-estimator.ts`
  - Summary = first N tokens of body, cut at paragraph boundary

**Acceptance criteria:**
- [ ] Parses valid SKILL.md files matching Agent Skills standard
- [ ] Returns structured error for malformed files (not throw)
- [ ] Handles: missing frontmatter, empty body, unknown fields, invalid YAML
- [ ] Logs warning on potential prompt injection patterns
- [ ] Summary generation respects token budget

**Files created:**
- `packages/core/skills/parser.ts`
- `packages/core/skills/parser.test.ts`

**Test fixtures needed:**
```
tests/fixtures/skills/
  valid-minimal.skill.md          # name + description only
  valid-full.skill.md             # all fields populated
  valid-no-triggers.skill.md      # no triggers (always-on skill)
  invalid-no-frontmatter.skill.md # missing --- delimiters
  invalid-bad-yaml.skill.md       # malformed YAML
  invalid-unknown-lens.skill.md   # triggers.lenses contains invalid value
  suspicious-injection.skill.md   # body contains injection patterns
  large-body.skill.md             # body > 2000 tokens (test summary truncation)
```

---

### Task 1.3 — Skill Loader (Local Workspace)

**Goal:** Discover and load skills from the local workspace directory.

**Subtasks:**

- 1.3.1 — **Implement `packages/core/skills/loader.ts`:**
  ```ts
  export class SkillLoader {
    constructor(
      private parser: SkillParser,
      private logger: Logger
    ) {}

    /**
     * Load all skills from a workspace directory.
     * Scans: .agent-orchestra/skills/ and .agents/skills/
     * Each subdirectory with a SKILL.md is treated as a skill.
     *
     * Directory structure:
     *   .agent-orchestra/skills/
     *     security-review/
     *       SKILL.md
     *       references/     (ignored in M1)
     *       scripts/        (ignored in M1)
     *     test-generator/
     *       SKILL.md
     */
    loadFromWorkspace(workspacePath: string): SkillLoadResult

    /**
     * Load a single skill from a directory path.
     */
    loadFromDirectory(dirPath: string): SkillDefinition | SkillParseError

    /**
     * Discover skill directories within a base path.
     * Returns paths to directories containing SKILL.md.
     */
    discoverSkillDirs(basePath: string): string[]
  }
  ```

- 1.3.2 — **Workspace discovery order:**
  ```
  1. <workspace>/.agent-orchestra/skills/    (project-level, primary)
  2. <workspace>/.agents/skills/             (Agent Skills standard path)
  3. ~/.agent-orchestra/skills/              (user-level, global)
  ```
  - If same skill ID found in multiple locations, project-level wins over user-level
  - Log warning on duplicates

- 1.3.3 — **Skill ID generation:**
  - Default: directory name (e.g., `security-review/` → id: `security-review`)
  - Override: if frontmatter has `id` field, use that
  - Validate: must be `[a-z0-9-]+` (lowercase, alphanumeric, hyphens only)
  - Reject duplicates within same load operation

- 1.3.4 — **Error handling:**
  - Individual skill parse failure: log error, skip skill, continue loading others
  - Entire skills directory missing: not an error (skills are optional)
  - Permission denied on directory: log warning, skip
  - Return `SkillLoadResult` with both successful skills and errors

- 1.3.5 — **Caching:**
  - Cache parsed `SkillDefinition` objects in memory (Map<skillId, SkillDefinition>)
  - Invalidate cache on: explicit reload request, job creation (always reload at job start)
  - Do NOT watch filesystem in M1 (future enhancement)

**Acceptance criteria:**
- [ ] Discovers skills from all 3 paths in correct priority order
- [ ] Handles missing directories, permission errors, parse failures gracefully
- [ ] Returns complete `SkillLoadResult` with both successes and errors
- [ ] Caches parsed skills in memory
- [ ] Duplicate skill IDs resolved by priority (project > user)

**Files created:**
- `packages/core/skills/loader.ts`
- `packages/core/skills/loader.test.ts`

**Test fixtures needed:**
```
tests/fixtures/workspace/
  .agent-orchestra/skills/
    security-review/SKILL.md
    perf-inspector/SKILL.md
  .agents/skills/
    test-generator/SKILL.md
    security-review/SKILL.md     # duplicate — should be overridden
  empty-workspace/                # no skills dirs
  broken-workspace/
    .agent-orchestra/skills/
      bad-skill/SKILL.md          # invalid YAML
      good-skill/SKILL.md         # valid
```

---

### Task 1.4 — Skill Matcher

**Goal:** Match loaded skills to specific agents based on lens, role, keyword, and lifecycle triggers.

**Subtasks:**

- 1.4.1 — **Implement `packages/core/skills/matcher.ts`:**
  ```ts
  export class SkillMatcher {
    /**
     * Given a set of loaded skills and an agent assignment,
     * return the skills that match this agent's lens/role.
     *
     * Matching rules (OR logic — any trigger match activates the skill):
     * 1. If skill has triggers.lenses AND agent.lens is in the list → match
     * 2. If skill has triggers.roles AND agent.role is in the list → match
     * 3. If skill has triggers.keywords AND any keyword appears in job brief/targets → match
     * 4. If skill has triggers.lifecycle AND current lifecycle point matches → match
     * 5. If skill has NO triggers at all → always-on (matches every agent)
     */
    match(
      skills: SkillDefinition[],
      agent: AgentAssignment,
      context: { jobBrief: string; lifecyclePoint?: string }
    ): SkillMatchResult

    /**
     * Check if a specific keyword appears in the job context.
     * Case-insensitive, word-boundary matching.
     */
    matchKeyword(keyword: string, text: string): boolean
  }
  ```

- 1.4.2 — **Match priority (when multiple skills match):**
  ```
  1. Skills with explicit lens match → highest priority
  2. Skills with explicit role match → high priority
  3. Skills with keyword match → medium priority
  4. Always-on skills (no triggers) → lowest priority
  ```
  - Within same priority: alphabetical by skill ID (deterministic)

- 1.4.3 — **Always-on vs triggered skills:**
  - Always-on: `triggers` field is undefined or empty object
  - These are always injected into context (budget permitting)
  - Triggered: `triggers` has at least one non-empty array
  - These are only injected when trigger condition is met

- 1.4.4 — **Keyword matching implementation:**
  - Case-insensitive comparison
  - Word-boundary matching (not substring): `"sql"` matches `"SQL injection"` but not `"dismissal"`
  - Match against: `job.brief`, `job.scope.primaryTargets` (joined as text)

**Acceptance criteria:**
- [ ] Lens matching works for all 12 AgentLens values
- [ ] Role matching works for all 3 AgentRole values
- [ ] Keyword matching is case-insensitive with word boundaries
- [ ] Always-on skills always match
- [ ] Match reasons are recorded in SkillMatchResult.reason map
- [ ] Deterministic ordering (same input → same output)

**Files created:**
- `packages/core/skills/matcher.ts`
- `packages/core/skills/matcher.test.ts`

---

### Task 1.5 — ContextBuilder Integration

**Goal:** Modify `ContextBuilder` to inject matched skill content into `AgentContext`, implementing progressive disclosure.

**Subtasks:**

- 1.5.1 — **Extend `ContextBuilder.buildFor()` signature:**
  ```ts
  // Before (spec §35.3):
  class ContextBuilder {
    buildFor(agent: AgentAssignment, job: Job): AgentContext
  }

  // After:
  class ContextBuilder {
    constructor(
      private budgetManager: ContextBudgetManager,
      private skillLoader: SkillLoader,    // NEW
      private skillMatcher: SkillMatcher   // NEW
    ) {}

    buildFor(agent: AgentAssignment, job: Job): AgentContext {
      // 1. Assemble raw context (existing logic)
      const raw = this.assembleRawContext(agent, job)

      // 2. Load and match skills (NEW)
      const skills = this.skillLoader.getCache()  // or reload if cache empty
      const matched = this.skillMatcher.match(skills, agent, {
        jobBrief: job.brief,
        lifecyclePoint: undefined  // set by caller for lifecycle hooks
      })

      // 3. Inject skill content into context (NEW)
      const withSkills = this.injectSkillContent(raw, matched, agent)

      // 4. Apply budget (existing, now includes skill content)
      const tokenLimit = this.getTokenLimit(agent.providerKey)
      return this.budgetManager.fitToLimit(withSkills, tokenLimit)
    }
  }
  ```

- 1.5.2 — **Skill content injection logic:**
  ```ts
  private injectSkillContent(
    context: AgentContext,
    matched: SkillMatchResult,
    agent: AgentAssignment
  ): AgentContext {
    // Calculate available skill budget
    const skillBudgetPercent = agent.skillSetId
      ? this.getSkillSetBudget(agent.skillSetId)
      : 20  // default 20%

    const totalTokenBudget = this.getTokenLimit(agent.providerKey)
    const skillTokenBudget = Math.floor(totalTokenBudget * skillBudgetPercent / 100)

    // Inject skills in priority order, respecting budget
    let usedTokens = 0
    const injectedSkills: string[] = []

    for (const skill of matched.matched) {
      const content = this.selectSkillContent(skill, skillTokenBudget - usedTokens)
      if (content === null) break  // budget exhausted

      injectedSkills.push(content)
      usedTokens += this.tokenEstimator.estimate(content)
    }

    // Add to context.pinnedContext (or new skillContext field)
    return {
      ...context,
      skillContext: injectedSkills.join('\n\n---\n\n')
    }
  }
  ```

- 1.5.3 — **Progressive disclosure implementation:**
  ```ts
  private selectSkillContent(
    skill: SkillDefinition,
    remainingBudget: number
  ): string | null {
    const fullTokens = this.tokenEstimator.estimate(skill.promptContent)
    const summaryTokens = this.tokenEstimator.estimate(skill.promptSummary)

    if (summaryTokens > remainingBudget) {
      return null  // cannot fit even summary
    }

    if (fullTokens <= remainingBudget) {
      return `## Skill: ${skill.name}\n\n${skill.promptContent}`
    }

    // Progressive disclosure: inject summary with note
    return `## Skill: ${skill.name} (summary)\n\n${skill.promptSummary}\n\n` +
      `_[Full skill content available — ${fullTokens} tokens — request if needed]_`
  }
  ```

- 1.5.4 — **Update `ContextBudgetManager` priority table:**
  ```
  Existing priority (spec §20.3):
    1. Brief + scope + protocol (never trimmed)
    2. Current round data (never trimmed)
    3. Decision log
    4. Clusters
    5. Previous round summary
    6. Evidence packets
    7. Full previous round outputs

  New priority with skills:
    1. Brief + scope + protocol (never trimmed)
    2. Current round data (never trimmed)
    3. Decision log
    3.5 Skill context (NEW — trimmed to summaries, then dropped) ← between 3 and 4
    4. Clusters
    5. Previous round summary
    6. Evidence packets
    7. Full previous round outputs
  ```
  Skill context is higher priority than clusters because skills define *how* the agent should work, while clusters are *what* it found previously.

- 1.5.5 — **Prompt template update:**
  - Add `{{skill_context}}` placeholder in prompt templates (spec §22)
  - If no skills matched, placeholder renders empty string (no visible change)
  - Position: after system instructions, before job brief

**Acceptance criteria:**
- [ ] Skills are injected into AgentContext when triggers match
- [ ] Progressive disclosure works: summary first, full content if budget allows
- [ ] Skill budget is respected (default 20%, configurable)
- [ ] ContextBudgetManager trims skill content before lower-priority items
- [ ] No skill content → no change to existing behavior (backward compatible)
- [ ] Prompt templates include `{{skill_context}}` placeholder

**Files modified:**
- `packages/core/context/context-builder.ts`
- `packages/core/context/budget-manager.ts`
- `packages/core/templates/` (prompt templates)

**Files created:**
- `packages/core/skills/injector.ts` (extracted from ContextBuilder for testability)
- `packages/core/skills/injector.test.ts`

---

### Task 1.6 — SkillSet Configuration

**Goal:** Allow users to define named skill sets that group skills with a shared context budget.

**Subtasks:**

- 1.6.1 — **SkillSet configuration file format:**
  ```yaml
  # .agent-orchestra/skillsets.yaml
  skillsets:
    - id: security-review
      name: Security Review Pack
      description: OWASP checklist + dependency audit + secrets detection
      skills:
        - security-review
        - dependency-audit
        - secrets-hunt
      contextBudgetPercent: 25

    - id: testing
      name: Testing Pack
      description: Test generation and quality checks
      skills:
        - test-generator
        - coverage-check
      contextBudgetPercent: 15
  ```

- 1.6.2 — **Implement `packages/core/skills/skillset-loader.ts`:**
  ```ts
  export class SkillSetLoader {
    /**
     * Load skillset configurations from workspace.
     * Looks for: .agent-orchestra/skillsets.yaml
     */
    load(workspacePath: string): SkillSet[]

    /**
     * Resolve a skillset by ID — returns the SkillSet
     * with validated skill references (all skill IDs must exist in loaded skills).
     */
    resolve(skillSetId: string, loadedSkills: SkillDefinition[]): SkillSet | null
  }
  ```

- 1.6.3 — **SkillSet assignment to agents:**
  - Agents can be assigned a skillset via `AgentAssignment.skillSetId`
  - If no skillset assigned: use all matched skills with default budget (20%)
  - If skillset assigned: only use skills from that skillset, with skillset's budget

- 1.6.4 — **Validation rules:**
  - Skill IDs in skillset must reference existing loaded skills
  - `contextBudgetPercent` must be 0-100
  - Sum of all skillset budgets assigned to agents in a job should warn if > 50% of total context

**Acceptance criteria:**
- [ ] Loads skillsets from YAML config
- [ ] Resolves skill references and reports missing skills
- [ ] Budget validation works
- [ ] Agents can be assigned to skillsets

**Files created:**
- `packages/core/skills/skillset-loader.ts`
- `packages/core/skills/skillset-loader.test.ts`

---

### Task 1.7 — CLI Support

**Goal:** Add CLI commands for inspecting loaded skills.

**Subtasks:**

- 1.7.1 — **`skills list` command:**
  ```
  $ agent-orchestra skills list

  Loaded skills (3 found):
    security-review  v1.0.0  [lens:security]     .agent-orchestra/skills/security-review/
    perf-inspector   v1.2.0  [lens:performance]   .agent-orchestra/skills/perf-inspector/
    test-generator   v0.9.0  [lens:testing]       .agents/skills/test-generator/

  Errors (1):
    .agent-orchestra/skills/broken-skill/: Invalid YAML in frontmatter
  ```

- 1.7.2 — **`skills show <id>` command:**
  ```
  $ agent-orchestra skills show security-review

  security-review v1.0.0
  License: MIT
  Triggers: lenses=[security], keywords=[owasp, vulnerability]
  Source: .agent-orchestra/skills/security-review/
  Content: 847 tokens (summary: 142 tokens)

  --- Summary ---
  Review code changes for OWASP Top 10 vulnerabilities...
  ```

- 1.7.3 — **`skills match --agent <agentId> --job <jobId>` command:**
  ```
  $ agent-orchestra skills match --agent reviewer-1 --job job-123

  Agent: reviewer-1 (role=reviewer, lens=security)
  Matched skills (2):
    security-review  ← lens:security
    owasp-checklist  ← keyword:owasp (found in job brief)

  Unmatched skills (1):
    test-generator   (triggers: lens=testing — does not match)
  ```

**Acceptance criteria:**
- [ ] `skills list` shows all loaded skills with status
- [ ] `skills show` displays full skill details
- [ ] `skills match` shows which skills would match a specific agent/job combo
- [ ] Error output is clear and actionable

**Files modified:**
- `apps/cli/` (add skill commands)

---

### Task 1.8 — Integration Tests

**Goal:** End-to-end test that runs a full job with skill injection and verifies the agent receives skill content.

**Subtasks:**

- 1.8.1 — **Test: skill injected into agent prompt when lens matches:**
  ```
  Given: workspace has security-review skill (triggers: lens=security)
  And: job has reviewer agent with lens=security
  When: protocol round executes
  Then: MockProvider receives prompt containing security-review skill content
  And: prompt contains "## Skill: Security Review"
  ```

- 1.8.2 — **Test: skill NOT injected when lens doesn't match:**
  ```
  Given: workspace has security-review skill (triggers: lens=security)
  And: job has reviewer agent with lens=performance
  When: protocol round executes
  Then: MockProvider receives prompt WITHOUT security-review content
  ```

- 1.8.3 — **Test: progressive disclosure under tight budget:**
  ```
  Given: workspace has large skill (2000 tokens body, 200 tokens summary)
  And: agent's skill budget allows 300 tokens
  When: context is built
  Then: skill summary is injected (not full body)
  And: summary includes "[Full skill content available]" note
  ```

- 1.8.4 — **Test: multiple skills respect budget allocation:**
  ```
  Given: 3 skills matched (500, 800, 1200 tokens)
  And: skill budget is 1000 tokens
  When: context is built
  Then: skill 1 (500 tokens) injected in full
  And: skill 2 (800 tokens) injected as summary
  And: skill 3 (1200 tokens) NOT injected (budget exhausted)
  ```

- 1.8.5 — **Test: always-on skill injected for all agents:**
  ```
  Given: workspace has coding-standards skill (no triggers)
  And: any agent with any lens
  When: protocol round executes
  Then: MockProvider receives prompt containing coding-standards skill content
  ```

- 1.8.6 — **Test: backward compatibility — no skills directory:**
  ```
  Given: workspace has NO .agent-orchestra/skills/ directory
  When: job runs
  Then: job completes successfully (no errors, no skill content)
  And: prompt is identical to pre-skill-system behavior
  ```

**Acceptance criteria:**
- [ ] All 6 integration tests pass
- [ ] Tests use MockProvider (no real API calls)
- [ ] Tests run in CI (<30 seconds total)

**Files created:**
- `tests/integration/skills/prompt-skills.test.ts`

---

### Task 1.9 — Documentation

**Goal:** Document the skill system for users and skill authors.

**Subtasks:**

- 1.9.1 — **`docs/skills/getting-started.md`:**
  - How to create your first skill
  - SKILL.md format reference
  - Directory structure
  - Trigger configuration

- 1.9.2 — **`docs/skills/skill-format.md`:**
  - Complete SKILL.md frontmatter reference
  - Field types, required vs optional
  - Trigger matching rules
  - Progressive disclosure behavior

- 1.9.3 — **`docs/skills/skillsets.md`:**
  - How to define skillsets
  - YAML configuration format
  - Budget allocation

- 1.9.4 — **Update main README** with skills section link

**Acceptance criteria:**
- [ ] A new user can create and load a skill following the getting-started guide
- [ ] All configuration options documented

**Files created:**
- `docs/skills/getting-started.md`
- `docs/skills/skill-format.md`
- `docs/skills/skillsets.md`

---

## Exit Criteria for M1

- [ ] Skills load from `.agent-orchestra/skills/` and `.agents/skills/`
- [ ] SKILL.md parser handles Agent Skills standard format
- [ ] Trigger matching works for lens, role, keyword, always-on
- [ ] ContextBuilder injects matched skill content
- [ ] Progressive disclosure respects context budget
- [ ] SkillSet configuration loads from YAML
- [ ] CLI `skills list/show/match` commands work
- [ ] All unit tests pass (>90% coverage on `packages/core/skills/`)
- [ ] All 6 integration tests pass
- [ ] Documentation complete
- [ ] No breaking changes to existing behavior (jobs without skills work identically)
