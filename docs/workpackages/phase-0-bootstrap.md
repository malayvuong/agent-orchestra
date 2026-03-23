# Phase 0 — Project Bootstrap

> **Start date:** TBD. **Duration:** ~1 week (5 working days).
> **Owner:** Backend/CLI Dev (1.0 FTE)
> **Must complete before:** M1 (Prompt Skills), Phase A, and all subsequent milestones.

---

## Objective

Scaffold the minimum viable monorepo structure so that Phase A (Prompt Skills) can begin writing real code on day one. This phase produces zero runtime functionality — only project infrastructure, type stubs, an empty CLI shell, and developer tooling.

## Success Criteria

By the end of Phase 0, a developer cloning the repo can:

1. Run `pnpm install` and get a clean dependency tree across all workspaces.
2. Run `pnpm build` and get successful TypeScript compilation in every package.
3. Run `pnpm test` and see vitest execute (with placeholder passing tests).
4. Run `pnpm lint` and `pnpm format:check` with zero errors.
5. Run `pnpm dev:cli -- --help` and see the `agent-orchestra` CLI with a `skills` command group.
6. Import any spec v1.3 section 4 type from `@agent-orchestra/core` without errors.
7. Commit code and have husky + lint-staged run pre-commit checks automatically.

## Dependencies

| Dependency | Source | Notes |
|-----------|--------|-------|
| Spec v1.3 (canonical) | `docs/spec-v1.3-patch.md` | All types derived from sections 4-9, 20 |
| Node.js >= 20 | Runtime | Required for native ESM and `node:` imports |
| pnpm >= 9 | Package manager | Workspace protocol support |

## Non-Goals

- No runtime logic, business logic, or provider implementations.
- No CI/CD pipeline (separate task).
- No Docker or deployment configuration.
- No web dashboard scaffolding beyond the empty `apps/server/` workspace entry.

---

## Tasks

### Task 0.1 — Monorepo Workspace Setup

**Goal:** Initialize pnpm workspaces with the canonical module structure from spec v1.3 section 3.2.

**Subtasks:**

1. **0.1.1** — Create root `package.json` with workspace configuration:
   ```json
   {
     "name": "agent-orchestra",
     "private": true,
     "type": "module",
     "packageManager": "pnpm@9.15.4",
     "engines": { "node": ">=20.0.0" },
     "scripts": {
       "build": "pnpm -r run build",
       "dev:cli": "pnpm --filter @agent-orchestra/cli dev",
       "dev:server": "pnpm --filter @agent-orchestra/server dev",
       "test": "vitest run",
       "test:watch": "vitest",
       "lint": "eslint .",
       "format": "prettier --write .",
       "format:check": "prettier --check .",
       "typecheck": "pnpm -r run typecheck",
       "prepare": "husky"
     }
   }
   ```

2. **0.1.2** — Create `pnpm-workspace.yaml`:
   ```yaml
   packages:
     - 'packages/*'
     - 'apps/*'
   ```

3. **0.1.3** — Create workspace directory structure:
   ```
   packages/
     core/
       package.json
       src/
       tsconfig.json
     shared/
       package.json
       src/
       tsconfig.json
   apps/
     cli/
       package.json
       src/
       tsconfig.json
     server/
       package.json
       src/
       tsconfig.json
   ```

4. **0.1.4** — Create individual `package.json` files for each workspace:

   - `packages/core/package.json` — name: `@agent-orchestra/core`, main entry: `dist/index.js`, types: `dist/index.d.ts`
   - `packages/shared/package.json` — name: `@agent-orchestra/shared`, main entry: `dist/index.js`, types: `dist/index.d.ts`
   - `apps/cli/package.json` — name: `@agent-orchestra/cli`, bin: `{ "agent-orchestra": "./dist/index.js" }`
   - `apps/server/package.json` — name: `@agent-orchestra/server` (placeholder, no build script yet)

5. **0.1.5** — Add cross-workspace dependency declarations:
   - `@agent-orchestra/cli` depends on `@agent-orchestra/core` and `@agent-orchestra/shared` via `workspace:*`
   - `@agent-orchestra/server` depends on `@agent-orchestra/core` and `@agent-orchestra/shared` via `workspace:*`
   - `@agent-orchestra/core` depends on `@agent-orchestra/shared` via `workspace:*`

6. **0.1.6** — Run `pnpm install` and verify clean lockfile generation.

**Acceptance Criteria:**

- [ ] `pnpm install` succeeds with zero warnings about missing workspaces.
- [ ] `pnpm ls --depth 0 -r` shows all four workspaces.
- [ ] Cross-workspace imports resolve correctly in IDE (VSCode/WebStorm).
- [ ] `pnpm-lock.yaml` is committed and reproducible.

**Files Created:**

- `package.json`
- `pnpm-workspace.yaml`
- `packages/core/package.json`
- `packages/shared/package.json`
- `apps/cli/package.json`
- `apps/server/package.json`

---

### Task 0.2 — TypeScript Configuration

**Goal:** Set up a layered tsconfig with strict mode, path aliases, and per-workspace configs that extend a shared base.

**Subtasks:**

1. **0.2.1** — Create root `tsconfig.base.json` (shared compiler options):
   ```json
   {
     "compilerOptions": {
       "target": "ES2022",
       "module": "ESNext",
       "moduleResolution": "bundler",
       "lib": ["ES2022"],
       "strict": true,
       "esModuleInterop": true,
       "skipLibCheck": true,
       "forceConsistentCasingInFileNames": true,
       "resolveJsonModule": true,
       "isolatedModules": true,
       "declaration": true,
       "declarationMap": true,
       "sourceMap": true,
       "outDir": "dist",
       "rootDir": "src"
     }
   }
   ```

2. **0.2.2** — Create root `tsconfig.json` (project references):
   ```json
   {
     "files": [],
     "references": [
       { "path": "packages/core" },
       { "path": "packages/shared" },
       { "path": "apps/cli" },
       { "path": "apps/server" }
     ]
   }
   ```

3. **0.2.3** — Create per-workspace `tsconfig.json` files, each extending `tsconfig.base.json`:

   - `packages/core/tsconfig.json` — references `packages/shared`, path alias `@agent-orchestra/shared`
   - `packages/shared/tsconfig.json` — no references (leaf package)
   - `apps/cli/tsconfig.json` — references `packages/core` and `packages/shared`
   - `apps/server/tsconfig.json` — references `packages/core` and `packages/shared`

4. **0.2.4** — Add `typecheck` script to each workspace `package.json`:
   ```
   "typecheck": "tsc --noEmit"
   ```

5. **0.2.5** — Verify `pnpm typecheck` passes across all workspaces.

**Acceptance Criteria:**

- [ ] `pnpm typecheck` exits 0 across all four workspaces.
- [ ] Path aliases resolve in IDE without red squiggles.
- [ ] `strict: true` is enforced (no implicit any, strict null checks, etc.).
- [ ] Each workspace produces `.d.ts` declaration files in `dist/`.

**Files Created:**

- `tsconfig.base.json`
- `tsconfig.json`
- `packages/core/tsconfig.json`
- `packages/shared/tsconfig.json`
- `apps/cli/tsconfig.json`
- `apps/server/tsconfig.json`

---

### Task 0.3 — Core Type Stubs from Spec v1.3 Section 4

**Goal:** Define all TypeScript types that Phase A (Prompt Skills) needs to compile against. These are type-only exports — no runtime implementations beyond minimal stubs. Every type must include a JSDoc comment citing its spec section number.

**Subtasks:**

1. **0.3.1** — Create `packages/core/src/types/job.ts` — Job-related types:
   ```ts
   /** Spec v1.3 §4.1 */
   export type JobStatus =
     | 'draft' | 'queued' | 'running'
     | 'awaiting_decision' | 'completed' | 'cancelled' | 'failed'

   /** Spec v1.3 §4.2 */
   export type JobMode = 'plan' | 'code_review' | 'execution_review'

   /** Spec v1.3 §4.5 */
   export type ReferenceDepth = 'same_file' | 'same_folder' | 'same_module' | 'repo'
   export type OutOfScopeHandling = 'ignore' | 'note' | 'follow_up'
   export type JobScope = {
     primaryTargets: string[]
     excludedTargets: string[]
     referencePolicy: { enabled: boolean; depth: ReferenceDepth }
     outOfScopeHandling: OutOfScopeHandling
     allowDebateExpansion: false
   }

   /** Spec v1.3 §4.16 */
   export type SynthesisConfig = {
     provider: 'architect_provider' | 'dedicated'
     dedicatedProviderKey?: string
     rerunnable: boolean
   }
   export type JobRuntimeConfig = {
     maxConcurrentAgents: number
     pausePointsEnabled: boolean
     synthesisConfig: SynthesisConfig
   }
   ```

2. **0.3.2** — Create `packages/core/src/types/agent.ts` — Agent-related types:
   ```ts
   /** Spec v1.3 §4.3 */
   export type AgentRole = 'architect' | 'reviewer' | 'builder'

   /** Spec v1.3 §4.4 */
   export type AgentLens =
     | 'logic' | 'consistency' | 'regression' | 'testing'
     | 'performance' | 'security' | 'cross_system_contract'
     | 'scope' | 'dependency' | 'sequencing'
     | 'simplification' | 'risk' | 'implementation_readiness'

   /** Spec v1.3 §4.8 */
   export type AgentConnectionType = 'api' | 'cli' | 'bridge'
   export type AgentConfig = {
     id: string
     name: string
     role: AgentRole
     lens?: AgentLens
     connectionType: AgentConnectionType
     providerKey: string
     modelOrCommand: string
     protocolPreset: string
     enabled: boolean
     maxFindings?: number
     allowReferenceScan: boolean
     canWriteCode: boolean
     timeoutMs?: number
     retryCount?: number
     tokenBudget?: number
     envRefs?: string[]
     workingDirectory?: string
     commandTemplate?: string
     notes?: string
   }

   /** Spec v1.3 §4.9 */
   export type AgentAssignment = {
     id: string
     agentConfigId: string
     role: AgentRole
     lens?: AgentLens
     connectionType: AgentConnectionType
     providerKey: string
     modelOrCommand: string
     protocol: string
     enabled: boolean
     maxFindings?: number
     allowReferenceScan: boolean
     canWriteCode: boolean
   }
   ```

3. **0.3.3** — Create `packages/core/src/types/finding.ts` — Finding types:
   ```ts
   /** Spec v1.3 §4.7 */
   export type FindingScopeType = 'primary' | 'reference' | 'out_of_scope'
   export type FindingActionability = 'must_fix_now' | 'note_only' | 'follow_up_candidate'
   export type FindingConfidence = 'high' | 'medium' | 'low'
   export type FindingEvidence = {
     files: string[]
     summary: string
     excerpts?: string[]
   }
   export type Finding = {
     id: string
     title: string
     description: string
     scopeType: FindingScopeType
     actionability: FindingActionability
     confidence: FindingConfidence
     evidence?: FindingEvidence
     tags?: string[]
     relatedClusterId?: string
   }
   ```

4. **0.3.4** — Create `packages/core/src/types/output.ts` — Output and normalization types:
   ```ts
   /** Spec v1.3 §4.10 */
   export type AgentOutput = {
     rawText: string
     structuredSections: Record<string, string>
     findings: Finding[]
     warnings: string[]
     usage?: {
       inputTokens?: number
       outputTokens?: number
       cost?: number
       latencyMs?: number
     }
   }

   /** Spec v1.3 §4.11 */
   export type ProviderOutput = {
     rawText: string
     structuredSections?: Record<string, unknown>
     warnings?: string[]
     usage?: {
       inputTokens?: number
       outputTokens?: number
       cost?: number
       latencyMs?: number
     }
     exitCode?: number
     stderrText?: string
   }

   /** Spec v1.3 §7.3 */
   export type NormalizationResult = {
     output: AgentOutput
     warnings: string[]
     malformed: boolean
     malformedReason?: string
   }
   ```

5. **0.3.5** — Create `packages/core/src/types/context.ts` — Context types:
   ```ts
   /** Spec v1.3 §6.1 */
   export type EvidencePacket = {
     path: string
     relation: 'primary' | 'reference'
     reason: string
     excerpt: string
   }
   export type AgentContext = {
     role: AgentRole
     mode: JobMode
     pinned: {
       brief: string
       scope: JobScope
       decisionLog: DecisionLog
       protocol: Protocol
     }
     dynamic: {
       currentRound?: Round
       previousRoundSummary?: string
       clusters?: FindingCluster[]
     }
     evidence: EvidencePacket[]
   }
   ```

6. **0.3.6** — Create `packages/core/src/types/protocol.ts` — Protocol and round types:
   ```ts
   /** Spec v1.3 §5.1 */
   export type Protocol =
     | 'single_challenger'
     | 'reviewer_wave'
     | 'reviewer_wave_with_final_check'
     | 'builder_plus_reviewer'

   /** Spec v1.3 §4.13 */
   export type RoundState =
     | 'analysis' | 'review' | 'review_wave' | 'build'
     | 'cluster' | 'rebuttal' | 'final_check' | 'convergence'

   /** Spec v1.3 §4.14 */
   export type Round = { /* ... full type from spec ... */ }

   /** Spec v1.3 §4.12 */
   export type FindingClusterStatus = 'confirmed' | 'disputed' | 'needs_decision'
   export type FindingCluster = { /* ... full type from spec ... */ }

   /** Spec v1.3 §4.6 */
   export type DecisionEntrySource = 'user' | 'system'
   export type DecisionEntry = {
     message: string
     createdAt: string
     source: DecisionEntrySource
   }
   export type DecisionLog = {
     lockedConstraints: DecisionEntry[]
     acceptedDecisions: DecisionEntry[]
     rejectedOptions: DecisionEntry[]
     unresolvedItems: DecisionEntry[]
   }
   ```

7. **0.3.7** — Create `packages/core/src/types/index.ts` — Barrel export re-exporting all types from above files.

**Acceptance Criteria:**

- [ ] Every type from spec v1.3 sections 4.1-4.17, 5.1, 6.1, 7.3 is exported from `@agent-orchestra/core`.
- [ ] Every exported type has a JSDoc comment citing its spec section (e.g., `/** Spec v1.3 §4.7 */`).
- [ ] `pnpm typecheck` passes — all cross-references between types resolve.
- [ ] No runtime code — only type exports and `type` keyword declarations.

**Files Created:**

- `packages/core/src/types/job.ts`
- `packages/core/src/types/agent.ts`
- `packages/core/src/types/finding.ts`
- `packages/core/src/types/output.ts`
- `packages/core/src/types/context.ts`
- `packages/core/src/types/protocol.ts`
- `packages/core/src/types/index.ts`

---

### Task 0.4 — Core Interface Stubs

**Goal:** Define the interfaces and abstract class stubs that Phase A code will implement against. These are contracts only — no logic beyond `throw new Error('Not implemented')`.

**Subtasks:**

1. **0.4.1** — Create `packages/core/src/interfaces/context-budget-manager.ts`:
   ```ts
   import type { AgentContext } from '../types/index.js'

   /** Spec v1.3 §20.2 */
   export interface ContextBudgetManager {
     fitToLimit(context: AgentContext, tokenLimit: number): AgentContext
   }
   ```

2. **0.4.2** — Create `packages/core/src/interfaces/token-estimator.ts`:
   ```ts
   /** Spec v1.3 §20.5 */
   export interface TokenEstimator {
     estimate(text: string): number
   }
   ```

3. **0.4.3** — Create `packages/core/src/interfaces/output-normalizer.ts`:
   ```ts
   import type { AgentRole } from '../types/agent.js'
   import type { ProviderOutput, NormalizationResult } from '../types/output.js'

   /** Spec v1.3 §7.3 */
   export interface OutputNormalizer {
     normalize(
       providerOutput: ProviderOutput,
       meta: { agentId: string; role: AgentRole; templateVersion: number }
     ): NormalizationResult
   }
   ```

4. **0.4.4** — Create `packages/core/src/interfaces/protocol-runner.ts`:
   ```ts
   import type { ProtocolExecutionDeps } from '../types/orchestrator.js'
   import type { Job } from '../types/job.js'

   /** Spec v1.3 §8.1 */
   export interface ProtocolRunner {
     execute(job: Job, deps: ProtocolExecutionDeps): Promise<void>
   }
   ```

5. **0.4.5** — Create `packages/core/src/interfaces/cancellation-registry.ts`:
   ```ts
   /** Spec v1.3 §9.2 */
   export interface CancelHandle {
     cancel(): Promise<void>
   }
   export interface CancellationRegistry {
     register(jobId: string, agentId: string, handle: CancelHandle): void
     cancelJob(jobId: string): Promise<void>
     isCancelled(jobId: string): boolean
   }
   ```

6. **0.4.6** — Create `packages/core/src/context/context-builder.ts` — Stub class:
   ```ts
   import type { AgentAssignment } from '../types/agent.js'
   import type { AgentContext } from '../types/context.js'
   import type { ContextBudgetManager } from '../interfaces/context-budget-manager.js'

   /**
    * Assembles AgentContext for a given agent and job.
    * Spec v1.3 §35.3 — must call ContextBudgetManager.fitToLimit() before returning.
    */
   export class ContextBuilder {
     constructor(private budgetManager: ContextBudgetManager) {}

     buildFor(_agent: AgentAssignment, _job: unknown): AgentContext {
       throw new Error('Not implemented — Phase A will implement this')
     }
   }
   ```

7. **0.4.7** — Create `packages/core/src/types/orchestrator.ts` — `ProtocolExecutionDeps` type:
   ```ts
   /** Spec v1.3 §8.2 — Dependencies injected into ProtocolRunner.execute() */
   export type ProtocolExecutionDeps = {
     providerExecutor: unknown   // Defined in provider package, stubbed here
     contextBuilder: unknown     // ContextBuilder
     outputNormalizer: unknown   // OutputNormalizer
     scopeGuard: unknown         // ScopeGuard
     clusteringEngine: unknown   // ClusteringEngine
     synthesisEngine: unknown    // SynthesisEngine
     roundStore: unknown         // RoundStore
     jobStore: unknown           // JobStore
     eventBus: unknown           // EventBus
     cancellationRegistry: unknown // CancellationRegistry
   }
   ```
   > Note: Uses `unknown` for deps that belong to other packages. These will be replaced with concrete interface imports as those packages are implemented.

8. **0.4.8** — Create `packages/core/src/interfaces/index.ts` — Barrel export for all interfaces.

9. **0.4.9** — Create `packages/core/src/index.ts` — Root barrel export combining types and interfaces:
   ```ts
   export * from './types/index.js'
   export * from './interfaces/index.js'
   export { ContextBuilder } from './context/context-builder.js'
   ```

**Acceptance Criteria:**

- [ ] All interfaces from spec sections 7.3, 8.1, 8.2, 9.2, 20.2, 20.5 are exported from `@agent-orchestra/core`.
- [ ] `ContextBuilder` stub class is importable and instantiable (throws on `buildFor` call).
- [ ] `ProtocolExecutionDeps` type is exported.
- [ ] `pnpm typecheck` passes with all stubs in place.

**Files Created:**

- `packages/core/src/interfaces/context-budget-manager.ts`
- `packages/core/src/interfaces/token-estimator.ts`
- `packages/core/src/interfaces/output-normalizer.ts`
- `packages/core/src/interfaces/protocol-runner.ts`
- `packages/core/src/interfaces/cancellation-registry.ts`
- `packages/core/src/interfaces/index.ts`
- `packages/core/src/context/context-builder.ts`
- `packages/core/src/types/orchestrator.ts`
- `packages/core/src/index.ts`

---

### Task 0.5 — CLI Shell with Commander.js

**Goal:** Create a minimal CLI application using `commander` that registers the `agent-orchestra` binary and has a `skills` command group with empty subcommands. This gives Phase A a working CLI to attach skill commands to.

**Subtasks:**

1. **0.5.1** — Install dependencies in `apps/cli/`:
   ```bash
   cd apps/cli && pnpm add commander@^13
   pnpm add -D tsx @types/node
   ```

2. **0.5.2** — Create `apps/cli/src/index.ts` — Entry point:
   ```ts
   #!/usr/bin/env node
   import { createProgram } from './program.js'

   const program = createProgram()
   program.parse()
   ```

3. **0.5.3** — Create `apps/cli/src/program.ts` — Program definition:
   ```ts
   import { Command } from 'commander'
   import { registerSkillsCommand } from './commands/skills.js'

   export function createProgram(): Command {
     const program = new Command()
       .name('agent-orchestra')
       .description('AI agent orchestration for multi-agent code review and planning')
       .version('2026.3.1')

     registerSkillsCommand(program)

     return program
   }
   ```

4. **0.5.4** — Create `apps/cli/src/commands/skills.ts` — Skills command group:
   ```ts
   import { Command } from 'commander'

   export function registerSkillsCommand(program: Command): void {
     const skills = program
       .command('skills')
       .description('Manage prompt skills')

     skills
       .command('list')
       .description('List loaded skills')
       .action(() => {
         console.log('Skills list — not yet implemented (Phase A)')
       })

     skills
       .command('inspect <skill-id>')
       .description('Show details of a specific skill')
       .action((skillId: string) => {
         console.log(`Inspect skill ${skillId} — not yet implemented (Phase A)`)
       })

     skills
       .command('validate [path]')
       .description('Validate skill definitions in a directory')
       .action((path?: string) => {
         console.log(`Validate skills at ${path ?? '.'} — not yet implemented (Phase A)`)
       })
   }
   ```

5. **0.5.5** — Add dev script to `apps/cli/package.json`:
   ```json
   {
     "scripts": {
       "dev": "tsx src/index.ts",
       "build": "tsup src/index.ts --format esm --dts --clean"
     }
   }
   ```

6. **0.5.6** — Verify the CLI works:
   ```bash
   pnpm dev:cli -- --help
   pnpm dev:cli -- skills --help
   pnpm dev:cli -- skills list
   ```

**Acceptance Criteria:**

- [ ] `pnpm dev:cli -- --help` prints help with `skills` listed as a command.
- [ ] `pnpm dev:cli -- skills --help` lists `list`, `inspect`, `validate` subcommands.
- [ ] `pnpm dev:cli -- skills list` prints the placeholder message (exit 0).
- [ ] `pnpm dev:cli -- --version` prints `2026.3.1`.

**Files Created:**

- `apps/cli/src/index.ts`
- `apps/cli/src/program.ts`
- `apps/cli/src/commands/skills.ts`

---

### Task 0.6 — Test Framework Setup (Vitest)

**Goal:** Configure vitest as the test runner with workspace-aware configuration, test fixture directories, and at least one passing smoke test per workspace.

**Subtasks:**

1. **0.6.1** — Install vitest at the root:
   ```bash
   pnpm add -D vitest @vitest/coverage-v8
   ```

2. **0.6.2** — Create root `vitest.config.ts`:
   ```ts
   import { defineConfig } from 'vitest/config'

   export default defineConfig({
     test: {
       globals: true,
       include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
       coverage: {
         provider: 'v8',
         include: ['packages/*/src/**/*.ts', 'apps/*/src/**/*.ts'],
         exclude: ['**/*.test.ts', '**/*.d.ts', '**/index.ts'],
       },
     },
   })
   ```

3. **0.6.3** — Create test fixture directory structure:
   ```
   test/
     fixtures/
       skills/                   # Phase A will populate
         valid/
           .gitkeep
         invalid/
           .gitkeep
       providers/                # Phase 1A will populate
         .gitkeep
       jobs/                     # Phase 1A will populate
         .gitkeep
   ```

4. **0.6.4** — Create smoke test `packages/core/src/types/__tests__/types.test.ts`:
   ```ts
   import { describe, it, expect } from 'vitest'
   import type { AgentRole, AgentLens, JobStatus, Finding } from '../index.js'

   describe('Core types', () => {
     it('should allow valid AgentRole values', () => {
       const role: AgentRole = 'architect'
       expect(role).toBe('architect')
     })

     it('should allow valid JobStatus values', () => {
       const status: JobStatus = 'running'
       expect(status).toBe('running')
     })
   })
   ```

5. **0.6.5** — Create smoke test `apps/cli/src/__tests__/program.test.ts`:
   ```ts
   import { describe, it, expect } from 'vitest'
   import { createProgram } from '../program.js'

   describe('CLI program', () => {
     it('should create program with name agent-orchestra', () => {
       const program = createProgram()
       expect(program.name()).toBe('agent-orchestra')
     })

     it('should have skills command registered', () => {
       const program = createProgram()
       const skills = program.commands.find(c => c.name() === 'skills')
       expect(skills).toBeDefined()
     })
   })
   ```

6. **0.6.6** — Verify `pnpm test` runs all tests and exits 0.

**Acceptance Criteria:**

- [ ] `pnpm test` discovers and runs all `*.test.ts` files.
- [ ] All smoke tests pass (at least 2 test files, 4+ assertions).
- [ ] `pnpm test -- --coverage` generates a coverage report.
- [ ] Test fixture directories exist and are committed (via `.gitkeep`).

**Files Created:**

- `vitest.config.ts`
- `test/fixtures/skills/valid/.gitkeep`
- `test/fixtures/skills/invalid/.gitkeep`
- `test/fixtures/providers/.gitkeep`
- `test/fixtures/jobs/.gitkeep`
- `packages/core/src/types/__tests__/types.test.ts`
- `apps/cli/src/__tests__/program.test.ts`

---

### Task 0.7 — Build Tooling

**Goal:** Configure tsup for building library packages and tsx for CLI dev mode. Every workspace must have a working `build` script.

**Subtasks:**

1. **0.7.1** — Install tsup in library packages:
   ```bash
   pnpm --filter @agent-orchestra/core add -D tsup
   pnpm --filter @agent-orchestra/shared add -D tsup
   pnpm --filter @agent-orchestra/cli add -D tsup
   ```

2. **0.7.2** — Create `packages/core/tsup.config.ts`:
   ```ts
   import { defineConfig } from 'tsup'

   export default defineConfig({
     entry: ['src/index.ts'],
     format: ['esm'],
     dts: true,
     clean: true,
     sourcemap: true,
   })
   ```

3. **0.7.3** — Create `packages/shared/tsup.config.ts` (same structure as core).

4. **0.7.4** — Create `apps/cli/tsup.config.ts`:
   ```ts
   import { defineConfig } from 'tsup'

   export default defineConfig({
     entry: ['src/index.ts'],
     format: ['esm'],
     dts: false,
     clean: true,
     sourcemap: true,
     banner: { js: '#!/usr/bin/env node' },
   })
   ```

5. **0.7.5** — Add build scripts to each workspace `package.json`:
   ```
   "build": "tsup"
   ```

6. **0.7.6** — Verify `pnpm build` succeeds across all workspaces (ordered by dependency).

7. **0.7.7** — For `apps/server/`, add a placeholder:
   ```json
   { "scripts": { "build": "echo 'Server build — not yet configured'" } }
   ```

**Acceptance Criteria:**

- [ ] `pnpm build` succeeds with exit 0.
- [ ] `packages/core/dist/index.js` and `packages/core/dist/index.d.ts` exist after build.
- [ ] `packages/shared/dist/` contains built artifacts.
- [ ] `apps/cli/dist/index.js` starts with `#!/usr/bin/env node`.
- [ ] Built CLI is executable: `node apps/cli/dist/index.js --help`.

**Files Created:**

- `packages/core/tsup.config.ts`
- `packages/shared/tsup.config.ts`
- `apps/cli/tsup.config.ts`

---

### Task 0.8 — Linting (ESLint + Prettier)

**Goal:** Minimal but strict linting configuration. No custom rules beyond what TypeScript strict mode and standard ESLint presets enforce.

**Subtasks:**

1. **0.8.1** — Install ESLint and Prettier at the root:
   ```bash
   pnpm add -D eslint @eslint/js typescript-eslint prettier eslint-config-prettier
   ```

2. **0.8.2** — Create `eslint.config.js` (flat config):
   ```ts
   import js from '@eslint/js'
   import tseslint from 'typescript-eslint'
   import prettier from 'eslint-config-prettier'

   export default tseslint.config(
     js.configs.recommended,
     ...tseslint.configs.recommended,
     prettier,
     {
       ignores: ['**/dist/**', '**/node_modules/**', '**/*.config.*'],
     },
     {
       rules: {
         '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
         '@typescript-eslint/consistent-type-imports': 'error',
       },
     },
   )
   ```

3. **0.8.3** — Create `.prettierrc`:
   ```json
   {
     "semi": false,
     "singleQuote": true,
     "trailingComma": "all",
     "printWidth": 100,
     "tabWidth": 2
   }
   ```

4. **0.8.4** — Create `.prettierignore`:
   ```
   dist/
   node_modules/
   pnpm-lock.yaml
   *.md
   ```

5. **0.8.5** — Run `pnpm lint` and `pnpm format:check`. Fix any violations in scaffolded files.

**Acceptance Criteria:**

- [ ] `pnpm lint` exits 0 with no errors or warnings.
- [ ] `pnpm format:check` exits 0 (all files match Prettier style).
- [ ] Unused variables prefixed with `_` are allowed (for stub parameters).
- [ ] Type-only imports are enforced via `consistent-type-imports`.

**Files Created:**

- `eslint.config.js`
- `.prettierrc`
- `.prettierignore`

---

### Task 0.9 — Git Hooks (Husky + lint-staged)

**Goal:** Pre-commit hooks that run linting and formatting on staged files, preventing broken code from being committed.

**Subtasks:**

1. **0.9.1** — Install husky and lint-staged:
   ```bash
   pnpm add -D husky lint-staged
   ```

2. **0.9.2** — Initialize husky:
   ```bash
   pnpm exec husky init
   ```

3. **0.9.3** — Create `.husky/pre-commit`:
   ```bash
   pnpm exec lint-staged
   ```

4. **0.9.4** — Add lint-staged config to root `package.json`:
   ```json
   {
     "lint-staged": {
       "*.{ts,tsx,js,jsx}": [
         "eslint --fix",
         "prettier --write"
       ],
       "*.{json,yaml,yml}": [
         "prettier --write"
       ]
     }
   }
   ```

5. **0.9.5** — Verify by staging a file and running `git commit` — hook should trigger.

**Acceptance Criteria:**

- [ ] `git commit` triggers lint-staged on staged `.ts` files.
- [ ] ESLint auto-fixes are applied before commit.
- [ ] Prettier formatting is applied before commit.
- [ ] Hook does not run on `dist/` or `node_modules/`.

**Files Created:**

- `.husky/pre-commit`

**Files Modified:**

- `package.json` (lint-staged config added)

---

### Task 0.10 — Shared Package Seed

**Goal:** Populate `packages/shared/` with the minimal utilities that both `core` and `cli` will need immediately.

**Subtasks:**

1. **0.10.1** — Create `packages/shared/src/constants.ts`:
   ```ts
   /** Default storage directory for agent-orchestra data */
   export const DEFAULT_STORAGE_DIR = '.agent-orchestra'

   /** Default job runtime config values (spec v1.3 §4.16) */
   export const DEFAULT_RUNTIME_CONFIG = {
     maxConcurrentAgents: 3,
     pausePointsEnabled: false,
     synthesisConfig: {
       provider: 'architect_provider' as const,
       rerunnable: true,
     },
   } as const
   ```

2. **0.10.2** — Create `packages/shared/src/errors.ts`:
   ```ts
   /** Base error class for all agent-orchestra errors */
   export class AgentOrchestraError extends Error {
     constructor(message: string, public readonly code: string) {
       super(message)
       this.name = 'AgentOrchestraError'
     }
   }

   export class NotImplementedError extends AgentOrchestraError {
     constructor(feature: string) {
       super(`${feature} is not yet implemented`, 'NOT_IMPLEMENTED')
       this.name = 'NotImplementedError'
     }
   }
   ```

3. **0.10.3** — Create `packages/shared/src/index.ts` — Barrel export.

**Acceptance Criteria:**

- [ ] `@agent-orchestra/shared` exports `DEFAULT_STORAGE_DIR`, `DEFAULT_RUNTIME_CONFIG`, `AgentOrchestraError`, `NotImplementedError`.
- [ ] `@agent-orchestra/core` can import from `@agent-orchestra/shared` without errors.
- [ ] `pnpm build` and `pnpm typecheck` pass.

**Files Created:**

- `packages/shared/src/constants.ts`
- `packages/shared/src/errors.ts`
- `packages/shared/src/index.ts`

---

### Task 0.11 — Root Configuration Files

**Goal:** Add standard project root configuration that downstream tasks expect.

**Subtasks:**

1. **0.11.1** — Create/update `.gitignore`:
   ```
   node_modules/
   dist/
   .agent-orchestra/
   *.tsbuildinfo
   coverage/
   .env
   .env.*
   !.env.example
   ```

2. **0.11.2** — Create `.nvmrc`:
   ```
   20
   ```

3. **0.11.3** — Create `.editorconfig`:
   ```ini
   root = true

   [*]
   indent_style = space
   indent_size = 2
   end_of_line = lf
   charset = utf-8
   trim_trailing_whitespace = true
   insert_final_newline = true

   [*.md]
   trim_trailing_whitespace = false
   ```

**Acceptance Criteria:**

- [ ] `dist/` and `node_modules/` are git-ignored.
- [ ] `.nvmrc` specifies Node 20.
- [ ] `.editorconfig` enforces consistent formatting across editors.

**Files Created:**

- `.gitignore` (update if exists)
- `.nvmrc`
- `.editorconfig`

---

## Final Directory Tree

After all tasks are complete, the repository should look like this:

```
agent-orchestra/
  .editorconfig
  .gitignore
  .husky/
    pre-commit
  .nvmrc
  .prettierrc
  .prettierignore
  eslint.config.js
  package.json
  pnpm-lock.yaml
  pnpm-workspace.yaml
  tsconfig.base.json
  tsconfig.json
  vitest.config.ts
  docs/                          # (pre-existing)
  test/
    fixtures/
      skills/valid/.gitkeep
      skills/invalid/.gitkeep
      providers/.gitkeep
      jobs/.gitkeep
  packages/
    core/
      package.json
      tsconfig.json
      tsup.config.ts
      src/
        index.ts
        types/
          index.ts
          job.ts
          agent.ts
          finding.ts
          output.ts
          context.ts
          protocol.ts
          orchestrator.ts
          __tests__/
            types.test.ts
        interfaces/
          index.ts
          context-budget-manager.ts
          token-estimator.ts
          output-normalizer.ts
          protocol-runner.ts
          cancellation-registry.ts
        context/
          context-builder.ts
    shared/
      package.json
      tsconfig.json
      tsup.config.ts
      src/
        index.ts
        constants.ts
        errors.ts
  apps/
    cli/
      package.json
      tsconfig.json
      tsup.config.ts
      src/
        index.ts
        program.ts
        commands/
          skills.ts
        __tests__/
          program.test.ts
    server/
      package.json
      tsconfig.json
      src/
        .gitkeep
```

---

## Execution Order

Tasks can be parallelized where noted. Recommended execution:

| Day | Tasks | Notes |
|-----|-------|-------|
| 1 | 0.1, 0.2, 0.11 | Monorepo skeleton + TS config + root configs |
| 2 | 0.3, 0.4 | All type stubs and interface stubs |
| 3 | 0.5, 0.10 | CLI shell + shared package |
| 4 | 0.7, 0.8 | Build tooling + linting |
| 5 | 0.6, 0.9 | Test framework + git hooks + final verification |

---

## Handoff to Phase A

When Phase 0 is complete, the Phase A (M1 — Prompt Skills) developer can immediately:

1. Add skill types to `packages/core/src/types/` alongside the existing stubs.
2. Implement `ContextBuilder.buildFor()` with skill injection logic.
3. Add real `skills list` / `skills inspect` / `skills validate` implementations to `apps/cli/src/commands/skills.ts`.
4. Write tests against the vitest setup using `test/fixtures/skills/`.
5. Import any spec type from `@agent-orchestra/core` without waiting for infrastructure work.

No bootstrap blockers remain after Phase 0.
