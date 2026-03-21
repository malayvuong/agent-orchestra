# Agent Orchestra — Technical Spec v1.2 (Dev-ready)

> This spec is implementation-focused: backend architecture, layer contracts, realtime flow, provider implementation, and concrete TypeScript structures. Ready to code from.

---

## 1. System Architecture

### 1.1 High-level Overview

```
Electron App (React UI)
        │
        │  (Socket.IO)
        ▼
Node Orchestration Server
 ├── Orchestrator Engine
 ├── Protocol Engine
 ├── Context Builder
 ├── Scope Guard
 ├── Clustering Engine
 ├── Synthesis Engine
 │
 ├── Provider Layer
 │   ├── API Providers
 │   ├── CLI Providers
 │   ├── Bridge Providers
 │
 └── Storage Layer
     ├── Job Store
     ├── Artifact Store
     ├── Decision Log
```

---

## 2. Backend — Core Modules

### 2.1 Orchestrator Engine

**Responsibility:**

- Manage job lifecycle
- Coordinate rounds
- Invoke agents by role
- Enforce protocol
- Trigger synthesis

#### 2.1.1 Core Class

```ts
class Orchestrator {
  async runJob(jobId: string) {
    const job = await this.loadJob(jobId)

    await this.runAnalysis(job)
    await this.runReviewWave(job)
    await this.runClustering(job)
    await this.runRebuttal(job)

    if (job.hasUnresolvedCritical()) {
      await this.runFinalCheck(job)
    }

    await this.runSynthesis(job)
  }
}
```

### 2.2 Protocol Engine

**Responsibility:**

- Select protocol based on mode and agent count
- Define round flow
- Enforce max rounds

#### 2.2.1 Protocol Types

```ts
type Protocol =
  | 'single_challenger'
  | 'reviewer_wave'
  | 'reviewer_wave_with_final_check'
```

### 2.3 Context Builder

This is one of the most critical modules — it determines what each agent sees.

**Responsibility:**

- Build the correct prompt for each agent
- Optimize context window usage (especially important for Claude)

#### 2.3.1 Context Layers

```ts
type Context = {
  pinned: {
    brief: string
    scope: JobScope
    decisionLog: DecisionLog
    protocol: string
  }

  dynamic: {
    currentRound?: Round
    previousSummary?: string
    clusters?: FindingCluster[]
  }

  evidence: EvidencePacket[]
}
```

#### 2.3.2 Evidence Packet

```ts
type EvidencePacket = {
  path: string
  relation: 'primary' | 'reference'
  reason: string
  excerpt: string
}
```

Key design choice: evidence packets contain **excerpts**, not full files. This:

- Avoids stuffing full files into context
- Reduces context size significantly
- Prevents model "stalling" on large inputs

### 2.4 Scope Guard Engine

**Responsibility:**

- Detect scope drift
- Block out-of-scope debate
- Enforce finding tagging

#### 2.4.1 Rule Check

```ts
function validateFindings(findings: Finding[]) {
  return findings.map(f => {
    if (!f.scopeType) throw Error('Missing scopeType')
    if (f.scopeType !== 'primary') {
      f.actionability = 'note_only'
    }
    return f
  })
}
```

### 2.5 Clustering Engine

**Responsibility:**

- Group overlapping findings
- Create clusters
- Reduce noise for rebuttal

#### 2.5.1 Basic Clustering (v1)

```ts
function clusterFindings(findings: Finding[]): FindingCluster[] {
  const map = new Map<string, FindingCluster>()

  for (const f of findings) {
    const key = normalize(f.title)

    if (!map.has(key)) {
      map.set(key, {
        id: key,
        theme: f.title,
        linkedFindings: [],
        scopeType: f.scopeType,
        status: 'needs_decision'
      })
    }

    map.get(key)!.linkedFindings.push({
      agentId: 'unknown',
      findingTitle: f.title
    })
  }

  return [...map.values()]
}
```

### 2.6 Synthesis Engine

**Responsibility:**

- Produce final consolidated output
- Remove duplicates
- Generate user-facing result

#### 2.6.1 Output Format

```ts
type Synthesis = {
  confirmed: FindingCluster[]
  disputed: FindingCluster[]
  followUps: Finding[]
  recommendation: string
}
```

---

## 3. Provider Layer

### 3.1 Provider Interface (Core Contract)

```ts
interface AgentProvider {
  run(input: ProviderInput): Promise<ProviderOutput>
}
```

All providers — API, CLI, Bridge — implement this single interface.

### 3.2 ProviderInput

```ts
type ProviderInput = {
  prompt: string
  role: 'architect' | 'reviewer'
  context: Context
}
```

### 3.3 ProviderOutput

```ts
type ProviderOutput = {
  raw: string
  structured?: any
  usage?: {
    tokens?: number
    cost?: number
  }
}
```

### 3.4 API Provider Example

```ts
class OpenAIProvider implements AgentProvider {
  async run(input: ProviderInput) {
    const res = await fetch('/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: buildMessages(input)
      })
    })

    return parseResponse(await res.json())
  }
}
```

### 3.5 CLI Provider Example

```ts
import { spawn } from 'child_process'

class CLIProvider implements AgentProvider {
  async run(input: ProviderInput) {
    return new Promise((resolve, reject) => {
      const proc = spawn('claude', ['--print'])

      let output = ''

      proc.stdin.write(input.prompt)
      proc.stdin.end()

      proc.stdout.on('data', (d) => {
        output += d.toString()
      })

      proc.on('close', () => {
        resolve({ raw: output })
      })
    })
  }
}
```

### 3.6 Bridge Provider Example

```ts
class HTTPBridgeProvider implements AgentProvider {
  async run(input: ProviderInput) {
    const res = await fetch('http://localhost:3001/agent', {
      method: 'POST',
      body: JSON.stringify(input)
    })

    return await res.json()
  }
}
```

---

## 4. Realtime Layer (Socket.IO)

### 4.1 Events

#### Client → Server

| Event | Description |
|-------|-------------|
| `job:create` | Create a new job |
| `job:run` | Start running a job |
| `job:cancel` | Cancel a running job |
| `agent:test` | Test agent connection |

#### Server → Client

| Event | Description |
|-------|-------------|
| `job:update` | Job state changed |
| `round:start` | A new round began |
| `round:complete` | A round finished |
| `agent:output` | Agent produced output (streaming) |
| `cluster:update` | Clusters updated |
| `synthesis:ready` | Final synthesis available |
| `error` | Error occurred |

### 4.2 Room Structure

```
room: job:{jobId}      — all clients watching a specific job
room: agent:{agentId}  — clients watching a specific agent
```

### 4.3 Streaming Agent Output

```ts
io.to(`job:${jobId}`).emit('agent:output', {
  agentId,
  chunk
})
```

---

## 5. UI Architecture

### 5.1 Screens

#### 1. Job Dashboard

- List all jobs
- Filter by status
- Quick run action

#### 2. Job Detail

- Timeline view of all rounds
- Agent outputs (expandable)
- Clustered findings
- Final synthesis

#### 3. Agent Registry

- Create / edit / delete agents
- Test connection inline

#### 4. Job Setup

- Select agents (Architect, Reviewers, Builder)
- Define scope
- Select protocol (auto or manual)

### 5.2 Timeline UI

The job detail view renders as a vertical timeline:

```
[User Brief]
    ↓
[Architect Analysis]
    ↓
[Reviewer Wave]
  ├── Reviewer A (lens: logic)
  ├── Reviewer B (lens: security)
  └── Reviewer C (lens: testing)
    ↓
[Clustered Findings]
    ↓
[Architect Rebuttal]
    ↓
[Final Synthesis]
```

### 5.3 State Management

Recommended: **Zustand** — lightweight, sufficient for this app.

Alternative: Redux Toolkit if strict state management is preferred.

---

## 6. CLI Design

### 6.1 Create Job

```bash
agent-orchestra create \
  --mode code_review \
  --scope "./modules/content" \
  --brief "Check uuid-first issue"
```

### 6.2 Add Agent

```bash
agent-orchestra agent:add \
  --role reviewer \
  --lens regression \
  --provider openai \
  --model gpt-4o
```

### 6.3 Run

```bash
agent-orchestra run <job-id>
```

### 6.4 Inspect

```bash
agent-orchestra inspect <job-id> --summary
```

---

## 7. Storage (MVP)

### 7.1 File-based Storage

For MVP, jobs are stored as flat JSON files:

```
.jobs/
  job-001/
    job.json            # Job config and metadata
    scope.json          # Scope definition
    agents.json         # Agent assignments for this job
    rounds/
      round-1.json      # Round data with agent outputs
      round-2.json
    clusters.json       # Clustered findings
    synthesis.json      # Final synthesis output
```

### 7.2 Future Upgrade Path

- **SQLite** for local persistence with query support
- **Postgres** if scaling to multi-user / hosted deployment

---

## 8. MVP Roadmap

### Phase 1 (2–3 weeks)

- Orchestrator (basic)
- 2 agents: architect + reviewer
- Code review mode
- CLI run command
- Simple UI log output

### Phase 2

- Reviewer wave (multi-agent)
- Clustering engine
- Scope guard
- Decision log

### Phase 3

- Full UI (Job Dashboard, Detail, Registry, Setup)
- Agent registry
- Provider registry
- Bridge provider support

### Phase 4

- Context optimization
- Provider profile tuning
- Resume from synthesis
- Advanced clustering (semantic)

---

## 9. Key Design Decisions

### 9.1 No reliance on model memory

The system never depends on a model "remembering" prior rounds. Instead:

- Decision log tracks all decisions
- Synthesis captures consolidated state
- Structured state is passed explicitly in every prompt

### 9.2 No infinite debate

Max 2 full rounds. After that, synthesis runs regardless.

### 9.3 Scope is hard law

Code outside defined scope = evidence only. No findings, no debates.

### 9.4 No duplicate reviewer roles

Reviewers must have distinct lenses. Two reviewers with the same lens in one job is disallowed by default.

### 9.5 Architect is always the center

All review flows through the Architect. No agent-to-agent cross-talk. This prevents chaotic multi-agent debate.
