# Multi-Agent Review Room — Technical Spec v1.1

## 1. General Philosophy

The system does NOT default to a fixed topology of 1 Architect + 1 Challenger.

It supports:

- 1 Architect
- 1..N Reviewers
- Optional Builder
- Optional Synthesizer layer (handled by the system)

The number of agents does NOT mean proportionally more debate rounds.

### Core Principles

- **Agent count determines topology and protocol** — no single fixed loop for every job.
- When agent count grows, prioritize:
  - Fewer loops
  - Clearer role separation
  - Better clustering
  - Earlier synthesis

---

## 2. Topology by Agent Count

### 2.1 Two Agents

**Topology:** 1 Architect + 1 Challenger

**Protocol:** `single_challenger`

1. Architect Initial
2. Challenger Review
3. Architect Rebuttal
4. Final Synthesis

**Purpose:** Fast, lean. Ideal for daily code/plan reviews.

### 2.2 Three Agents

**Topology:** 1 Architect + 2 Reviewers

**Protocol:** `reviewer_wave`

1. Architect Initial
2. Reviewer Wave (Reviewer A + Reviewer B)
3. Cluster Findings
4. Architect Consolidated Rebuttal
5. Final Synthesis

**Note:** Architect should NOT rebut after each reviewer individually — only after both reviewers complete their wave.

### 2.3 Four to Five Agents

**Topology:** 1 Architect + 3–4 Reviewers (by lens)

**Protocol:** `reviewer_wave` or `reviewer_wave_with_final_check`

1. Architect Initial
2. Reviewer Wave
3. Dedup / Cluster
4. Architect Consolidated Rebuttal
5. Optional Final Check Wave (unresolved clusters only)
6. Final Synthesis

**Note:** Final check wave is short. It cannot open entirely new issues unless they are clear blockers within primary scope.

### 2.4 More Than Five Agents

**Position:** Technically possible, but NOT recommended for v1/v1.1.

**Reasons:**

- Increased duplication
- Increased bias
- Increased noise
- Increased cost
- Harder convergence

**Guardrails:**

- Default max reviewers per job: 3
- Hard max (configurable): 5

---

## 3. Reviewer Lens Pool

Each reviewer must have a distinct lens to avoid "many but overlapping" reviews.

### Code Review Lenses

| Lens | Focus |
|------|-------|
| `logic` | Correctness of logic and algorithms |
| `consistency` | Code style and pattern consistency |
| `regression` | Potential regressions and side effects |
| `testing` | Test coverage and quality |
| `performance` | Performance implications |
| `security` | Security vulnerabilities |
| `cross_system_contract` | API contracts and cross-system boundaries |

### Plan/Spec Review Lenses

| Lens | Focus |
|------|-------|
| `scope` | Scope definition and boundaries |
| `dependency` | Dependencies and ordering |
| `sequencing` | Step sequencing and parallelism |
| `simplification` | Opportunities to simplify |
| `risk` | Risk identification |
| `implementation_readiness` | Readiness for implementation |

### Rules

- Each reviewer must have exactly 1 primary lens.
- No two reviewers in the same job should share a lens, unless the user explicitly intends it.

---

## 4. Protocol Engine

### 4.1 Supported Protocols

The protocol engine is NOT hardcoded to a single challenger model. It supports:

| Protocol | Description |
|----------|-------------|
| `single_challenger` | 1v1 Architect vs Challenger |
| `reviewer_wave` | 1 Architect + N Reviewers in a wave |
| `reviewer_wave_with_final_check` | Wave + extra pass on unresolved clusters |
| `builder_plus_reviewer` | Builder executes, reviewer validates |

### 4.2 Suggested Mapping

| Condition | Protocol |
|-----------|----------|
| 2 agents | `single_challenger` |
| 3–5 agents | `reviewer_wave` |
| Execution review | `builder_plus_reviewer` |
| Multiple reviewers + extra pass needed | `reviewer_wave_with_final_check` |

---

## 5. Add Agent Form

A structured form for configuring agents — no freeform input.

### 5.1 Form Fields

#### Basic

| Field | Type | Description |
|-------|------|-------------|
| Agent Name | string | Display name |
| Role | enum | `architect` / `reviewer` / `builder` |
| Lens | enum (optional) | From lens pool |
| Description / Notes | text | Free-form notes |

#### Runtime / Connection

| Field | Type | Description |
|-------|------|-------------|
| Connection Type | enum | `api` / `cli` / `bridge` |
| Provider | select | From provider registry |
| Model / Command | string | Model ID or CLI command |
| Enabled | boolean | Active toggle |

#### Prompt / Behavior

| Field | Type | Description |
|-------|------|-------------|
| Protocol Preset | select | Default behavior preset |
| Max Findings | number | Cap on findings per review |
| Scope Discipline Level | enum | How strict on scope |
| Evidence Strictness | enum | How strict on evidence |
| Can Write Code | boolean | Whether agent can produce code |
| Allow Reference Scan | boolean | Whether agent can scan reference files |

#### Advanced

| Field | Type | Description |
|-------|------|-------------|
| Timeout | number (ms) | Max execution time |
| Retry Policy | number | Retry count on failure |
| Token Budget | number | Max tokens per invocation |
| Provider Profile | select | Provider-specific tuning |
| Environment Variables Reference | string[] | Env var keys to inject |
| Working Directory | string | CWD for CLI agents |
| Command Template | string | Template for CLI execution |

### 5.2 Data Shape

```ts
type AgentConnectionType = 'api' | 'cli' | 'bridge'

type AgentRole = 'architect' | 'reviewer' | 'builder'

type AgentLens =
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

type AgentConfig = {
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

---

## 6. Provider Layer

Three distinct groups of providers.

### 6.1 API Providers

For models/services called via HTTP API.

**Must-have (v1):**

- OpenAI
- Anthropic / Claude
- Google
- xAI / Grok
- DeepSeek

**Design for easy addition:**

- OpenRouter
- Azure OpenAI
- Together
- Fireworks
- Mistral
- Cohere
- Perplexity
- Ollama / local gateway
- vLLM / self-hosted OpenAI-compatible endpoint

The adapter interface must be open enough to plug in any of these without core changes.

### 6.2 CLI Providers

For local command-line tools.

**Examples:**

- Claude CLI
- Codex CLI / wrappers
- Local scripts
- Custom agent runners
- Model wrapper commands

**CLI adapter must support:**

- stdin prompt injection
- stdout capture
- Structured output parsing
- CWD / env injection
- Timeout
- Retry
- Streaming (if available)

### 6.3 Bridge / External App Providers

For leveraging external apps/agents (e.g., AntiGravity, Codex Desktop, Cursor) **if they expose a connection point**.

**Design principle:** Do NOT assume external apps have direct integration. Instead, design a bridge abstraction:

- If app has API → use API bridge
- If app has CLI → use CLI bridge
- If app has local socket / MCP / webhook / extension → use bridge adapter
- If no integration point → not supported natively, only via wrapper

**Pragmatic conclusion:** The system has a Bridge Provider to leverage external agent runtimes when they provide a viable connection — no premature native integrations.

---

## 7. Provider Registry

A registry instead of hardcoded providers in forms.

### 7.1 Data Model

```ts
type ProviderKind = 'api' | 'cli' | 'bridge'

type ProviderCapability = {
  supportsStreaming: boolean
  supportsSystemPrompt: boolean
  supportsJsonMode: boolean
  supportsToolUse: boolean
  supportsVision?: boolean
  supportsLongContext?: boolean
}

type ProviderDefinition = {
  key: string
  label: string
  kind: ProviderKind

  capabilities: ProviderCapability

  configSchema: Record<string, unknown>
  authSchema?: Record<string, unknown>

  defaultModels?: string[]
  notes?: string
}
```

### 7.2 Default Registry Entries

#### API

| Key | Label |
|-----|-------|
| `openai` | OpenAI |
| `anthropic` | Anthropic / Claude |
| `google` | Google AI |
| `xai` | xAI / Grok |
| `deepseek` | DeepSeek |
| `openrouter` | OpenRouter |
| `azure-openai` | Azure OpenAI |
| `together` | Together AI |
| `fireworks` | Fireworks AI |
| `mistral` | Mistral AI |
| `cohere` | Cohere |
| `perplexity` | Perplexity |
| `ollama` | Ollama (local) |
| `openai-compatible` | OpenAI-compatible endpoint |

#### CLI

| Key | Label |
|-----|-------|
| `claude-cli` | Claude CLI |
| `local-command` | Local Command |
| `custom-cli-wrapper` | Custom CLI Wrapper |

#### Bridge

| Key | Label |
|-----|-------|
| `mcp-bridge` | MCP Bridge |
| `webhook-bridge` | Webhook Bridge |
| `http-agent-bridge` | HTTP Agent Bridge |
| `desktop-app-bridge` | Desktop App Bridge |
| `custom-bridge` | Custom Bridge |

---

## 8. External Agent Reuse Strategy

### Support Levels

| Level | Name | Description |
|-------|------|-------------|
| 1 | Wrapper | Command/HTTP wrapper that calls external tool and normalizes output |
| 2 | Native Bridge | Dedicated adapter for tools with API, CLI, MCP, or local endpoint |
| 3 | Embedded Integration | Deep integration — only when external platform is stable with clear interface |

**v1/v1.1 scope:** Wrapper-friendly, bridge-ready. No premature native integrations.

---

## 9. Output Normalization Layer

Every provider/app returns different output. A normalization layer converts everything to a standard format.

### Normalized Output Shape

```ts
type NormalizedAgentOutput = {
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

**Rule:** Whether the agent is API, CLI, or bridge — output MUST normalize to this format.

---

## 10. Provider Profiles

Different providers have different strengths/weaknesses in context handling, verbosity, and structure discipline.

### Profile Shape

```ts
type ProviderProfile = {
  contextTolerance: 'low' | 'medium' | 'high'
  structureDiscipline: 'low' | 'medium' | 'high'
  verbosityTendency: 'low' | 'medium' | 'high'
  bestAt: Array<
    | 'analysis'
    | 'challenge'
    | 'synthesis'
    | 'implementation'
    | 'consistency_check'
    | 'test_review'
  >
}
```

**Purpose:** Context builder and protocol engine can adjust behavior per provider profile instead of treating all providers identically.

---

## 11. UI Additions

### 11.1 Agent Registry Screen

- Create / edit / delete agent configs
- Test connection
- Set default role / lens
- Save reusable presets

### 11.2 Add Agent Modal

Flow:

1. Select connection type
2. Select provider
3. Enter model / command / bridge config
4. Select role
5. Select lens
6. Select protocol preset
7. Test output format
8. Save

### 11.3 Updated Job Setup

Beyond Architect and Challenger, the job setup now includes:

| Field | Description |
|-------|-------------|
| Architect | Select 1 |
| Reviewers | Select 0..N |
| Builder | Optional |
| Topology | Auto / Manual |
| Protocol suggestion | Auto-derived from agent count |

---

## 12. Topology Selection Rules

### 12.1 Auto Mode

System selects topology based on agent count and job type.

| Condition | Topology |
|-----------|----------|
| 2 agents + plan/code review | `single_challenger` |
| 3–5 agents + review | `reviewer_wave` |
| 1 builder + 1 reviewer | `builder_plus_reviewer` |

### 12.2 Manual Mode

User can override topology, subject to validation.

**Not allowed:**

- Infinite round-robin
- Reviewer-to-reviewer direct debate (in v1.1)
- More than 2 full cycles

---

## 13. Reviewer Cycle Guardrails

### 13.1 With 2 Agents

- Allow 1 direct rebuttal

### 13.2 With 3–5 Agents

- No per-reviewer rebuttal
- Review in wave
- Architect rebuts once after clustering

### 13.3 Final Check Wave

- Only for unresolved clusters
- Cannot open new scope
- Cannot open more than N new findings (default: 0)

---

## 14. Updated State Machine

States (replacing the single `challenge` state):

1. `analysis` — Architect produces initial analysis
2. `review_wave` — Reviewers produce findings
3. `cluster` — System clusters and deduplicates findings
4. `rebuttal` — Architect responds to clustered findings
5. `final_check` — Optional extra pass on unresolved items
6. `convergence` — System synthesizes final output
7. `user_decision` — User reviews and decides

---

## 15. Updated Data Models

### 15.1 AgentAssignment

```ts
type AgentAssignment = {
  id: string
  role: 'architect' | 'reviewer' | 'builder'
  label: string

  providerKey: string
  connectionType: 'api' | 'cli' | 'bridge'
  modelOrCommand: string

  lens?: AgentLens
  protocol: string
  enabled: boolean

  maxFindings?: number
  allowReferenceScan?: boolean
  canWriteCode?: boolean
}
```

### 15.2 Round

```ts
type Round = {
  id: string
  jobId: string
  index: number
  state:
    | 'analysis'
    | 'review_wave'
    | 'cluster'
    | 'rebuttal'
    | 'final_check'
    | 'convergence'

  architectOutput?: AgentOutput

  reviewerOutputs: Array<{
    agentId: string
    output: AgentOutput
  }>

  clusterOutput?: FindingCluster[]
  summary?: string
  createdAt: string
}
```

### 15.3 FindingCluster

```ts
type FindingCluster = {
  id: string
  theme: string
  scopeType: 'primary' | 'reference' | 'out_of_scope'
  linkedFindings: Array<{
    agentId: string
    findingTitle: string
  }>
  status: 'confirmed' | 'disputed' | 'needs_decision'
}
```

---

## 16. Updated Prompt Contracts

### 16.1 Reviewer Prompt Additions

Beyond scope discipline, reviewers must:

- Follow assigned lens strictly
- Avoid duplicating previously identified findings
- Support existing clusters when applicable
- Not open new out-of-scope debates

### 16.2 Architect Rebuttal Prompt Additions

- Respond to clustered findings, not raw duplicate findings
- Preserve focus on primary scope
- Mark follow-up candidates separately

---

## 17. MVP Scope (v1/v1.1)

### Must-Have (Core)

- Agent Registry (CRUD + test connection)
- Add Agent Form (structured, not freeform)
- API providers — basic set (OpenAI, Anthropic, Google, xAI, DeepSeek)
- CLI provider — basic support
- `single_challenger` protocol
- `reviewer_wave` protocol
- Finding clustering (basic)
- Scope guardrails
- Final synthesis
- Output normalization

### Not Yet Needed

- Native deep integration with desktop apps
- Reviewer-to-reviewer debate
- Dynamic agent spawning
- Autonomous consensus loops
- Advanced cost optimization
- Embedded integrations (Level 3)

---

## 18. Proposed Module Structure

```
agent-orchestra/
  apps/
    cli/                        # CLI application
    web/                        # Web application
  packages/
    core/
      orchestrator/             # Job orchestration
      protocols/                # Protocol engine
      scope-guard/              # Scope discipline
      clustering/               # Finding dedup & clustering
      synthesis/                # Final synthesis
      context-builder/          # Context assembly
    providers/
      api/                      # API provider adapters
      cli/                      # CLI provider adapters
      bridge/                   # Bridge provider adapters
    registry/                   # Agent & provider registry
    shared/                     # Shared types & utilities
```

---

## 19. Summary

This spec preserves the original philosophy:

- User orchestrates
- Clear role separation
- Clear scope boundaries
- Out-of-scope code is evidence only
- Synthesis for fast convergence

And adds new capabilities:

- Flexible agent count
- Topology adapts to agent count
- Add Agent Form for structured configuration
- Agent Registry for managing agent configs
- API / CLI / Bridge provider adapters
- External agent runtime reuse when connection is available
- Provider profiles for tuned behavior
- Output normalization across all provider types
