# Review Pipeline Correctness — Design Spec

**Date:** 2026-03-22
**Status:** Draft

## Problem

The current review pipeline has several correctness gaps that make the reported output less trustworthy than the actual engine behavior:

- superpower skills are resolved but never injected into prompts
- directory review only reads top-level files
- `--auto-apply` reports success even when no file was written
- apply rounds are persisted as `analysis`
- per-agent provider config can still fail because a default provider is created too early
- MCP review defaults to OpenAI instead of following the documented CLI-first flow

The user also wants target handling to behave more naturally:

- folder targets should review and apply across nested files
- a Markdown file target such as `README.md` or `plan.md` should expand to linked repo-local Markdown files
- auto-apply should work for multi-file review scopes, not just one file

This slice is limited to making the existing review/apply pipeline correct and auditable. It does not add run-to-run comparison, final-vs-original scoring, or baseline lineage yet.

## Goals

1. Make target resolution reflect what users expect for folder and Markdown entry-file targets.
2. Make auto-apply work for multi-file scopes with truthful status reporting.
3. Make stored rounds and job inspection reflect the actual protocol states.
4. Make provider resolution consistent between CLI and MCP.
5. Make superpower skills and runtime defaults affect prompts for real, not just metadata.
6. Preserve the current command surface wherever possible.

## Non-goals

- run-to-run comparison between multiple jobs
- baseline snapshot storage or lineage graphs
- semantic scoring of final artifact versus original artifact
- parsing plain-text file paths from prose
- external link traversal
- create, delete, or rename files during apply
- diff or hunk-based patch application

## Design

### 1. Shared Target Resolution

Add a shared target-resolution module under `apps/cli/src/targeting/` and use it from both CLI and MCP flows.

Suggested units:

- `resolve-target.ts`
  - entry point for turning a user-provided target into a resolved review scope
- `markdown-links.ts`
  - extracts repo-local Markdown links from Markdown files
- `read-scope.ts`
  - reads resolved files into the prompt-ready aggregated content string

The resolver returns a structured result:

```ts
type ResolvedTarget = {
  entryTarget: string
  entryKind: 'file' | 'directory'
  resolvedFiles: string[]
  discovery: Array<{
    path: string
    reason: 'entry' | 'directory_walk' | 'markdown_link'
    discoveredFrom?: string
  }>
}
```

This resolved target is not ephemeral. It must be persisted with the job so later phases can explain:

- which user-facing target started the run
- why each resolved file entered scope
- how a workspace-relative apply block maps back to an allowed file

Job-creation boundary:

- `Orchestrator.createJob()` remains the only supported job materialization path in this slice.
- `CreateJobParams` must grow a `targetResolution` field and pass it through to `JobStore.create()` in the same write that persists `scope.primaryTargets`.
- No later phase is allowed to reconstruct provenance from `scope.primaryTargets` alone.

Behavior:

- If the target is a directory, walk it recursively and collect readable files.
- If the target is a non-Markdown file, review only that file.
- If the target is a Markdown file, include the entry file and recursively expand repo-local Markdown links.
- Expansion must deduplicate files and stop on cycles.
- External URLs are ignored for this slice.

Rules for Markdown expansion:

- Only repo-local links are expanded.
- Only links resolving to existing files inside the workspace are eligible.
- Only Markdown files are recursively expanded.
- Non-Markdown linked files may still be included in `resolvedFiles` for review/apply, but they do not trigger further expansion.
- Relative Markdown links are resolved relative to the Markdown file that contains the link.
- Root-relative repo links are resolved relative to the workspace root.
- Persisted provenance paths are canonical absolute workspace paths after normalization.
- Workspace-relative apply blocks are validated by resolving them back against the same canonical path set used in `resolvedFiles`.
- Duplicate aliases that collapse to the same canonical file must appear only once in `resolvedFiles`.

Bounding rules:

- resolved files must be deterministically ordered by workspace-relative path
- binary files are excluded
- recursive Markdown expansion must have a depth cap
- total resolved file count must have a cap
- total aggregated byte size must have a cap
- if any cap is exceeded, resolution fails early with a clear summary telling the user to narrow the target

Initial defaults for this slice:

- max Markdown recursion depth: `5`
- max resolved files: `200`
- max aggregated bytes: `1_000_000`

This fixes the current mismatch where a folder target silently ignores nested content and where a Markdown hub file does not pull in the documents it points at.

### 2. Shared Scope Content Assembly

CLI and MCP currently duplicate file-reading logic. Replace that duplication with a shared scope reader that consumes `ResolvedTarget`.

The aggregated content should preserve file boundaries:

```text
--- relative/path/to/file.md ---
<content>
```

Use workspace-relative labels in prompt content for readability, but keep absolute paths in `resolvedFiles` for storage and writes.

Scope content assembly must consume the same limits enforced by target resolution and must not silently truncate. If the resolved scope is too large, fail before job creation rather than creating a partial or nondeterministic brief.

### 3. Multi-file Apply Contract

Replace the current single-file-only apply behavior with a deterministic multi-file contract.

The apply prompt will instruct the architect to return a multi-file payload, not a bare replacement blob. The response format should be strict and easy to parse. Example:

```text
=== FILE: docs/plan.md ===
<full updated file content>
=== END FILE ===

=== FILE: docs/spec-a.md ===
<full updated file content>
=== END FILE ===
```

Parser rules:

- Each file block maps to one workspace-relative path.
- Only files present in the resolved review scope may be written.
- Missing files in the response are treated as unchanged.
- Duplicate file blocks are an error for that file and the file is skipped.
- Paths outside scope are skipped and recorded.
- Malformed apply output does not crash the whole job; it produces skipped/error records.
- Parsing must isolate failures at the file-block level whenever framing permits it.
- If the response cannot be segmented into file blocks at all, the apply round records a whole-response error and writes nothing.

Write behavior:

- For each valid file block, compare against original content.
- If content differs, write the file and mark it as written.
- If content is identical, mark it unchanged.
- If parsing or validation fails for a file, mark it skipped with a reason.
- File writes must be atomic at the per-file level, using temp-write plus rename semantics.
- Whole-apply rollback is out of scope for this slice. If one file write fails, already-written files remain written and the failure is recorded in `applySummary`.

This keeps the apply phase deterministic without requiring diff-based merging in this slice.

### 4. Apply Result Recording

Persist apply as a first-class round with `state: 'apply'`.

The stored round summary should include an apply result object:

```ts
type ApplySummary = {
  attemptedFiles: string[]
  writtenFiles: string[]
  unchangedFiles: string[]
  skippedFiles: Array<{ path: string; reason: string }>
  errors: string[]
}
```

Placement:

- add `applySummary` to `Round`
- set it only for `apply` rounds

Protocol behavior:

- emit `round:start` with `state: 'apply'`
- render the apply prompt and invoke the provider
- parse and validate the multi-file response
- perform file writes
- then save the round once with `state: 'apply'` and the final `applySummary`
- emit `round:complete` with `state: 'apply'`

Implementation rule:

- apply must not reuse `runStep()` as-is, because `runStep()` persists a round before file writes happen
- the protocol runner should use a dedicated apply-step path such as `runApplyStep()` that records truthful write results
- if a shared round-update API is introduced instead, it must still guarantee that persisted apply data reflects post-write reality
- sequencing for `runApplyStep()` is strict:
  1. emit `round:start`
  2. execute the apply prompt
  3. parse and validate file blocks
  4. perform writes
  5. build the final `Round` object with `state: 'apply'`, agent output, and `applySummary`
  6. persist the round once
  7. emit `round:complete`

This removes the current audit-trail corruption where apply is stored as analysis.

### 5. Truthful CLI and MCP Reporting

CLI output must stop claiming “applied” unless files were actually written.

New CLI completion behavior:

- keep the job lifecycle status unchanged from orchestrator semantics
- print findings summary as before
- if auto-apply ran, print:
  - attempted file count
  - written file count
  - unchanged file count
  - skipped file count

Example:

```text
Apply summary: wrote 3 file(s), unchanged 2, skipped 1
```

`job show` should surface:

- `apply` rounds distinctly
- apply summary details when present
- a compact target-resolution summary when present:
  - entry target
  - resolved file count
  - discovery counts by reason

MCP read surfaces must be updated in the same slice:

- `get_job` should surface the same compact target-resolution summary as CLI `job show`
- `get_job` should include apply-round summaries when present
- `show_findings` should include apply summary counts when an apply round exists for the job

MCP write-side behavior must also stop using a conflicting provider default and share target resolution logic.

### 6. Provider Resolution

Unify provider resolution for CLI and MCP.

Add a shared provider-planning module under `apps/cli/src/providers/` that:

- supports `auto`
- prefers CLI providers when available
- falls back to OpenAI-compatible API providers only when needed
- resolves per-agent providers before constructing any fallback default provider
- returns normalized per-agent provider/model plans that are ready to be written back onto `AgentAssignment`

Normalization algorithm:

1. Start from the enabled agent list for the run.
2. Derive each agent's desired provider/model from the applicable precedence rules without instantiating any provider objects yet.
3. Resolve any `auto` placeholders to concrete provider/model pairs while still in this pure planning step.
4. Decide whether any enabled agent still requires a shared fallback provider after normalization.
5. Only then instantiate providers and build the router.

Executor shape decision:

- both CLI and MCP must pass a `ProviderRouter`-compatible executor into the protocol runner
- MCP must not keep a single bare provider path once per-agent provider normalization exists
- if every enabled agent has a concrete provider plan, instantiate those concrete providers first, choose one of them as the router default, and register every enabled agent explicitly by ID
- only instantiate a synthetic fallback/default provider if at least one enabled agent still requires a shared default after normalization

CLI rules:

- explicit per-agent flags win
- `agents.yaml` wins next
- superpower presets next
- shared auto/default behavior last

Authority rule:

- the shared provider resolver is the final authority for `providerKey` and `modelOrCommand`
- after `SuperpowerResolver` produces agent assignments, CLI/MCP composition rewrites those assignments with the resolved provider/model values before job creation
- persisted jobs, provider routing, and terminal output must all use the rewritten assignments, not the raw preset defaults
- partial overrides normalize field-by-field:
  - provider-only override keeps the normalized model for that provider path unless an explicit model override is also supplied
  - model-only override applies only when the provider for that agent remains unchanged
  - lazy provider construction happens only after this normalization step

Implementation constraint:

- do not eagerly instantiate an OpenAI provider when architect and reviewer already have concrete providers
- only build a fallback provider if at least one code path still requires it

MCP rules:

- no MCP tool schema change is required in this slice
- MCP provider/model precedence is:
  - `.agent-orchestra/agents.yaml`
  - superpower agent presets
  - shared auto/default behavior
- use the same auto-detection strategy as CLI for the shared auto/default tier
- no hardcoded `openai` default path for ordinary review execution

### 7. Superpower Skill Wiring

Superpower resolution must not stop at metadata only. The resolved skills need to reach prompt building.

Changes:

- load workspace skills and skillsets before job creation in both the CLI and MCP review paths
- validate superpower-referenced skill IDs against loaded skills
- validate superpower-referenced skillset IDs against loaded skillsets
- flatten skillsets to concrete `SkillDefinition[]` before protocol execution
- materialize the final deduplicated `SkillDefinition[]` for the current run
- pass those skills into protocol execution deps through a typed field, not an implicit closure

Required sequencing:

1. Load workspace skills with `SkillLoader.loadFromWorkspace(workspacePath)`.
2. Load workspace skillsets with `SkillSetLoader.load(workspacePath)`.
3. Resolve the selected superpower against those loaded IDs.
4. Flatten validated skillsets to concrete `SkillDefinition[]` and deduplicate them.
5. Merge `runtimeConfigPatch` and normalized provider/model assignments into the job composition payload.
6. Create the job.
7. Build `ProtocolExecutionDeps` with the already-materialized `resolvedSkills` and immediately execute the job in the same process.

This slice does not add detached job replay or persisted skill snapshots. It only guarantees that skill validation and materialization happen on the create-and-run critical path instead of being skipped or deferred.

Materialization boundary:

- `SuperpowerResolver` may continue to return validated skill IDs and skillset IDs.
- A shared composition helper used by both CLI and MCP must turn those IDs plus loaded workspace skills/skillsets into the final deduplicated `resolvedSkills: SkillDefinition[]`.
- That helper is the only place in this slice allowed to flatten skillsets into concrete skills.
- `ProtocolExecutionDeps.resolvedSkills` is populated from that helper output before any prompt is rendered.

Protocol runner changes:

- every `ContextBuilder.buildFor()` call must pass `options.skills`
- pass an appropriate `lifecyclePoint` where useful
- merge `runtimeConfigPatch` into the final job runtime config so `skillBudgetPercent` actually affects context building

Contract change:

```ts
type ProtocolExecutionDeps = {
  ...
  resolvedSkills: SkillDefinition[]
}
```

The runner reads from `deps.resolvedSkills` rather than reloading skills itself.

Consumption rule:

- the same `resolvedSkills` collection is provided to architect and reviewer rounds
- the runner filters by role, lens, and lifecycle through `ContextBuilder.buildFor(..., { skills, lifecyclePoint })`
- if no concrete skills resolve, `resolvedSkills` is an empty array, not `null`

This makes `skill_context` real for architect, reviewer, and follow-up rounds.

### 8. Data Model Adjustments

Required type updates:

- `Job`
  - add persisted target-resolution metadata:

```ts
type TargetResolutionRecord = {
  entryTarget: string
  entryKind: 'file' | 'directory'
  resolvedFiles: string[]
  discovery: Array<{
    path: string
    reason: 'entry' | 'directory_walk' | 'markdown_link'
    discoveredFrom?: string
  }>
}
```

  - store this as `job.targetResolution`
- `CreateJobParams`
  - add required `targetResolution: TargetResolutionRecord`
- `Orchestrator.createJob()`
  - must forward `targetResolution` into `JobStore.create()` together with the expanded `Job` shape
- `JobScope`
  - `scope.primaryTargets` remains the execution-facing list used by the existing protocol runner in this slice
  - at job creation time, `scope.primaryTargets` must equal `job.targetResolution.resolvedFiles`
  - `job.targetResolution` is the canonical provenance record for audit, reporting, and validation of workspace-relative apply blocks
- `Round`
  - add optional `applySummary`

No new top-level storage collection is needed in this slice. Existing job and round JSON files remain the persistence layer.

## Error Handling

- Unreadable files discovered during target resolution are skipped unless they are the original entry target. If the entry target itself cannot be read, fail early.
- A Markdown entry target with some unreadable or invalid linked files still proceeds with the entry file plus the readable subset. Skipped linked files are surfaced as resolution warnings rather than failing the whole run.
- Invalid Markdown links are ignored.
- Cycles in Markdown expansion are harmless because deduplication stops revisits.
- Malformed multi-file apply output should not fail the whole job unless the architect failure policy explicitly requires it. It should produce a completed apply round with skipped/error records.
- Provider resolution errors should point to the actual missing provider/auth problem, not a fallback provider that would never have been used.
- Historical jobs and rounds that do not contain `targetResolution` or `applySummary` must remain readable. Consumers treat those fields as absent and fall back to legacy display behavior.
- Round renderers and event consumers must treat `apply` as a first-class state when present and continue to tolerate legacy jobs that do not have apply rounds.
- Canonical path normalization must reject any resolved or apply-target path that escapes the workspace after normalization.

## Testing Strategy

Use TDD for each behavior change.

Minimum tests:

### Target resolution

- recursive directory traversal includes nested files
- Markdown file target expands repo-local links
- recursive Markdown expansion stops on cycles
- external links are ignored
- non-Markdown file target remains single-file

### Apply

- multi-file apply parser accepts valid file blocks
- apply writes only changed in-scope files
- apply marks unchanged files correctly
- apply skips out-of-scope file blocks
- apply round is stored with `state: 'apply'`
- apply round persistence happens only after writes and records final post-write results

### CLI reporting

- auto-apply summary reports actual write results
- CLI does not claim applied when zero files were written
- `job show` renders legacy jobs without `targetResolution` or `applySummary`
- MCP `get_job` and `show_findings` surface target-resolution and apply-summary read models

### Providers

- per-agent provider config works without instantiating an unused fallback OpenAI provider
- MCP review path follows auto-detect provider strategy
- MCP executes through a router path so distinct architect/reviewer providers can actually take effect

### Superpowers

- resolved superpower skills reach `ContextBuilder.buildFor(..., { skills })`
- `runtimeConfigPatch.skillBudgetPercent` is merged into the job runtime config
- MCP and CLI both flatten skillsets to the same concrete skill list

### Compatibility

- historical jobs without `targetResolution` still load
- historical rounds without `applySummary` still load
- new jobs persist both `scope.primaryTargets` and `targetResolution.resolvedFiles` identically
- round consumers render `apply` distinctly while still tolerating legacy jobs without apply rounds
- canonical workspace-relative apply paths round-trip back to the persisted canonical absolute target set

## File Impact

Expected primary edits:

- `apps/cli/src/commands/run.ts`
- `apps/cli/src/mcp/handlers.ts`
- `apps/cli/src/commands/job.ts`
- `apps/cli/src/init/agents-config.ts`
- `packages/core/src/protocols/single-challenger.ts`
- `packages/core/src/types/protocol.ts`
- `packages/core/src/orchestrator/orchestrator.ts`
- `packages/core/src/storage/job-store.ts`
- `packages/core/src/storage/types.ts`
- `packages/core/src/types/job.ts`
- `packages/core/src/types/orchestrator.ts`
- `packages/core/src/superpowers/types.ts` if needed
- `packages/core/src/superpowers/resolver.ts` if assignment rewriting is centralized there rather than in CLI/MCP composition

Expected new files:

- `apps/cli/src/targeting/resolve-target.ts`
- `apps/cli/src/targeting/read-scope.ts`
- `apps/cli/src/targeting/markdown-links.ts`
- `apps/cli/src/providers/resolve-provider.ts`
- `apps/cli/src/superpowers/resolve-run-skills.ts` if the shared skill-materialization helper is extracted
- tests for the new targeting/provider helpers

## Migration and Compatibility

- Existing CLI flags and superpower IDs remain unchanged.
- Existing stored jobs remain readable.
- Existing apply behavior becomes stricter and more truthful, but not less capable.
- Existing MCP tools keep the same names and input shapes.
- MCP provider selection remains configuration-driven through workspace state rather than new tool arguments in this slice.
- Detached replay of an already-persisted job with rehydrated provider/skill execution deps remains out of scope for this slice.

## Future Expansion Notes

- parse plain-text repo-relative paths from prose
- expand references from code fences and richer document semantics
- support create/delete/rename in apply
- switch from full-file replacement to diff or hunk application
- add baseline snapshots and run-to-run comparison
- add final-vs-original evaluation as a first-class protocol phase
