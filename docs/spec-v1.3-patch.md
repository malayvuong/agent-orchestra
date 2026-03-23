# Agent Orchestra — Spec Patch v1.3

> Resolves conflicts between spec-v1.1.md and spec-v1.2-dev-ready.md. Defines missing core types, makes Orchestrator protocol-driven, adds error/cancel strategy, separates MVP from future scope, and finalizes desktop/web structure.

---

## 1. Document Authority

### 1.1 Canonical Status

**This file (`spec-v1.3-patch.md`) is the single canonical spec.** All types, interfaces, flows, and architectural decisions defined here take precedence.

### 1.2 Prior Documents

| File | Status |
|------|--------|
| `spec-v1.1.md` | **Historical reference only.** Useful for understanding original topology/lens design rationale. Do not implement from. |
| `spec-v1.2-dev-ready.md` | **Historical reference only.** Useful for seeing early architecture sketches. Do not implement from. |
| `spec-v1.3-patch.md` | **Canonical.** All new implementation must follow this document. |

### 1.3 Hard Rules

- Any type/interface/flow not in v1.3 does not exist
- If v1.1 or v1.2 conflicts with v1.3, v1.3 wins — no exceptions
- New additions must be patched into v1.3, not into v1.1 or v1.2
- When referencing spec in code comments or PRs, cite v1.3 section numbers

---

## 2. Patch Objectives

This patch addresses:

- Unified output pipeline between provider raw output and normalized output
- Complete core type definitions (previously missing)
- Protocol-driven Orchestrator (replacing hardcoded linear flow)
- Explicit job-level state
- Cancel / error / partial-failure strategy
- Finalized module structure: CLI-first with web dashboard and optional desktop wrapper
- Clear MVP vs. future scope separation

---

## 3. Product Architecture (Finalized)

### 3.1 Product Direction

v1 is built as:

- **CLI-first** — primary interface for developers
- **Web dashboard** — served by the Node server for timeline visualization and decision UX
- **Desktop wrapper (optional, future)** — Electron/Tauri if OS integrations are needed later
- Orchestration engine is a Node.js service

### 2.2 Module Structure (Canonical)

```
agent-orchestra/
  apps/
    cli/              # CLI application (primary interface)
    server/           # Node orchestration server + web dashboard
  packages/
    core/
    providers/
    registry/
    shared/
```

### 3.3 Resolving Prior Mismatch

Prior documents referencing `apps/desktop/` or `apps/web/` as separate entries are superseded. From this patch forward:

- `apps/cli/` is the primary interface
- `apps/server/` hosts both the orchestration server and the web dashboard
- `apps/desktop/` does not exist in Phase 1 — see section 25for rationale

---

## 4. Core Type System (Canonical)

All engines, providers, and UI reference these types. This section is the single source of truth.

### 4.1 JobStatus

```ts
export type JobStatus =
  | 'draft'
  | 'queued'
  | 'running'
  | 'awaiting_decision'
  | 'completed'
  | 'cancelled'
  | 'failed'
```

`awaiting_decision` is a **job-level** state, not a round-level state.

### 4.2 JobMode

```ts
export type JobMode =
  | 'plan'
  | 'code_review'
  | 'execution_review'
```

### 4.3 AgentRole

```ts
export type AgentRole =
  | 'architect'
  | 'reviewer'
  | 'builder'
```

### 4.4 AgentLens

```ts
export type AgentLens =
  | 'logic'
  | 'consistency'
  | 'regression'
  | 'testing'
  | 'performance'
  | 'security'
  | 'cross_system_contract'
  | 'scope'
  | 'dependency'
  | 'sequencing'
  | 'simplification'
  | 'risk'
  | 'implementation_readiness'
```

### 4.5 JobScope

```ts
export type ReferenceDepth =
  | 'same_file'
  | 'same_folder'
  | 'same_module'
  | 'repo'

export type OutOfScopeHandling =
  | 'ignore'
  | 'note'
  | 'follow_up'

export type JobScope = {
  primaryTargets: string[]
  excludedTargets: string[]
  referencePolicy: {
    enabled: boolean
    depth: ReferenceDepth
  }
  outOfScopeHandling: OutOfScopeHandling
  allowDebateExpansion: false
}
```

### 4.6 DecisionLog

```ts
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

Each entry carries a timestamp and source. This avoids a future migration from plain strings.

### 4.7 Finding

The central type of the entire system. Every engine touches it.

```ts
export type FindingScopeType =
  | 'primary'
  | 'reference'
  | 'out_of_scope'

export type FindingActionability =
  | 'must_fix_now'
  | 'note_only'
  | 'follow_up_candidate'

export type FindingConfidence =
  | 'high'
  | 'medium'
  | 'low'

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

### 4.8 AgentConfig (Registry-level)

Reusable configuration stored in the agent registry.

```ts
export type AgentConnectionType =
  | 'api'
  | 'cli'
  | 'bridge'

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
```

### 4.9 AgentAssignment (Job-level)

A frozen snapshot of `AgentConfig` assigned to a specific job.

```ts
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

**Relationship between AgentConfig and AgentAssignment:**

- `AgentConfig` lives in the registry (persistent, editable)
- `AgentAssignment` lives in the job (frozen at job creation time)
- When user selects an agent for a job, the system copies the config and freezes it as an `AgentAssignment`
- The job is not affected if the registry config changes later

This relationship was implicit in v1.1/v1.2 — this patch makes it explicit.

### 4.10 AgentOutput

The canonical normalized output that all downstream engines consume.

```ts
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
```

### 4.11 ProviderOutput

Raw output from a provider adapter. Not consumed directly by engines — must be normalized first.

```ts
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
```

**Canonical pipeline:**

```
Provider call
→ ProviderOutput
→ OutputNormalizer.normalize()
→ AgentOutput
→ Scope Guard / Clustering / Synthesis / UI
```

This patch officially resolves the prior conflict between `NormalizedAgentOutput` and `ProviderOutput`:

- The name `NormalizedAgentOutput` is **retired**
- The single canonical name is: **`AgentOutput`**

### 4.12 FindingCluster

```ts
export type FindingClusterStatus =
  | 'confirmed'
  | 'disputed'
  | 'needs_decision'

export type FindingCluster = {
  id: string
  theme: string
  scopeType: FindingScopeType
  linkedFindings: Array<{
    agentId: string
    findingId: string
    findingTitle: string
  }>
  status: FindingClusterStatus
}
```

### 4.13 RoundState

```ts
export type RoundState =
  | 'analysis'
  | 'review'          // single reviewer (single_challenger)
  | 'review_wave'     // multiple reviewers in parallel
  | 'build'           // builder execution (builder_plus_reviewer)
  | 'cluster'
  | 'rebuttal'
  | 'final_check'
  | 'convergence'
```

`review` is used by `single_challenger` (1v1). `review_wave` is used by multi-reviewer protocols. `build` is used by `builder_plus_reviewer`. `user_decision` does NOT belong in `RoundState` — it maps to `JobStatus = 'awaiting_decision'`.

### 4.14 Round

```ts
export type Round = {
  id: string
  jobId: string
  index: number
  state: RoundState

  architectOutput?: AgentOutput   // undefined in non-architect rounds (e.g. build)
  reviewerOutputs: Array<{        // always present, may be [] in non-review rounds
    agentId: string
    output: AgentOutput
  }>
  builderOutput?: AgentOutput     // only in build rounds

  clusterOutput?: FindingCluster[]
  summary?: string
  createdAt: string
}
```

**Rules:**

- `reviewerOutputs` always exists as a field, but may be `[]` in non-review rounds (analysis, build, convergence)
- `architectOutput` is `undefined` in rounds where the Architect is not invoked
- `builderOutput` is only populated in `build` state rounds

### 4.15 AwaitingDecisionReason

```ts
export type AwaitingDecisionReason =
  | 'final_review'          // job completed all rounds, ready for user decision
  | 'pause_point'           // mid-run pause point hit
  | 'manual_intervention'   // system requested user input
```

This disambiguates the `awaiting_decision` JobStatus. Without it, UI and resume logic cannot distinguish "job finished, review results" from "job paused mid-run."

### 4.16 JobRuntimeConfig

```ts
export type SynthesisConfig = {
  provider: 'architect_provider' | 'dedicated'
  dedicatedProviderKey?: string
  rerunnable: boolean
}

export type JobRuntimeConfig = {
  maxConcurrentAgents: number     // default: 3 (not used in 1A since single_challenger has 1 reviewer)
  pausePointsEnabled: boolean     // default: false
  synthesisConfig: SynthesisConfig // default: { provider: 'architect_provider', rerunnable: true }
}
```

Runtime configuration that affects how the job executes. Separated from Job metadata to prevent the Job type from growing unbounded with every new runtime knob.

**Phase 1 defaults:**

| Field | Default | Notes |
|-------|---------|-------|
| `maxConcurrentAgents` | 3 | Not exercised in 1A (single reviewer only) |
| `pausePointsEnabled` | false | Interface exists, disabled by default |
| `synthesisConfig.provider` | `'architect_provider'` | `'dedicated'` is future |
| `synthesisConfig.rerunnable` | true | Always on in Phase 1 |

### 4.17 Job

```ts
export type Job = {
  id: string
  title: string
  mode: JobMode
  brief: string

  status: JobStatus
  protocol: Protocol

  scope: JobScope
  decisionLog: DecisionLog

  agents: AgentAssignment[]

  currentRoundIndex: number
  maxRounds: number

  templateVersions: Record<string, number>  // frozen at job creation
  runtimeConfig: JobRuntimeConfig

  awaitingDecisionReason?: AwaitingDecisionReason  // set when status = 'awaiting_decision'

  createdAt: string
  updatedAt: string

  failurePolicy?: FailurePolicy
}
```

**All fields that were previously "Added to Job type" in later sections are now consolidated here.** This is the single canonical Job definition. No other section may add fields to Job implicitly.

---

## 5. Protocol System (Canonical)

### 5.1 Protocol Type

```ts
export type Protocol =
  | 'single_challenger'
  | 'reviewer_wave'
  | 'reviewer_wave_with_final_check'
  | 'builder_plus_reviewer'
```

This patch restores `builder_plus_reviewer` which was missing from v1.2.

### 5.2 ProviderInput

```ts
export type ProviderInput = {
  prompt: string
  role: AgentRole
  context: AgentContext
}
```

`role` now uses the shared `AgentRole` type — no longer hardcoded to `'architect' | 'reviewer'`.

**Distinction between `ProviderInput.role` and `PromptTemplate.role`:**

- `ProviderInput.role` is the **runtime invocation role** — which agent is making this call. Always `AgentRole` (`'architect' | 'reviewer' | 'builder'`).
- `PromptTemplate.role` is the **template classification role** — which type of template is being used. Uses `PromptTemplateRole` (`AgentRole | 'system'`).

For synthesis: the call is made with `ProviderInput.role = 'architect'` (because the Architect's provider runs it), but using a template with `PromptTemplate.role = 'system'`. These are related but not identical.

---

## 6. Context System (Canonical)

### 6.1 AgentContext

```ts
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

---

## 7. Output Normalization Layer

This pipeline was missing from prior specs.

### 7.1 Canonical Flow

```
ProviderAdapter.run()
→ ProviderOutput
→ OutputNormalizer.normalize()
→ NormalizationResult
    ├── if malformed → retry per FailurePolicy (section 30)
    └── if ok → result.output (AgentOutput)
→ ScopeGuard.validate()
→ ClusteringEngine.cluster()
→ SynthesisEngine.synthesize()
```

### 7.2 OutputNormalizer Responsibility

- Map raw provider output to canonical schema
- Parse sections from raw text
- Parse findings from structured or raw output
- Attach usage/warnings
- Fallback handling if provider returns unstructured output

### 7.3 Interface

```ts
export type NormalizationResult = {
  output: AgentOutput
  warnings: string[]        // non-fatal issues encountered during parsing
  malformed: boolean        // true if output could not be parsed at all
  malformedReason?: string  // human-readable explanation
}

export interface OutputNormalizer {
  normalize(providerOutput: ProviderOutput, meta: {
    agentId: string
    role: AgentRole
    templateVersion: number
  }): NormalizationResult
}
```

The caller checks `result.malformed` and decides whether to retry or apply failure policy. See section 39 for the warning vs. malformed classification rules.

---

## 8. Protocol-Driven Orchestrator

The v1.2 Orchestrator hardcoded a linear flow. This patch replaces it with a protocol-driven design.

### 8.1 ProtocolRunner Interface

```ts
export interface ProtocolRunner {
  execute(job: Job, deps: ProtocolExecutionDeps): Promise<void>
}
```

Each protocol implements this interface. The `ProtocolRunner` decides the step sequence.

### 8.2 ProtocolExecutionDeps

```ts
export type ProtocolExecutionDeps = {
  providerExecutor: ProviderExecutor
  contextBuilder: ContextBuilder
  outputNormalizer: OutputNormalizer
  scopeGuard: ScopeGuard
  clusteringEngine: ClusteringEngine
  synthesisEngine: SynthesisEngine
  roundStore: RoundStore
  jobStore: JobStore
  eventBus: EventBus
  cancellationRegistry: CancellationRegistry
}
```

### 8.3 Orchestrator (New)

```ts
class Orchestrator {
  constructor(
    private protocolRegistry: ProtocolRegistry,
    private deps: ProtocolExecutionDeps
  ) {}

  async runJob(jobId: string) {
    const job = await this.deps.jobStore.load(jobId)
    const runner = this.protocolRegistry.get(job.protocol)

    await this.deps.jobStore.updateStatus(job.id, 'running')

    try {
      await runner.execute(job, this.deps)
      await this.deps.jobStore.updateStatus(job.id, 'awaiting_decision')
    } catch (error) {
      if (this.deps.cancellationRegistry.isCancelled(job.id)) {
        await this.deps.jobStore.updateStatus(job.id, 'cancelled')
      } else {
        await this.deps.jobStore.updateStatus(job.id, 'failed')
      }
      throw error
    }
  }
}
```

### 8.4 Protocol Step Sequences

#### `single_challenger`

1. analysis
2. review
3. rebuttal
4. convergence

#### `reviewer_wave`

1. analysis
2. review_wave
3. cluster
4. rebuttal
5. convergence

#### `reviewer_wave_with_final_check`

1. analysis
2. review_wave
3. cluster
4. rebuttal
5. final_check
6. convergence

#### `builder_plus_reviewer`

1. build
2. review
3. rebuttal or fix summary
4. convergence

---

## 9. Cancellation / Error / Retry Strategy

This section was almost entirely missing from prior specs.

### 9.1 Cancellation Model

- Each provider run registers a cancel handle
- `job:cancel` marks the job as cancelled
- Orchestrator does not start new steps after cancellation
- If a provider is currently running:
  - **API call:** abort via `AbortController`
  - **CLI process:** kill process tree
  - **Bridge request:** abort if bridge supports it; otherwise mark cancelled and ignore late result

**Phase scope:** The core cancellation interfaces (`CancellationRegistry`, `CancelHandle`, `AbortController` integration) are implemented in Phase 1A as part of the engine internals. However, **user-facing cancellation** (CLI `cancel` command, socket `job:cancel` event, UI cancel button) is deferred to Phase 1B. In Phase 1A, the only cancellation mechanism is process exit (Ctrl+C).

### 9.2 CancellationRegistry

```ts
export interface CancellationRegistry {
  register(jobId: string, agentId: string, handle: CancelHandle): void
  cancelJob(jobId: string): Promise<void>
  isCancelled(jobId: string): boolean
}

export interface CancelHandle {
  cancel(): Promise<void>
}
```

### 9.3 FailurePolicy

```ts
export type FailurePolicy = {
  reviewerFailure: 'continue_with_partial_results' | 'fail_job'
  architectFailure: 'fail_job'
  builderFailure: 'fail_job'
  maxRetriesPerAgent: number
  agentTimeoutMsDefault: number
}
```

**Default v1 policy:**

| Agent | On Failure |
|-------|-----------|
| Reviewer | `continue_with_partial_results` |
| Architect | `fail_job` |
| Builder | `fail_job` |

**Rationale:**

- Losing Reviewer B is recoverable — synthesize with partial results
- Losing Architect breaks the flow entirely
- Losing Builder means nothing to review

### 9.4 Retry Strategy

- Retry up to `AgentConfig.retryCount` times
- Only retry on **transient** errors:
  - Timeout
  - Rate limit (HTTP 429)
  - Temporary connection failure
- Do NOT retry on:
  - Invalid config
  - Repeated malformed output exceeding threshold
  - Explicit cancellation

### 9.5 Exponential Backoff

All retries must use exponential backoff with jitter. This is critical for rate limit (429) errors — immediate retry will fail again and may escalate throttling.

```ts
function getRetryDelayMs(attempt: number): number {
  const baseMs = 1000
  const maxMs = 30000
  const exponential = Math.min(baseMs * Math.pow(2, attempt), maxMs)
  const jitter = exponential * (0.5 + Math.random() * 0.5)
  return Math.round(jitter)
}
// attempt 0: ~1s, attempt 1: ~2s, attempt 2: ~4s, attempt 3: ~8s, max: ~30s
```

**Rules:**

- Rate limit errors (429): always backoff, respect `Retry-After` header if present
- Timeout errors: backoff with shorter ceiling (max 10s)
- Connection failures: backoff with standard ceiling (max 30s)

---

## 10. CLI Provider (Corrected)

The v1.2 example was too minimal. This section defines the actual behavior contract.

### 10.1 CLI Adapter Requirements

- Timeout enforcement
- stderr capture
- Exit code check
- Retry support
- Working directory support
- Environment variable injection
- Cancellation support (kill process tree)

### 10.2 Error Contract

If any of the following occur:

- `exitCode !== 0`
- Timeout exceeded
- Malformed stdout

the CLI adapter MUST return a structured error. Silent failures are not acceptable.

---

## 11. Storage Layout (Complete)

Prior specs only covered `.jobs/`. This patch adds registry and settings storage.

### 11.1 MVP File-based Storage

```
.agent-orchestra/
  config/
    settings.json       # Global settings
    providers.json      # Provider registry + non-secret config
    agents.json         # Agent registry
  jobs/
    job-001/
      job.json          # Job config and metadata
      scope.json        # Scope definition
      decision-log.json # Decision log
      agents.json       # Agent assignments (frozen snapshots)
      rounds/
        round-1.json    # Round data with agent outputs
        round-2.json
      clusters.json     # Clustered findings
      synthesis.json    # Final synthesis output
      events.log        # Event log for debugging
```

### 11.2 Credentials

Secrets are NOT stored in `providers.json` as plaintext. v1 approach:

- Use environment variables
- OS keychain integration in future versions
- Config only stores `envRef` or `secretRef` pointers

---

## 12. Realtime Events (Patched)

### 12.1 Server → Client Events (Canonical)

| Event | Description |
|-------|-------------|
| `job:update` | Job state changed |
| `round:start` | A new round began |
| `round:complete` | A round finished |
| `agent:output` | Agent produced a streaming chunk |
| `agent:output:end` | Agent streaming completed |
| `cluster:update` | Clusters updated |
| `synthesis:ready` | Final synthesis available |
| `job:cancelled` | Job was cancelled |
| `error` | Error occurred |

**`agent:output:end` is mandatory.** The UI needs it to:

- Know agent streaming is complete
- Render final state
- Stop loading indicators

---

## 13. MVP Scope (Separated Clearly)

### 13.1 MVP Providers (Overall Phase 1)

> **For Phase 1A/1B breakdown, see section 42 (canonical).** This section shows the overall Phase 1 target.

#### Phase 1A

| Provider | Type |
|----------|------|
| `openai-compatible` | API (covers OpenAI, Azure, local proxies) |
| `claude-cli` | CLI |

#### Phase 1B additions

| Provider | Type |
|----------|------|
| `anthropic` | API (native, for non-OpenAI-compatible features) |
| `google` | API (Gemini) |
| `local-command` | CLI (generic wrapper) |

#### Bridge

Interface placeholder only — no implementations in Phase 1.

### 13.2 Future Providers

Moved to future phases:

- xAI / Grok
- DeepSeek
- OpenRouter
- Azure OpenAI
- Together
- Fireworks
- Mistral
- Cohere
- Perplexity
- Ollama
- Custom desktop bridges
- MCP bridge
- Webhook bridge
- HTTP agent bridge

### 13.3 Add Agent Form — MVP Fields

**Visible by default:**

| Field | Type |
|-------|------|
| Agent Name | string |
| Role | enum |
| Lens | enum (optional) |
| Connection Type | enum |
| Provider | select |
| Model / Command | string |
| Enabled | boolean |
| Timeout | number |
| Retry Count | number |
| Allow Reference Scan | boolean |
| Can Write Code | boolean |

**Advanced (hidden by default):**

| Field | Type |
|-------|------|
| Protocol Preset override | select |
| Token Budget | number |
| Scope Discipline Level | enum |
| Evidence Strictness | enum |
| Working Directory | string |
| Environment Refs | string[] |
| Command Template | string |
| Notes | text |

---

## 14. Clustering (Patched)

### 14.1 Normalize Strategy (v1)

`normalizeFindingKey()` in v1 performs:

- Lowercase
- Trim
- Collapse whitespace
- Remove basic punctuation

```ts
function normalizeFindingKey(input: string): string
```

No fuzzy matching in v1. Semantic clustering is a future enhancement.

### 14.2 Cluster Linking

Must use the actual `agentId` from reviewer output. Hardcoded `'unknown'` is not acceptable.

### 14.3 Reviewer Prompt Requirement for Clustering

Because clustering v1 relies on title normalization, the **reviewer system prompt must instruct reviewers to write short, concise finding titles**. This is the primary lever for improving clustering accuracy without adding semantic complexity.

Required instruction in every reviewer prompt template:

```
Finding titles must be short (under 10 words), factual, and reusable across reviewers.
Use consistent naming: "Missing null check in X", "Race condition in Y", "Unused import Z".
Do NOT use creative or unique phrasing for titles.
```

Without this, two reviewers finding the same bug will write titles like "Potential crash when input is null" vs "Missing validation causes NPE" — and the normalizer will treat them as separate findings.

---

## 15. Validation Schemas

Prior specs used `Record<string, unknown>` for config and auth schemas — too loose.

**Patch rule:** Provider config and auth schemas must use:

- **Zod** schemas in TypeScript code
- Exportable as **JSON Schema** if needed for UI form generation

---

## 16. Job vs. Round State Distinction

### 16.1 Job-level States

Represent the overall lifecycle of a job:

```
draft → queued → running → awaiting_decision → completed
                    ↓
                 failed
                    ↓
                cancelled
```

### 16.2 Round-level States

Represent technical steps within a running job. The sequence depends on the protocol:

**`single_challenger`:**
```
analysis → review → rebuttal → convergence
```

**`reviewer_wave`:**
```
analysis → review_wave → cluster → rebuttal → convergence
```

**`reviewer_wave_with_final_check`:**
```
analysis → review_wave → cluster → rebuttal → final_check → convergence
```

**`builder_plus_reviewer`:**
```
build → review → rebuttal → convergence
```

See section 4.13 for the full `RoundState` type. `user_decision` is NOT a round state — it maps to `JobStatus = 'awaiting_decision'`.

---

## 17. MVP Roadmap (Superseded)

> **This section is superseded by section 34** See section 28for the final Phase 1 scope incorporating all addendum changes.

---

## 18. Synthesis Engine (Previously Underspecified)

Synthesis is the primary user-facing output — the thing the user actually reads and acts on. Prior specs defined a `Synthesis` type but not how synthesis works.

### 18.1 How Synthesis Works

Synthesis is an **LLM call**, not a template. It runs through the Architect's provider by default (since the Architect has the most context about the original analysis).

```ts
export type SynthesisConfig = {
  provider: 'architect_provider' | 'dedicated'
  dedicatedProviderKey?: string
  rerunnable: boolean
}
```

### 18.2 Synthesis Input

The synthesis prompt receives:

- Original brief and scope
- All clustered findings with status (`confirmed`, `disputed`, `needs_decision`)
- Architect rebuttal summary
- Decision log

It does NOT receive raw reviewer outputs — only clustered, deduplicated findings.

### 18.3 Synthesis Output

```ts
export type Synthesis = {
  confirmed: FindingCluster[]
  disputed: FindingCluster[]
  followUps: Finding[]
  recommendation: string
  generatedAt: string
  providerUsed: string
}
```

### 18.4 Re-runnable Synthesis

Synthesis can be re-run independently without re-running the full review cycle. Use cases:

- User wants a different synthesis tone or detail level
- User changed their mind on a disputed finding and wants synthesis updated
- Provider produced a poor synthesis and user wants to retry

The system preserves the previous synthesis as `synthesis-v{n}.json` before overwriting.

---

## 19. Reviewer Parallelism

### 19.1 Decision

**Parallel by default in v1.** All reviewers in a wave are invoked concurrently.

### 19.2 Rationale

- Faster wall-clock time
- Simpler implementation (no inter-reviewer dependency)
- Clustering engine handles dedup afterward — no need for reviewers to be aware of each other
- Sequential review (where each reviewer sees prior reviewer output) is a future optimization

### 19.3 Implementation

```ts
// Inside reviewer_wave protocol runner
async function runReviewWave(job: Job, deps: ProtocolExecutionDeps) {
  const reviewers = job.agents.filter(a => a.role === 'reviewer' && a.enabled)

  const results = await Promise.allSettled(
    reviewers.map(reviewer =>
      deps.providerExecutor.run(reviewer, deps.contextBuilder.buildFor(reviewer, job))
    )
  )

  // Handle partial results per FailurePolicy
  // ...
}
```

`Promise.allSettled` (not `Promise.all`) ensures partial results are captured even if some reviewers fail.

---

## 20. Context Budget Management

### 20.1 Problem

Context grows unboundedly as rounds accumulate: previous outputs, clusters, evidence packets, decision log. Different providers have different context limits (4k to 200k+). Without management, prompts will exceed limits and fail silently or get truncated.

### 20.2 ContextBudgetManager

```ts
export interface ContextBudgetManager {
  fitToLimit(
    context: AgentContext,
    tokenLimit: number
  ): AgentContext
}
```

### 20.3 Priority Order

When context must be trimmed, items are dropped in this order (lowest priority first):

| Priority | Content | Action when trimmed |
|----------|---------|-------------------|
| 1 (highest) | Brief + scope + protocol | Never trimmed |
| 2 | Current round data | Never trimmed |
| 3 | Decision log | Trimmed to last N entries |
| 4 | Clusters | Trimmed to unresolved only |
| 5 | Previous round summary | Summarized further |
| 6 | Evidence packets | Reduce excerpt length, then drop reference-only packets |
| 7 (lowest) | Full previous round outputs | Replaced with summary |

### 20.4 Provider Profile Integration

`ProviderProfile.contextTolerance` determines how aggressively to trim:

- `high`: fit to 80% of limit (leave headroom for response)
- `medium`: fit to 60%
- `low`: fit to 40%

### 20.5 Token Estimation

**Phase 1A must use `tiktoken` (or equivalent) for token estimation.** The naive `length / 4` formula is not acceptable — it silently underestimates for Vietnamese, code, and mixed content, causing context truncation at the provider level. When context is truncated, the agent receives incomplete information and produces unreliable output with no visible error.

```ts
export interface TokenEstimator {
  estimate(text: string): number
}
```

Each provider adapter must supply a `TokenEstimator` matched to its model's tokenizer:

- `openai-compatible`: use `tiktoken` with the appropriate encoding (e.g., `cl100k_base` for GPT-4o)
- `claude-cli`: use Anthropic's token counting (approximate with `tiktoken` `cl100k_base` as fallback)

**Fallback only:** If a provider has no known tokenizer, use the conservative formula `Math.ceil(text.length / 3)` (not `/4`) and log a warning. This over-estimates rather than under-estimates, which is the safer failure mode (context gets trimmed more aggressively, but nothing is silently dropped by the provider).

```ts
// Conservative fallback — over-estimates intentionally
function fallbackEstimateTokens(text: string): number {
  return Math.ceil(text.length / 3)
}
```

---

## 21. Mid-run User Intervention

### 21.1 Problem

The state machine is one-directional. Users cannot adjust scope, add context, or skip steps mid-run. This makes the system feel rigid.

### 21.2 Pause Points

Protocols can define optional pause points between steps. When a pause point is reached, the job transitions to `awaiting_decision` temporarily.

```ts
export type ProtocolStepConfig = {
  step: RoundState
  pauseAfter: boolean
}
```

### 21.3 User Actions at Pause Points

| Action | Effect |
|--------|--------|
| Continue | Resume next step |
| Adjust scope | Update `JobScope`, re-run from current step |
| Add context | Append to evidence packets, continue |
| Skip to synthesis | Jump to convergence step |
| Cancel | Cancel job |

### 21.4 Default Behavior

By default, no pause points are enabled — the protocol runs to completion and pauses at `awaiting_decision` at the end. Users can enable pause points per-protocol in job setup.

### 21.5 Socket Events for Pause

```ts
// Server → Client
'job:paused'       // Job hit a pause point, awaiting user action

// Client → Server
'job:resume'       // User chose to continue
'job:adjust_scope' // User adjusted scope mid-run
'job:skip_to_synthesis' // User wants to skip remaining steps
```

---

## 22. Prompt Templates

### 22.1 Problem

Prompts are the most important part of this system. Without defined templates, every provider will produce wildly different output structures and the `OutputNormalizer` will fail to parse reliably.

### 22.2 PromptTemplate Type

```ts
// Separate from AgentRole because 'system' is not an agent runtime role
export type PromptTemplateRole = AgentRole | 'system'

export type PromptTemplate = {
  id: string
  role: PromptTemplateRole
  lens?: AgentLens
  systemPrompt: string
  userPromptTemplate: string
  outputFormatInstructions: string
  fewShotExamples?: string[]
}
```

`PromptTemplateRole` extends `AgentRole` with `'system'` for templates like synthesis that are not tied to an agent runtime. `'system'` is NOT added to `AgentRole` itself — it is only valid in the template context.

### 22.3 Required Templates (Phase 1)

| Template | Role | Purpose |
|----------|------|---------|
| `architect-analysis` | architect | Initial analysis of the target |
| `reviewer-by-lens` | reviewer | Review with lens-specific focus (parameterized) |
| `architect-rebuttal` | architect | Respond to clustered findings |
| `synthesis` | system | Produce final consolidated output |

### 22.4 Output Format Instructions

Every prompt MUST include structured output format instructions so the normalizer can parse reliably. Minimum required structure:

```
## Findings

### Finding 1
- **Title:** ...
- **Scope:** primary | reference | out_of_scope
- **Actionability:** must_fix_now | note_only | follow_up_candidate
- **Confidence:** high | medium | low
- **Evidence:** ...
- **Description:** ...
```

Providers that support JSON mode should use it. For providers without JSON mode, the normalizer parses the markdown structure above.

### 22.5 Prompt Template Storage

Templates use versioned directories (see section 29.5 for versioning rules):

```
.agent-orchestra/
  config/
    prompts/
      architect-analysis/
        v1.md
      reviewer-by-lens/
        v1.md
      architect-rebuttal/
        v1.md
      synthesis/
        v1.md
```

Users can customize templates. The system ships with defaults. When updating a template, create a new version file (`v2.md`) alongside the existing one — never overwrite.

---

## 23. Provider-Aware Output Normalization

### 23.1 Problem

A single `normalize()` method cannot handle the vastly different output formats across providers. GPT-4o with JSON mode returns structured data. Ollama returns freeform text. Claude returns markdown.

### 23.2 Two-Stage Normalization

```
Stage 1: Provider adapter parses raw response → ProviderOutput
         (provider-specific parsing lives here)

Stage 2: OutputNormalizer maps ProviderOutput → AgentOutput
         (canonical, provider-agnostic)
```

Each provider adapter is responsible for its own response parsing in Stage 1. The `OutputNormalizer` only handles the `ProviderOutput → AgentOutput` mapping.

### 23.3 Provider Adapter Contract

```ts
interface AgentProvider {
  run(input: ProviderInput): Promise<ProviderOutput>
  // Each provider handles its own response format internally
  // and returns a consistent ProviderOutput
}
```

### 23.4 Normalizer Strategies

The `OutputNormalizer` uses strategies based on what the `ProviderOutput` contains:

| Condition | Strategy | Phase |
|-----------|----------|-------|
| `structuredSections` present with findings | Direct mapping | 1A |
| `rawText` only, markdown-formatted | Markdown parser extracts findings | 1A |
| `rawText` only, unstructured | **Malformed** — triggers retry/failure policy | 1A |
| `rawText` only, unstructured | LLM-assisted extraction | Future only |

**Phase 1 rule (hard):** If output cannot be parsed by direct mapping or markdown parser, it is malformed (section 30). There is no LLM-assisted fallback in Phase 1. Prompt templates with output format instructions (section 22.4) are the primary mechanism to ensure parseable output.
---

## 24. Awaiting Decision UX

### 24.1 What the User Sees

When a job reaches `awaiting_decision`:

1. **Synthesis panel** — the primary view, showing confirmed/disputed/follow-up findings
2. **Expandable timeline** — full round history for reference
3. **Action bar** — available decisions

### 24.2 User Actions

| Action | Effect | Updates |
|--------|--------|---------|
| Accept all | Mark job completed | `JobStatus → completed` |
| Accept with notes | Mark completed, add notes to decision log | `JobStatus → completed`, `DecisionLog` updated |
| Reject and re-run | Re-run from analysis with updated brief/scope | New job created (linked to original) |
| Re-run synthesis only | Re-generate synthesis with same data | `synthesis.json` versioned and regenerated |
| Create follow-up job | Create new job from follow-up findings | New job with pre-populated scope |

### 24.3 Decision Recording

All user decisions at this stage are recorded in `DecisionLog` using `DecisionEntry` (section 4.6):

```ts
// After user accepts
decisionLog.acceptedDecisions.push({
  message: `Accepted synthesis. Notes: ${userNotes}`,
  createdAt: timestamp,
  source: 'user'
})
```

---

## 25. Product Direction: CLI-first, Web-second, Desktop-optional

### 25.1 Revised Direction

The original spec committed to desktop-first (Electron). After review, the recommended approach is:

**CLI-first → Web dashboard → Desktop wrapper (optional)**

### 25.2 Rationale

- Target users are developers — they live in terminals and browsers
- Electron adds significant complexity: IPC layer, build pipeline, packaging, updates, RAM overhead
- The CLI is already specified and is the fastest path to a working product
- A web dashboard served by the Node server works on any platform without Electron
- Desktop can be added later via Electron/Tauri wrapping the web app if needed

### 25.3 Updated Module Structure

```
agent-orchestra/
  apps/
    cli/              # CLI application (primary interface)
    server/           # Node orchestration server + web dashboard
  packages/
    core/
    providers/
    registry/
    shared/
```

`apps/desktop/` is removed from Phase 1. It can be added in a future phase if there's a real need (OS integrations, tray icon, offline support).

### 25.4 Phase 1 UI Strategy

- CLI for job creation, agent management, and job execution
- Server serves a lightweight web dashboard for timeline visualization and `awaiting_decision` UX
- No Electron in Phase 1

---

## 26. Bridge Provider (Scoped Down)

The provider interface supports future bridge adapters for external tools. Bridge is NOT implemented in Phase 1.

The `AgentConnectionType` still includes `'bridge'` in the type system so the data model is forward-compatible, but no bridge provider implementations ship until there is a concrete integration target.

All bridge-related registry entries (`mcp-bridge`, `webhook-bridge`, `http-agent-bridge`, `desktop-app-bridge`, `custom-bridge`) are removed from the default registry and will be added when their implementations exist.

---

## 27. Testing Strategy

### 27.1 MockProvider

```ts
class MockProvider implements AgentProvider {
  constructor(private fixedOutput: ProviderOutput) {}

  async run(input: ProviderInput): Promise<ProviderOutput> {
    return this.fixedOutput
  }
}
```

Used to test Orchestrator, protocol runners, normalizer, and clustering without hitting real APIs.

### 27.2 Test Categories

| Category | What to test | How |
|----------|-------------|-----|
| Protocol runners | Step sequence, state transitions | MockProvider + in-memory stores |
| OutputNormalizer | Parsing various formats | Fixture-based: save real provider responses as JSON fixtures |
| Clustering | Grouping, dedup, edge cases | Unit tests with known finding sets |
| Scope Guard | Drift detection, tagging enforcement | Unit tests with in-scope and out-of-scope findings |
| Context Budget | Trimming priority, token estimation | Unit tests with oversized contexts |
| CLI Provider | Timeout, exit codes, stderr | Spawn mock scripts that simulate success/failure/timeout |
| **CLI Provider hang (P0)** | **Process hang, zombie processes, event loop blocking** | **Mock script that sleeps indefinitely — verify timeout kills process tree and Orchestrator recovers. Must pass on macOS, Linux, and Windows. This is a Priority 0 test — if this fails, nothing else matters.** |
| API Provider | Auth, error codes, streaming | Mock HTTP server or nock/msw |
| End-to-end | Full job run with mock providers | Integration test: create job → run → verify synthesis output |

### 27.3 Fixture Directory

```
tests/
  fixtures/
    provider-outputs/
      openai-structured.json
      anthropic-markdown.json
      cli-raw-text.txt
    findings/
      mixed-scope.json
      duplicate-titles.json
    contexts/
      oversized-context.json
```

---

---

## 28. Forward-Compatible Types (Not Implemented in Phase 1)

Types retained in the type system for forward compatibility but with NO implementation in Phase 1.

### 28.1 `builder_plus_reviewer` Protocol

- The `Protocol` union type includes `'builder_plus_reviewer'`
- The `AgentRole` union type includes `'builder'`
- **No `ProtocolRunner` implementation exists for this protocol in Phase 1**
- Do NOT scaffold a partial runner. Leave it as a type-only placeholder.

### 28.2 `bridge` Connection Type

- The `AgentConnectionType` union type includes `'bridge'`
- **No bridge provider implementations exist in Phase 1**
- The bridge abstraction, registry entries, and strategy from v1.1 are moved to Appendix A (future reference only)
- Do NOT scaffold bridge adapters, bridge registry entries, or bridge-related UI

### 28.3 Rule

If a type exists in the union but has no implementation, attempting to use it at runtime must produce a clear error: `"Protocol 'builder_plus_reviewer' is not implemented in this version"` — not a silent failure or missing handler.

---

## 29. Versioned Prompt Templates

### 29.1 Problem

Prompt changes easily break the output parser. If a template's output format changes, the normalizer must know which format to expect. Jobs created with template v1 must remain parseable even after template v2 ships.

### 29.2 Versioning Rule

This section extends the canonical `PromptTemplate` defined in section 22.2 by adding `version`. The full canonical definition is:

```ts
export type PromptTemplate = {
  id: string
  version: number            // template version (starts at 1)
  role: PromptTemplateRole   // from section 22.2: AgentRole | 'system'
  lens?: AgentLens
  systemPrompt: string
  userPromptTemplate: string
  outputFormatInstructions: string
  fewShotExamples?: string[]
}
```

**Note:** `role` is `PromptTemplateRole` (not `AgentRole`). This preserves support for the `synthesis` template which uses `role: 'system'`.

### 29.3 Job Records Template Version

`templateVersions` is already part of the canonical `Job` type in section 4.17. This section documents the contract:

```ts
// Added to Job type
export type Job = {
  // ... existing fields ...
  templateVersions: Record<string, number>
  // e.g. { "architect-analysis": 1, "reviewer-by-lens": 1, "synthesis": 1 }
}
```

### 29.4 Normalizer Uses Template Version

> The canonical `OutputNormalizer` interface is in section 7.3. It includes `templateVersion` in the `meta` parameter and returns `NormalizationResult`.

### 29.5 Template Storage (Updated)

```
.agent-orchestra/
  config/
    prompts/
      architect-analysis/
        v1.md
        v2.md               # Future versions
      reviewer-by-lens/
        v1.md
      architect-rebuttal/
        v1.md
      synthesis/
        v1.md
```

### 29.6 Phase 1 Rule

- All templates start at version 1
- Template versioning infrastructure must exist from day one
- When a template is updated, create v2 alongside v1 — do NOT overwrite

---

## 30. Output Normalization Failure Policy

### 30.1 Problem

Section 23.4 lists LLM-assisted extraction as a fallback. This is expensive and hard to test. Phase 1 needs a clear boundary.

### 30.2 Phase 1 Rule

- **No LLM-assisted extraction fallback in Phase 1**
- If provider output cannot be parsed by direct mapping or markdown parser, it is a **malformed output**
- Malformed output is handled by `FailurePolicy`:
  - Count as a failed attempt
  - Retry up to `retryCount` (provider may produce valid output on retry)
  - If retries exhausted: apply failure policy (reviewer = continue with partial; architect = fail job)

### 30.3 Malformed Output Recording

When output fails normalization, store the raw output for debugging:

```ts
export type MalformedOutputRecord = {
  agentId: string
  jobId: string
  roundIndex: number
  rawText: string
  parseError: string
  timestamp: string
}
```

Stored at: `.agent-orchestra/jobs/{jobId}/malformed/{agentId}-{roundIndex}.json`

---

## 31. Security and Credentials (MVP Rules)

### 31.1 Phase 1 Rules (Hard)

| Rule | Detail |
|------|--------|
| Only env vars for secrets | No custom secret manager in Phase 1 |
| No raw secrets in config files | `providers.json` stores `envRef` keys only |
| No secret input in UI | Web dashboard does NOT have fields for entering API keys |
| Env var resolution at runtime | Provider adapter reads `process.env[envRef]` at call time |

### 31.2 Provider Config Example

```json
{
  "key": "openai",
  "kind": "api",
  "auth": {
    "envRef": "OPENAI_API_KEY"
  }
}
```

The provider adapter does:

```ts
const apiKey = process.env[config.auth.envRef]
if (!apiKey) throw new Error(`Missing env var: ${config.auth.envRef}`)
```

### 31.3 Future (Not Phase 1)

- OS keychain integration
- Encrypted secret storage
- Secret rotation support

---

## 32. Inspectability Contract

Every step of a job run must produce auditable artifacts. This section defines exactly what gets stored.

### 32.1 Per-Round Artifacts

Each round file (`rounds/round-{n}.json`) must contain:

```ts
export type RoundArtifact = {
  id: string
  jobId: string
  index: number
  state: RoundState

  // What was sent to each agent
  prompts: Array<{
    agentId: string
    role: AgentRole
    promptHash: string          // SHA-256 of the full prompt sent
    templateId: string
    templateVersion: number
    contextTokenEstimate: number
  }>

  // What each agent returned
  architectOutput?: AgentOutput
  reviewerOutputs: Array<{
    agentId: string
    output: AgentOutput
  }>
  builderOutput?: AgentOutput     // only in build rounds (forward-compatible)

  // Clustering results (if applicable)
  clusterOutput?: FindingCluster[]

  // Round summary
  summary?: string

  // Timing
  startedAt: string
  completedAt: string
  durationMs: number
}
```

### 32.2 Per-Provider-Call Artifacts

Each provider invocation is logged in the event log:

```ts
export type ProviderCallRecord = {
  timestamp: string
  jobId: string
  roundIndex: number
  agentId: string

  provider: string
  model: string
  connectionType: AgentConnectionType

  // Template (critical for debugging parse failures)
  templateId: string
  templateVersion: number

  // Input
  promptTokenEstimate: number

  // Output
  outputTokenEstimate: number
  rawOutputLength: number
  findingsCount: number
  parseSuccess: boolean
  malformedReason?: string      // set when parseSuccess = false

  // Performance
  latencyMs: number
  retryCount: number

  // Cost
  estimatedCost?: number

  // Errors
  error?: string
  exitCode?: number
}
```

### 32.3 Event Log Format

`events.log` is a newline-delimited JSON (NDJSON) file. Each line is a `ProviderCallRecord` or a state transition event:

```ts
export type StateTransitionEvent = {
  timestamp: string
  jobId: string
  type: 'job_status_change' | 'round_state_change'
  from: string
  to: string
  reason?: string
}
```

### 32.4 Failure Snapshot

When a job fails, store a snapshot at `.agent-orchestra/jobs/{jobId}/failure-snapshot.json`:

```ts
export type FailureSnapshot = {
  jobId: string
  failedAt: string
  lastRoundIndex: number
  lastRoundState: RoundState
  error: string
  stack?: string

  // What was completed before failure
  completedRounds: number[]
  partialRound?: RoundArtifact

  // Agent that caused failure
  failingAgentId?: string
  failingProvider?: string
  retryCount: number
}
```

### 32.5 Synthesis Input Snapshot

Before running synthesis, save the exact input at `.agent-orchestra/jobs/{jobId}/synthesis-input.json`:

```ts
export type SynthesisInputSnapshot = {
  jobId: string
  brief: string
  scope: JobScope
  decisionLog: DecisionLog
  clusters: FindingCluster[]
  rebuttalSummary: string
  templateId: string
  templateVersion: number
  snapshotAt: string
}
```

This enables re-running synthesis with identical input for debugging.

### 32.6 CLI Inspect Contract

`agent-orchestra inspect <job-id>` must support these flags:

| Flag | Output |
|------|--------|
| `--summary` | Synthesis result |
| `--timeline` | Round-by-round summary |
| `--round <n>` | Full round artifact |
| `--events` | Event log |
| `--failure` | Failure snapshot (if failed) |
| `--costs` | Cost breakdown by agent/provider |
| `--prompts` | Prompt hashes and token estimates |

---

## 33. Updated Storage Layout (Final)

Supersedes section 11 with inspectability additions.

```
.agent-orchestra/
  config/
    settings.json
    providers.json
    agents.json
    prompts/
      architect-analysis/
        v1.md
      reviewer-by-lens/
        v1.md
      architect-rebuttal/
        v1.md
      synthesis/
        v1.md
  jobs/
    job-001/
      job.json
      scope.json
      decision-log.json
      agents.json
      rounds/
        round-1.json          # Full RoundArtifact
        round-2.json
      clusters.json
      synthesis.json            # Latest synthesis (always current)
      synthesis-v1.json         # Previous synthesis (created on rerun)
      synthesis-v2.json         # etc.
      synthesis-input.json      # Synthesis input snapshot
      events.log                # NDJSON event log
      malformed/                # Failed parse outputs
        agent-x-round-1.json
      failure-snapshot.json     # Only if job failed
```

---

## 34. Updated Phase 1 Roadmap (Final)

Phase 1 is split into 1A and 1B for incremental shipping and verification.

### Phase 1A — Core Loop (ship first)

- CLI application (primary interface)
- File-based storage with inspectability contract
- OpenAI-compatible API adapter + Claude CLI adapter
- `single_challenger` protocol (2 agents only)
- Output normalization (two-stage, no LLM fallback)
- Versioned prompt templates (v1)
- Basic synthesis (re-runnable)
- `agent-orchestra inspect` CLI command
- Env-var-only credentials
- MockProvider + fixture-based tests (including CLI hang/timeout tests)
- Event log (NDJSON)
- `tiktoken`-based token estimation (accurate for non-English and code)

### Phase 1B — Multi-Agent + Dashboard

- Node orchestration server + lightweight web dashboard
- `reviewer_wave` protocol (parallel reviewers)
- Basic clustering engine
- Context budget management
- Agent Registry CRUD (CLI + web UI)
- Socket.IO realtime with `agent:output:end`
- Basic cancellation / retry
- Awaiting decision UX (web dashboard)
- Additional API adapters: Anthropic, Google
- Scope guard enforcement
- LLM-based finding dedup step before clustering (cheap model like GPT-4o-mini groups finding titles semantically before normalizer runs — addresses the v1 clustering weakness from section 35.2)

### Not in Phase 1

- Electron / desktop wrapper
- `builder_plus_reviewer` protocol (type only, no runner)
- `reviewer_wave_with_final_check` protocol
- Bridge provider implementations (type only, no adapters)
- Advanced clustering (full semantic embeddings — the 1B dedup prompt is the pragmatic middle ground)
- 3+ reviewers per job
- Mid-run pause points (interface ready, disabled by default)
- LLM-assisted output extraction fallback
- Secret vault / keychain integration
- Smart provider scoring / profiles

---

## 35. Implementation Risk Mitigations

Rules to lock down before coding. These address known risks from review.

### 35.1 OutputNormalizer Must Be Deterministic and Pure

```
OutputNormalizer is the highest-risk component in the system.
```

**Hard rules:**

- No AI/LLM-based parsing in Phase 1 — deterministic parsing only
- Normalizer must be a pure function: same input always produces same output
- Log the full raw output on every parse failure (already covered in section 30.3)
- Add `--parser-debug` flag to CLI that dumps normalizer input/output for any job

### 35.2 Clustering v1 Is Best-Effort

Clustering v1 uses title normalization (lowercase, trim, depunct). This is explicitly **not reliable for semantic dedup**.

- False negatives are expected: similar findings with different wording will NOT cluster
- False positives are possible: different findings with similar titles may cluster incorrectly
- This is acceptable for v1 — the user reviews clustered findings before decisions
- Semantic clustering (embeddings-based) is a future enhancement, not a v1 goal

### 35.3 ContextBuilder Must Call ContextBudgetManager

**Hard rule:** `ContextBuilder.buildFor()` must call `ContextBudgetManager.fitToLimit()` before returning any context. This is not optional integration — it is a mandatory step in the pipeline.

```ts
class ContextBuilder {
  buildFor(agent: AgentAssignment, job: Job): AgentContext {
    const raw = this.assembleRawContext(agent, job)
    const tokenLimit = this.getTokenLimit(agent.providerKey)
    return this.budgetManager.fitToLimit(raw, tokenLimit)
  }
}
```

### 35.4 Template Version Frozen at Job Creation

**Hard rule:** Template versions must be resolved and frozen when the job is created, not when a round executes.

```
Job creation:
  1. Resolve latest template versions
  2. Write templateVersions into job.json
  3. All rounds in this job use these frozen versions

This prevents mid-job template changes from causing parser inconsistencies.
```

### 35.5 Provider Adapter Must Stay Thin

Provider adapters are responsible for:

- Making the request (HTTP, spawn, bridge call)
- Basic response extraction (body, stdout, exit code)
- Returning `ProviderOutput`

Provider adapters are NOT responsible for:

- Deep parsing of findings from response text
- Validating output structure
- Retry logic (handled by Orchestrator/ProtocolRunner)

Deep parsing belongs in `OutputNormalizer`. If an adapter starts growing complex parsing logic, it is a design smell — refactor the parsing into the normalizer.

### 35.6 Parallel Reviewer Rate Limiting

When running reviewers in parallel, enforce the concurrency limit from `JobRuntimeConfig` (section 4.16):

```ts
// Access via job.runtimeConfig.maxConcurrentAgents (default: 3)
```

**Rationale:** 4+ parallel API calls to the same provider can trigger rate limits, spike costs, and cause cascading timeouts.

`Promise.allSettled` should be wrapped with a concurrency limiter (e.g., `p-limit`):

```ts
import pLimit from 'p-limit'

const limit = pLimit(job.runtimeConfig.maxConcurrentAgents)

const results = await Promise.allSettled(
  reviewers.map(reviewer =>
    limit(() => deps.providerExecutor.run(reviewer, context))
  )
)
```

### 35.7 Event Log Lifecycle

Event logs (`events.log`) will grow with long jobs. Phase 1 rules:

- No rotation needed during a job (jobs are bounded by max rounds)
- After job completion: compress `events.log` to `events.log.gz` (optional, not blocking)
- Future: rotate by size if jobs become long-running

---

## 36. Hard Runtime Rules

Decisions that must be locked before code is written.

### 36.1 No Token-Level Streaming in Phase 1

The `agent:output` and `agent:output:end` socket events exist, but:

- **Phase 1 does NOT stream token-by-token from providers**
- Provider calls are request/response: send prompt, wait for full response
- `agent:output` emits the complete response as a single chunk
- `agent:output:end` fires immediately after

**Rationale:**

- Token streaming complicates the CLI output, parser, and inspectability
- Full response is easier to log, debug, normalize, and test
- Streaming can be added in a future phase without changing the event contract

### 36.2 Single Process Model

v1 runs the entire orchestration in a **single Node.js process**:

- No multi-worker
- No job queue (Redis, Bull, etc.)
- No process forking for agents
- CLI invocations are blocking (run job, wait for completion)

**Rationale:** Simplest to debug, test, and reason about. Job queues and workers are a future optimization.

### 36.3 Atomic File Writes

All file writes to `.agent-orchestra/` must be atomic:

```ts
// Write to temp file first, then rename
async function atomicWrite(path: string, data: string) {
  const tmp = path + '.tmp'
  await fs.writeFile(tmp, data, 'utf-8')
  await fs.rename(tmp, path)
}
```

**Rationale:** If the process crashes mid-write, a partial JSON file corrupts the job. Atomic rename prevents this.

This applies to: `job.json`, `round-{n}.json`, `clusters.json`, `synthesis.json`, `decision-log.json`, `agents.json`.

`events.log` is append-only (NDJSON) and does not need atomic writes — partial last lines are acceptable.

### 36.4 ID Generation Strategy

| Entity | Format | Example |
|--------|--------|---------|
| Job | `job-{YYYYMMDD}-{random6}` | `job-20260320-a1b2c3` |
| Round | `r-{index}` | `r-0`, `r-1` |
| Finding | `f-{uuid-v4}` | `f-3d2e1f00-...` |
| FindingCluster | `cl-{uuid-v4}` | `cl-8a7b6c5d-...` |
| AgentAssignment | `aa-{uuid-v4}` | `aa-1a2b3c4d-...` |
| AgentConfig | `ac-{uuid-v4}` | `ac-5e6f7a8b-...` |

**Rules:**

- Job IDs include date for human readability and filesystem sorting
- Round IDs are simple indexes (deterministic, not random)
- All other IDs use UUID v4 for uniqueness
- IDs are generated at creation time, never changed

### 36.5 CLI-First UX Rule

**Hard rule:** Every feature must be fully usable via CLI before any UI is built for it.

- If a feature cannot be expressed as a CLI command, rethink the feature
- Web dashboard is a read/action layer on top of CLI capabilities
- CLI is not a "developer escape hatch" — it is the primary interface
- All CLI commands must have `--json` output mode for scripting/automation

```
# Every operation must work from CLI
agent-orchestra create --mode code_review --brief "..." --scope "./src"
agent-orchestra agent:add --role reviewer --lens logic --provider openai --model gpt-4o
agent-orchestra run <job-id>
agent-orchestra inspect <job-id> --summary
agent-orchestra inspect <job-id> --summary --json   # machine-readable
agent-orchestra decide <job-id> --accept
agent-orchestra decide <job-id> --accept --notes "LGTM"
agent-orchestra decide <job-id> --rerun-synthesis
agent-orchestra agent:list
agent-orchestra agent:list --json
```

---

## 37. Synthesis Failure Policy

### 37.1 Problem

Synthesis is an LLM call (section 18) that can fail independently of the review rounds. The FailurePolicy covers reviewer/architect/builder failures but does not address synthesis.

### 37.2 Rules

| Scenario | Behavior |
|----------|----------|
| Synthesis fails, no prior synthesis exists | Job status → `failed`, but all round artifacts are preserved |
| Synthesis fails, prior synthesis exists | Keep prior synthesis, status remains `awaiting_decision`, user can rerun |
| Synthesis produces malformed output | Treat as synthesis failure, apply same rules above |
| Synthesis retry | Synthesis can be retried independently via `agent-orchestra decide <job-id> --rerun-synthesis` |

**Key principle:** Synthesis failure never rolls back completed rounds. Round artifacts are always preserved regardless of synthesis outcome.

---

## 38. NDJSON Reader Tolerance

### 38.1 Rule

All readers/parsers of `events.log` must:

- Parse line-by-line
- **Ignore the last line if it is malformed** (process may have crashed mid-write)
- Never fail the entire `inspect` command because of a single corrupt log line
- Log a warning when skipping malformed lines

```ts
function parseEventLog(content: string): Array<ProviderCallRecord | StateTransitionEvent> {
  const lines = content.split('\n').filter(l => l.trim())
  const events = []

  for (const line of lines) {
    try {
      events.push(JSON.parse(line))
    } catch {
      // Skip malformed line — likely a partial write from a crash
    }
  }

  return events
}
```

---

## 39. Parser Contract (Warning vs. Malformed)

### 39.1 Problem

The OutputNormalizer needs clear rules for when to warn vs. when to reject output as malformed. Too strict = frequent failures. Too lenient = garbage data in findings.

### 39.2 Rules

**Warning (parse continues, output accepted with warnings):**

- Missing `tags` on a Finding
- Missing `evidence` on a Finding
- Missing `confidence` (default to `'medium'`)
- Extra unexpected fields (ignored)
- Minor formatting deviations in markdown structure

**Malformed (parse fails, triggers retry/failure policy):**

- Missing `title` on a Finding
- Missing `scopeType` on a Finding
- Missing `actionability` on a Finding
- No parseable findings section at all
- Response is empty or contains only error text

### 39.3 Interface

> `NormalizationResult` and `OutputNormalizer` are canonically defined in section 7.3. This section documents the classification rules only.
```

The caller checks `malformed` and decides whether to retry or apply failure policy.

---

## 40. Phase 1A Non-Goals (Explicit)

What Phase 1A will NOT build, even if it seems easy or "might as well":

- No bridge provider runtime
- No desktop wrapper (Electron/Tauri)
- No token-level streaming
- No semantic clustering
- No distributed workers or job queues
- No secret vault or keychain
- No builder protocol runner
- No web dashboard (1B)
- No multi-reviewer wave (1B)
- No scope guard enforcement (1B)
- No interactive cancellation (no `cancel` CLI command, no socket `job:cancel`, no UI cancel button — 1B). Internal cancellation primitives (`CancellationRegistry`, `AbortController`) exist in core contracts but are not user-facing in 1A. Process exit (Ctrl+C) is the only cancellation mechanism.
- No rate limiting (1B — only needed with parallel reviewers)

**Rule:** If a developer says "it's just a few lines to add X," the answer is still no if X is on this list. Scope discipline applies to the product team, not just to agents.

---

## 41. Phase 1A CLI Command Inventory (Locked)

These commands must exist and work before Phase 1A is considered complete:

| Command | Description |
|---------|-------------|
| `agent-orchestra create` | Create a new job |
| `agent-orchestra run <job-id>` | Run a job (blocking, single process) |
| `agent-orchestra inspect <job-id> --summary` | Show synthesis result |
| `agent-orchestra inspect <job-id> --timeline` | Show round-by-round summary |
| `agent-orchestra inspect <job-id> --round <n>` | Show full round artifact |
| `agent-orchestra agent:add` | Add agent to registry |
| `agent-orchestra agent:list` | List registered agents |
| `agent-orchestra decide <job-id> --accept` | Accept synthesis |
| `agent-orchestra decide <job-id> --rerun-synthesis` | Re-run synthesis |

All commands must support `--json` for machine-readable output.

**Deferred to Phase 1B:**

- `agent-orchestra agent:edit`
- `agent-orchestra agent:remove`
- `agent-orchestra agent:test`
- `agent-orchestra inspect <job-id> --events`
- `agent-orchestra inspect <job-id> --costs`
- `agent-orchestra inspect <job-id> --failure`
- `agent-orchestra inspect <job-id> --prompts`

---

## 42. Phase 1A Provider Parity (Locked)

### 42.1 Phase 1A ships exactly two provider adapters:

| Adapter | Type | What it covers |
|---------|------|---------------|
| `openai-compatible` | API | Any endpoint that speaks the OpenAI chat completions API (OpenAI, Azure, local proxies, etc.) |
| `claude-cli` | CLI | Claude CLI via stdin/stdout |

### 42.2 No dedicated per-vendor API adapters in 1A

There is no separate `openai` adapter, `anthropic` adapter, or `google` adapter. If the provider speaks OpenAI-compatible API, the generic adapter handles it. This keeps Phase 1A to exactly 2 adapter implementations.

### 42.3 Phase 1B provider additions

- `anthropic` adapter (native API — for features not available via OpenAI-compatible format)
- `google` adapter (Gemini API)
- `local-command` adapter (generic CLI wrapper beyond Claude)

---

## 43. SynthesisConfig Placement

`SynthesisConfig` (defined in section 18.1) must live in `JobRuntimeConfig`:

```ts
export type JobRuntimeConfig = {
  maxConcurrentAgents: number
  pausePointsEnabled: boolean
  synthesisConfig: SynthesisConfig   // Added
}
```

Phase 1 default: `{ provider: 'architect_provider', rerunnable: true }`. The `dedicated` provider option is a future enhancement.

---

## 44. RoundArtifact Must Include builderOutput

Section 32.1 defines `RoundArtifact` but does not include `builderOutput`, which was added to `Round` in section 4.14. For forward-compatibility:

```ts
export type RoundArtifact = {
  // ... existing fields from section 32.1 ...
  builderOutput?: AgentOutput   // Added: only in build rounds
}
```

Even though `builder_plus_reviewer` is not implemented in Phase 1, the artifact schema must be forward-compatible so that future builder outputs serialize correctly without a storage migration.

---

## 45. Consolidated Spec Note

This document has grown through iterative review. Later sections sometimes override or clarify earlier ones. For implementation:

**When a later section says "supersedes section X"** — section X is kept for historical context but the later section is authoritative.

**When a type appears in multiple sections** — the definition in section 4 (Core Type System) is always canonical. Later sections may add context or usage examples but must not redefine the type.

**Recommended reading order for new developers:**

1. Section 1 (Document Authority)
2. Section 4 (Core Type System) — all types
3. Section 7 (Output Normalization) — pipeline + NormalizationResult
4. Section 8 (Protocol-Driven Orchestrator) — how jobs run
5. Section 34 (Phase 1 Roadmap) — what to build
6. Section 40-42 (Phase 1A scope) — what NOT to build
7. Section 36 (Hard Runtime Rules) — implementation constraints
8. Everything else as needed

**Future action:** Before Phase 1A implementation begins, this document should be consolidated into a clean single-pass spec where each type and interface appears exactly once, with no "supersedes" references. The current format is optimized for iterative review; a consolidated version is optimized for implementation.

---

## 46. Future Enhancements (Post-Phase 1)

Ideas validated during spec review. Not in scope for Phase 1 but worth noting because some influence storage design decisions made now.

### 46.1 Self-Correction Loop (Learning from User Decisions)

When a user rejects a finding or accepts with notes (section 24.2), this is high-signal feedback. Over time, the system can learn from rejection patterns:

- Store rejection reasons as structured data in `DecisionEntry` (already supported — `message` + `source: 'user'`)
- After N jobs, extract patterns: "User consistently rejects `logic` lens findings about null checks in this codebase"
- Feed rejection patterns as few-shot negative examples into reviewer prompts for future jobs

**Why note this now:** The `DecisionEntry` type (section 4.6) already has the right shape to support this. No storage changes needed — just future prompt engineering work.

### 46.2 Shadow Reviewer (A/B Testing for Agents)

Run an additional agent in "shadow" mode alongside the official reviewers. Shadow agent output:

- Is NOT included in clustering or synthesis
- IS stored in round artifacts for comparison
- Enables A/B testing: compare a new model/prompt against the current setup without affecting job results

**Implementation sketch:**

```ts
// Add to AgentAssignment
export type AgentAssignment = {
  // ... existing fields ...
  shadow: boolean  // default: false
}
```

Protocol runners filter out shadow agents before clustering/synthesis but still invoke them during review wave. Low implementation cost since parallel reviewer infrastructure already exists.

### 46.3 LLM-Based Clustering (Phase 2)

Replace the title-normalization clustering (section 14) with an LLM-based dedup step:

- Use a cheap, fast model (e.g., GPT-4o-mini) to group findings semantically
- Input: all raw findings from the review wave
- Output: clustered findings with merge rationale
- Eliminates the dependency on reviewers writing consistent titles

This is the correct long-term solution to the clustering quality problem noted in section 35.2.

### 46.4 Lens Store (Community Packs)

Allow export/import of `PromptTemplate` + `AgentConfig` bundles as reusable "lens packs":

- `security-lens-pack`: security-focused reviewer config + specialized prompt templates
- `performance-optimization-pack`: perf-focused analysis with benchmarking instructions
- Community-contributed packs via a registry

**Why note this now:** The separation of `AgentConfig` (section 4.8) and `PromptTemplate` (section 22.2) already supports this pattern. A lens pack is just a JSON bundle of these two types.

### 46.5 Time-Travel Debugger (Web Dashboard)

The inspectability contract (section 32) stores `RoundArtifact` with `promptHash` and full agent outputs per round. This enables a "time-travel" view in the web dashboard:

- Step through each round and see exactly what the agent received (context + prompt hash) and produced
- Compare agent outputs side-by-side across rounds
- Answer "why did the AI conclude X?" by showing the exact evidence it had

**Why note this now:** The artifact schema already supports this. No storage changes needed — it's a pure UI feature on top of existing data.

### 46.6 Human-in-the-Loop Prompt Editing at Pause Points

Section 21 defines pause points where the user can continue, adjust scope, or skip to synthesis. A natural extension is allowing the user to **edit the prompt** at a pause point:

- User reads the Architect's analysis and decides "I want reviewers to focus more on security than logic"
- User modifies the reviewer prompt (or switches lens) before the review wave runs
- The modified prompt is recorded in the round artifact for inspectability

This is more powerful than just adjusting scope — it gives the user direct control over agent behavior mid-run.

**Why note this now:** The pause point infrastructure (section 21) and versioned prompt templates (section 29) already provide the hooks. The main new work is a UI for prompt editing and recording which template override was used.

---

## 47. CLI Input Contracts

### 47.1 `agent-orchestra create`

```bash
agent-orchestra create \
  --mode code_review \
  --brief "Check uuid-first migration" \
  --scope "./modules/content" \
  --scope "./modules/auth" \
  --agent ac-5e6f7a8b \
  --agent ac-1a2b3c4d
```

| Flag | Required | Multiple | Description |
|------|----------|----------|-------------|
| `--mode` | yes | no | `plan`, `code_review`, `execution_review` |
| `--brief` | yes | no | Short description. For long briefs, use `--brief-file` |
| `--brief-file` | no | no | Path to file containing brief text (mutually exclusive with `--brief`) |
| `--scope` | yes | yes | Path to primary target. Can be repeated for multiple targets |
| `--scope-file` | no | no | Path to file listing scope targets, one per line |
| `--exclude` | no | yes | Path to exclude from scope |
| `--agent` | yes | yes | Agent registry ID (from `agent:list`). Can be repeated |
| `--protocol` | no | no | Override auto-selected protocol |
| `--max-rounds` | no | no | Default: 10 |

### 47.2 `agent:add`

```bash
agent-orchestra agent:add \
  --name "GPT-4o Logic Reviewer" \
  --role reviewer \
  --lens logic \
  --connection-type api \
  --provider openai-compatible \
  --model gpt-4o
```

Agents are identified by **registry ID** (auto-generated `ac-{uuid}`), not by name. Names are display labels only and need not be unique.

### 47.3 Long Brief Input

If `--brief` text is too long for a command-line argument:

```bash
# Option 1: file
agent-orchestra create --brief-file ./review-brief.md --scope ./src ...

# Option 2: stdin pipe
cat review-brief.md | agent-orchestra create --brief-stdin --scope ./src ...
```

---

## 48. CLI Output Schema

All commands support `--json` for machine-readable output. The schema is consistent across all commands:

```ts
export type CLIOutput<T> = {
  success: boolean
  data?: T
  error?: string
  warnings?: string[]
}
```

### 48.1 Examples

```json
// agent-orchestra create --json
{
  "success": true,
  "data": {
    "jobId": "job-20260320-a1b2c3",
    "protocol": "single_challenger",
    "agents": 2
  }
}

// agent-orchestra run <job-id> --json (on failure)
{
  "success": false,
  "error": "Architect provider failed: Missing env var OPENAI_API_KEY",
  "warnings": []
}

// agent-orchestra inspect <job-id> --summary --json
{
  "success": true,
  "data": {
    "jobId": "job-20260320-a1b2c3",
    "status": "awaiting_decision",
    "confirmed": 3,
    "disputed": 1,
    "followUps": 2,
    "recommendation": "..."
  }
}
```

### 48.2 Rule

Exit codes must match `success`:

- `exit 0` when `success: true`
- `exit 1` when `success: false`

This enables scripting with standard shell patterns (`&&`, `||`, `$?`).

---

## 49. DecisionEntrySource Extensibility

```ts
export type DecisionEntrySource = 'user' | 'system'
```

This is sufficient for Phase 1. However, note that `'agent'` will likely be needed in a future phase when:

- Architect auto-promotes follow-up candidates from clusters
- System records which agent's rebuttal resolved a disputed finding
- Self-correction loop (section 46.1) attributes learning to specific agent outputs

**Phase 1 rule:** Do not add `'agent'` now. When the need arises, extend the union — existing data remains valid since `'user'` and `'system'` entries don't change meaning.

---

## 50. Patch Summary

All conflicts, gaps, and review feedback are resolved:

| Issue | Resolution |
|-------|-----------|
| `Finding` type undefined | Section 4.7 |
| `Job` type undefined | Section 4.17 |
| `JobScope` type undefined | Section 4.5 |
| `DecisionLog` type undefined | Section 4.6 (uses `DecisionEntry`) |
| `AgentOutput` type undefined | Section 4.10 |
| `NormalizedAgentOutput` vs `ProviderOutput` conflict | Retired; canonical is `AgentOutput` |
| Output pipeline unclear | Section 7.1 (updated with `NormalizationResult` flow) |
| Orchestrator hardcoded linear flow | Protocol-driven, section 8 |
| `builder_plus_reviewer` missing from Protocol type | Section 5.1 |
| `ProviderInput.role` missing `'builder'` | Section 5.2 |
| `AgentConfig` vs `AgentAssignment` unclear | Section 4.8-4.9 |
| No cancellation mechanism | Section 9 (with phase scope note in 9.1) |
| No retry/failure strategy | Section 9.3-9.5 |
| No streaming completion signal | Section 12 |
| Desktop vs web mismatch | CLI-first, section 25 |
| MVP scope inflated | Phase 1A/1B, section 34 |
| Synthesis engine underspecified | Section 18 |
| Reviewer parallelism unspecified | Parallel, section 19 |
| No context budget management | Section 20 |
| No mid-run user intervention | Section 21 |
| No prompt templates | Section 22 |
| OutputNormalizer not provider-aware | Section 23 |
| `awaiting_decision` UX undefined | Section 24 |
| Bridge premature | Section 26, 28.2, Appendix A |
| No testing strategy | Section 27 (with CLI hang test priority) |
| No canonical file declaration | Section 1 |
| Phase 1 too broad | 1A/1B split, section 34 |
| Forward-compat types unclear | Section 28 |
| Prompt template versioning | Section 29 |
| No LLM fallback rule | Section 30 |
| Credentials MVP rules | Section 31 |
| No inspectability contract | Section 32 (with builderOutput in artifact) |
| Token estimation inaccurate | tiktoken in 1A, section 20.5 |
| No exponential backoff | Section 9.5 |
| Clustering title quality | Section 14.3 |
| Implementation risks | Section 35 |
| Hard runtime rules | Section 36 |
| Synthesis failure policy | Section 37 |
| NDJSON tolerance | Section 38 |
| Parser warning vs malformed | Section 39 |
| Phase 1A non-goals | Section 40 |
| CLI commands locked | Section 41 |
| Provider parity | Section 42 |
| SynthesisConfig placement | Section 43 (and canonical in 4.16) |
| RoundArtifact builderOutput | Section 44 (and canonical in 32.1) |
| Consolidated spec note | Section 45 |
| Future enhancements | Section 46 |
| **Section 7.1 flow showed AgentOutput not NormalizationResult** | Fixed inline |
| **Section 23.4 still listed LLM fallback as strategy** | Fixed: malformed in Phase 1, LLM future only |
| **JobRuntimeConfig missing SynthesisConfig** | Fixed in section 4.16 canonical type |
| **RoundArtifact missing builderOutput** | Fixed in section 32.1 canonical type |
| **Cancellation scope unclear between sections 9 and 40** | Phase scope note added to section 9.1 |
| **Synthesis versioning not in storage layout** | Fixed in section 33: synthesis-v{n}.json |
| **ProviderCallRecord missing template debug fields** | Added templateId, templateVersion, malformedReason |
| **CLI create command input contract undefined** | Section 47 |
| **CLI --json output schema undefined** | Section 48 |
| **DecisionEntrySource extensibility not noted** | Section 49 |
| **LLM-based dedup missing from Phase 1B scope** | Added to Phase 1B roadmap, section 34 |
| **CLI hang test not Priority 0** | Upgraded to P0 with cross-platform requirement, section 27.2 |
| **Time-travel debugger not noted** | Section 46.5 |
| **Human-in-the-loop prompt editing not noted** | Section 46.6 |

---

## Appendix A — Bridge Provider (Future Reference)

> Moved from main spec. For reference only — not part of any current phase.

The provider interface is designed to support future bridge adapters for external agent runtimes (e.g., AntiGravity, Cursor, Codex Desktop) if they expose a viable connection point.

**Support levels (when implemented):**

| Level | Name | Description |
|-------|------|-------------|
| 1 | Wrapper | Command/HTTP wrapper that calls external tool and normalizes output |
| 2 | Native Bridge | Dedicated adapter for tools with API, CLI, MCP, or local endpoint |
| 3 | Embedded Integration | Deep integration — only when platform is stable with clear interface |

**Future registry entries (not active):**

- `mcp-bridge`
- `webhook-bridge`
- `http-agent-bridge`
- `desktop-app-bridge`
- `custom-bridge`

These entries will be added to the provider registry when their implementations exist.
