# M3 — Permissioning + Tool Runtime

> **Start date:** After M2 completes (~2026-05-25). **Duration:** ~6 weeks (37 days).
> **Owner:** Backend/CLI Dev (1.0 FTE) + Platform Dev (1.0 FTE) + UX Designer (0.25 FTE)
> **Prerequisites:** M1 complete, M2 complete, M0 Security RFC approved, Spec amendments drafted

---

## Objective

Add the capability-based permission system, policy engine, human-in-the-loop approval flow, and MCP tool runtime. After M3, Agent Orchestra can execute tool-type skills (via MCP) with policy enforcement and user approval for sensitive operations.

**IMPORTANT:** This milestone requires spec amendments to §26 (Bridge), §4.10 (AgentConfig), and §24 (awaiting_decision UX). These must be drafted in M0 and approved before M3 implementation begins.

## Dependencies

| Dependency | Source | Required By |
|-----------|--------|-------------|
| M1 skill system (loader, matcher, injector) | `packages/core/skills/` | All tasks |
| M2 registry client and lockfile | `packages/registry/` | Task 3.7 |
| M0 Security RFC (approved) | `docs/rfcs/rfc-001-skill-security.md` | Task 3.1 |
| M0 Spec amendments (approved) | `docs/rfcs/rfc-002-spec-amendments.md` | Task 3.1, 3.4, 3.5 |
| M0 Threat model | `docs/rfcs/threat-model.md` | Task 3.8 |

## Deliverables

1. `packages/core/skills/policy/` — Policy engine
2. `packages/core/skills/executor/` — Skill executor (MCP client)
3. Updated protocol pipeline — tool-calling loop
4. `awaiting_decision` UX (CLI + web dashboard)
5. Audit logging for skill invocations
6. Security tests from M0 red team plan

---

## Tasks

### Task 3.1 — Policy Engine

**Goal:** Implement the capability-based policy engine that evaluates skill invocations against rules.

**Subtasks:**

- 3.1.1 — **Create `packages/core/skills/policy/types.ts`:**
  ```ts
  export type SkillCapability =
    | 'fs.read'
    | 'fs.write'
    | 'proc.spawn'
    | 'net.http'
    | 'secrets.read'

  export type CapabilityScope = {
    capability: SkillCapability
    scope: string[]
  }

  export type SkillPolicyAction = 'allow' | 'deny' | 'require_approval'

  export type SkillPolicyRule = {
    capability: SkillCapability
    action: SkillPolicyAction
    scope?: string[]
  }

  export type SkillPolicy = {
    defaultAction: 'deny'
    rules: SkillPolicyRule[]
    maxExecutionMs: number
    networkAllowed: boolean
  }

  export type PolicyEvaluation = {
    action: SkillPolicyAction
    matchedRule?: SkillPolicyRule
    capability: SkillCapability
    requestedScope: string[]
    reason: string
  }
  ```

- 3.1.2 — **Create `packages/core/skills/policy/engine.ts`:**
  ```ts
  export class PolicyEngine {
    private systemRules: NonOverridableRule[]

    constructor() {
      this.systemRules = this.initSystemRules()
    }

    /**
     * Evaluate a single capability request against a policy.
     * Returns the action to take (allow, deny, require_approval).
     *
     * Evaluation order:
     * 1. System rules (non-overridable) → deny if matched
     * 2. Policy rules (first match wins)
     * 3. Default action (deny)
     */
    evaluate(
      capability: SkillCapability,
      scope: string[],
      policy: SkillPolicy
    ): PolicyEvaluation

    /**
     * Evaluate all capabilities required by a skill invocation.
     * Returns array of evaluations — one per capability.
     * If ANY evaluation is 'deny', the invocation is blocked.
     * If ANY evaluation is 'require_approval', the invocation needs HITL.
     */
    evaluateInvocation(
      invocation: SkillInvocation,
      policy: SkillPolicy
    ): PolicyEvaluation[]

    /**
     * Merge policies in priority order:
     * 1. Skill-level (from SkillDefinition.capabilitiesRequired)
     * 2. SkillSet-level (from SkillSet.policyOverrides)
     * 3. Job-level (from JobRuntimeConfig)
     * 4. System-level (non-overridable)
     */
    mergePolicy(
      skillPolicy: SkillPolicy | undefined,
      skillSetPolicy: SkillPolicy | undefined,
      jobPolicy: SkillPolicy | undefined
    ): SkillPolicy
  }
  ```

- 3.1.3 — **Non-overridable system rules:**
  ```ts
  private initSystemRules(): NonOverridableRule[] {
    return [
      // Block all RFC1918/localhost/metadata for net.http
      { capability: 'net.http', blockedScopes: [
        '127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12',
        '192.168.0.0/16', '169.254.169.254', 'fd00::/8',
        'localhost', '0.0.0.0'
      ], reason: 'SSRF protection: internal/metadata IPs blocked' },

      // Block dangerous process commands
      { capability: 'proc.spawn', blockedScopes: [
        'rm -rf /', 'sudo *', 'chmod 777 *', 'curl * | sh',
        'eval *', 'exec *', 'pkill *', 'kill -9 *'
      ], reason: 'Dangerous command blocked' },

      // Block direct secret file access
      { capability: 'secrets.read', blockedScopes: [
        '.env', '.env.*', '~/.ssh/*', '~/.aws/credentials',
        '~/.config/gcloud/*', '**/credentials.json'
      ], reason: 'Direct secret file access blocked' },
    ]
  }
  ```

- 3.1.4 — **Scope matching implementation:**
  ```ts
  /**
   * Match a requested scope against a rule scope.
   * Supports:
   * - Exact match: "/src/index.ts" matches "/src/index.ts"
   * - Glob match: "/src/**" matches "/src/index.ts"
   * - CIDR match (net.http): "10.0.0.0/8" matches "10.1.2.3"
   * - Pattern match (proc.spawn): "npm *" matches "npm install"
   */
  matchScope(requested: string, ruleScope: string, capability: SkillCapability): boolean
  ```

- 3.1.5 — **Policy configuration file:**
  ```yaml
  # .agent-orchestra/policy.yaml
  defaultPolicy:
    defaultAction: deny
    maxExecutionMs: 30000
    networkAllowed: false
    rules:
      - capability: fs.read
        action: allow
        scope: ["./src/**", "./tests/**"]
      - capability: fs.write
        action: require_approval
        scope: ["./src/**"]
      - capability: proc.spawn
        action: allow
        scope: ["npm test", "npm run lint"]
      - capability: net.http
        action: deny
  ```

**Acceptance criteria:**
- [ ] Policy evaluation is deterministic (same input → same output)
- [ ] System rules cannot be overridden by any policy level
- [ ] Policy merge follows documented priority order
- [ ] Scope matching works for globs, CIDRs, and patterns
- [ ] All 5 capability types handled
- [ ] SSRF protection blocks all RFC1918/metadata addresses
- [ ] Policy loads from `policy.yaml` configuration

**Files created:**
- `packages/core/skills/policy/types.ts`
- `packages/core/skills/policy/engine.ts`
- `packages/core/skills/policy/engine.test.ts`
- `packages/core/skills/policy/scope-matcher.ts`
- `packages/core/skills/policy/scope-matcher.test.ts`
- `packages/core/skills/policy/system-rules.ts`
- `packages/core/skills/policy/config-loader.ts`

---

### Task 3.2 — Skill Invocation Model

**Goal:** Implement the `SkillInvocation` lifecycle that tracks every skill execution.

**Subtasks:**

- 3.2.1 — **Create `packages/core/skills/executor/invocation.ts`:**
  ```ts
  export class SkillInvocationManager {
    constructor(
      private store: SkillInvocationStore,
      private policyEngine: PolicyEngine,
      private logger: Logger
    ) {}

    /**
     * Create a new invocation request. Does NOT execute yet.
     * Runs policy evaluation and returns the invocation with status:
     * - 'pending' if all capabilities allowed
     * - 'awaiting_approval' if any capability needs approval
     * - 'rejected' if any capability denied
     */
    create(
      jobId: string,
      roundIndex: number,
      agentId: string,
      skill: SkillDefinition,
      input: Record<string, unknown>,
      effectivePolicy: SkillPolicy
    ): SkillInvocation

    /**
     * Approve a pending invocation (from HITL flow).
     */
    approve(invocationId: string, approvedBy: string): SkillInvocation

    /**
     * Approve with edited arguments (from HITL flow).
     */
    approveWithEdits(
      invocationId: string,
      editedInput: Record<string, unknown>,
      approvedBy: string
    ): SkillInvocation

    /**
     * Reject an invocation (from HITL flow).
     */
    reject(invocationId: string, reason: string): SkillInvocation

    /**
     * Mark invocation as running (called by executor).
     */
    markRunning(invocationId: string): void

    /**
     * Mark invocation as completed with artifacts.
     */
    markCompleted(invocationId: string, artifacts: SkillArtifact[], durationMs: number): void

    /**
     * Mark invocation as failed.
     */
    markFailed(invocationId: string, error: string): void

    /**
     * Mark invocation as timed out.
     */
    markTimedOut(invocationId: string): void
  }
  ```

- 3.2.2 — **`SkillInvocationStore` interface:**
  ```ts
  export interface SkillInvocationStore {
    save(invocation: SkillInvocation): void
    get(invocationId: string): SkillInvocation | null
    listByJob(jobId: string): SkillInvocation[]
    listByRound(jobId: string, roundIndex: number): SkillInvocation[]
  }
  ```
  M3 implementation: JSON file store (alongside job data).
  Future: database store.

- 3.2.3 — **Audit log format:**
  ```json
  {
    "id": "inv-001",
    "jobId": "job-123",
    "roundIndex": 1,
    "agentId": "reviewer-1",
    "skillId": "dependency-audit",
    "resolvedVersion": "1.0.0",
    "resolvedPolicy": { "...": "..." },
    "input": { "targetFile": "package.json" },
    "status": "completed",
    "artifacts": [
      {
        "type": "report",
        "name": "dependency-audit-result",
        "content": "Found 3 vulnerabilities...",
        "includeInContext": true
      }
    ],
    "durationMs": 2340,
    "auditLog": {
      "requestedAt": "2026-06-01T10:00:00Z",
      "approvedAt": "2026-06-01T10:00:05Z",
      "approvedBy": "policy_auto",
      "startedAt": "2026-06-01T10:00:05Z",
      "completedAt": "2026-06-01T10:00:07Z"
    }
  }
  ```

**Acceptance criteria:**
- [ ] Full lifecycle management: create → approve/reject → run → complete/fail/timeout
- [ ] Audit log records every state transition with timestamps
- [ ] Invocations persisted to store (survives process restart)
- [ ] Policy evaluation integrated into creation step

**Files created:**
- `packages/core/skills/executor/invocation.ts`
- `packages/core/skills/executor/invocation.test.ts`
- `packages/core/skills/executor/store.ts`

---

### Task 3.3 — MCP Client Implementation

**Goal:** Implement an MCP client that can connect to skill-declared MCP servers and execute tool calls.

**Subtasks:**

- 3.3.1 — **Create `packages/core/skills/executor/mcp-client.ts`:**
  ```ts
  export class SkillMcpClient {
    /**
     * Connect to an MCP server using the specified transport.
     * Validates transport against policy before connecting.
     */
    async connect(
      transport: McpTransport,
      policy: SkillPolicy
    ): Promise<McpConnection>

    /**
     * List available tools from a connected MCP server.
     */
    async listTools(connection: McpConnection): Promise<McpToolSchema[]>

    /**
     * Execute a tool call on a connected MCP server.
     * Enforces timeout from policy.maxExecutionMs.
     */
    async callTool(
      connection: McpConnection,
      toolName: string,
      args: Record<string, unknown>,
      timeoutMs: number
    ): Promise<McpToolResult>

    /**
     * Disconnect from an MCP server.
     * Ensures cleanup of stdio processes.
     */
    async disconnect(connection: McpConnection): Promise<void>
  }
  ```

- 3.3.2 — **Transport implementations:**

  **stdio transport:**
  ```ts
  class StdioMcpTransport {
    /**
     * Spawn child process with command + args.
     * Communicate via stdin/stdout JSON-RPC.
     * IMPORTANT: Process runs with restricted env (no host secrets).
     */
    async connect(config: StdioTransportConfig): Promise<McpConnection> {
      // 1. Validate command against proc.spawn policy
      // 2. Spawn process with sanitized environment:
      //    - Strip: all SECRET_*, API_KEY, TOKEN, PASSWORD env vars
      //    - Keep: PATH, HOME, NODE_PATH, LANG
      // 3. Set up JSON-RPC over stdin/stdout
      // 4. Start timeout watchdog
    }
  }
  ```

  **SSE transport:**
  ```ts
  class SseMcpTransport {
    /**
     * Connect to remote MCP server via SSE.
     * Validates URL against net.http policy (domain allowlist, block RFC1918).
     */
    async connect(config: SseTransportConfig): Promise<McpConnection> {
      // 1. Validate URL against net.http policy
      // 2. Verify not RFC1918/metadata (system rule)
      // 3. Establish SSE connection with TLS verification
      // 4. Start timeout watchdog
    }
  }
  ```

  **Streamable HTTP transport:**
  ```ts
  class StreamableHttpMcpTransport {
    /**
     * Connect to remote MCP server via streamable HTTP.
     * Same URL validation as SSE.
     */
    async connect(config: StreamableHttpTransportConfig): Promise<McpConnection>
  }
  ```

- 3.3.3 — **Connection lifecycle management:**
  ```
  1. connect() → validate transport against policy → establish connection
  2. listTools() → fetch available tools → cache tool schemas
  3. callTool() → serialize args → send request → wait for response → deserialize
  4. disconnect() → close connection → kill stdio process (if applicable)

  Timeout enforcement:
  - connect timeout: 10 seconds (hardcoded)
  - tool call timeout: SkillPolicy.maxExecutionMs (default 30s)
  - idle timeout: 60 seconds (disconnect if no calls)
  ```

- 3.3.4 — **Environment sanitization for stdio:**
  ```ts
  function sanitizeEnvironment(env: Record<string, string>): Record<string, string> {
    const blocked = /^(SECRET|API_KEY|TOKEN|PASSWORD|PRIVATE_KEY|AWS_|GH_|GITHUB_TOKEN)/i
    const result: Record<string, string> = {}
    for (const [key, value] of Object.entries(env)) {
      if (!blocked.test(key)) {
        result[key] = value
      }
    }
    return result
  }
  ```

- 3.3.5 — **Process cleanup for stdio:**
  - On timeout: SIGTERM, wait 5s, SIGKILL if still alive
  - On disconnect: SIGTERM, wait 2s, SIGKILL
  - Track child PIDs; kill on Orchestrator shutdown
  - Prevent zombie processes (handle SIGCHLD)

**Acceptance criteria:**
- [ ] stdio transport: spawns process, communicates via JSON-RPC, enforces timeout, cleans up
- [ ] SSE transport: connects to remote server, validates URL, handles reconnection
- [ ] streamable-http transport: connects to remote server, bidirectional communication
- [ ] Environment sanitized for stdio (no secrets leaked)
- [ ] Process cleanup prevents zombies
- [ ] All transports enforce `maxExecutionMs` timeout

**Files created:**
- `packages/core/skills/executor/mcp-client.ts`
- `packages/core/skills/executor/mcp-client.test.ts`
- `packages/core/skills/executor/transports/stdio.ts`
- `packages/core/skills/executor/transports/sse.ts`
- `packages/core/skills/executor/transports/streamable-http.ts`
- `packages/core/skills/executor/transports/env-sanitizer.ts`

---

### Task 3.4 — Skill Executor

**Goal:** Orchestrate the full skill execution flow: policy check → approval (if needed) → MCP call → artifact collection.

**Subtasks:**

- 3.4.1 — **Create `packages/core/skills/executor/executor.ts`:**
  ```ts
  export class SkillExecutor {
    constructor(
      private invocationManager: SkillInvocationManager,
      private policyEngine: PolicyEngine,
      private mcpClient: SkillMcpClient,
      private eventBus: EventBus,      // from spec §8.2
      private logger: Logger
    ) {}

    /**
     * Execute a skill invocation.
     * Full flow:
     * 1. Create invocation (policy evaluation happens here)
     * 2. If awaiting_approval → emit event, return (HITL will call resume)
     * 3. If approved → connect to MCP, execute tool, collect artifacts
     * 4. Return artifacts
     */
    async execute(request: SkillExecutionRequest): Promise<SkillExecutionResult>

    /**
     * Resume a paused invocation after HITL approval.
     */
    async resume(invocationId: string): Promise<SkillExecutionResult>

    /**
     * Convert tool results to SkillArtifacts.
     */
    private convertToArtifacts(
      toolResult: McpToolResult,
      skill: SkillDefinition
    ): SkillArtifact[]
  }
  ```

- 3.4.2 — **Execution flow detail:**
  ```mermaid
  flowchart TB
    A[SkillExecutor.execute] --> B[InvocationManager.create]
    B --> C{Policy result?}
    C -->|all allowed| D[Connect MCP]
    C -->|needs approval| E[Emit awaiting_decision event]
    C -->|denied| F[Return rejection]
    E --> G[Job paused — awaiting HITL]
    G -->|user approves| H[SkillExecutor.resume]
    G -->|user edits args| I[Re-evaluate policy with new args]
    G -->|user rejects| J[Return rejection]
    I --> D
    H --> D
    D --> K[MCP listTools]
    K --> L[MCP callTool with timeout]
    L --> M{Result?}
    M -->|success| N[Convert to SkillArtifacts]
    M -->|timeout| O[Mark timed_out]
    M -->|error| P[Mark failed]
    N --> Q[Mark completed, return artifacts]
  ```

- 3.4.3 — **Artifact-to-Finding conversion:**
  ```ts
  /**
   * Convert skill artifacts of type 'finding' into spec-compliant Finding objects.
   * These can then be fed into the existing OutputNormalizer → ClusteringEngine pipeline.
   */
  convertArtifactToFinding(artifact: SkillArtifact): Finding | null {
    if (artifact.type !== 'finding') return null
    // Map artifact.content to Finding fields
    // Use 'skill_generated' as source indicator
  }
  ```

- 3.4.4 — **Error handling and retry:**
  - MCP connection failure: retry once after 2 seconds, then fail
  - Tool call timeout: no retry (mark as timed_out)
  - Tool call error: no retry (mark as failed with error message)
  - Process crash (stdio): no retry (mark as failed, clean up process)
  - All failures logged to audit log

**Acceptance criteria:**
- [ ] Full execution flow works end-to-end
- [ ] Policy denial stops execution before MCP connection
- [ ] Approval flow pauses job correctly
- [ ] Resume continues from where it paused
- [ ] Artifacts collected and stored
- [ ] Finding conversion integrates with existing pipeline
- [ ] Error handling covers all failure modes

**Files created:**
- `packages/core/skills/executor/executor.ts`
- `packages/core/skills/executor/executor.test.ts`
- `packages/core/skills/executor/artifact-converter.ts`

---

### Task 3.5 — Protocol Pipeline Integration (Tool-Calling Loop)

**Goal:** Modify the existing protocol round pipeline to support tool calls from model output.

**Subtasks:**

- 3.5.1 — **Extend `ProtocolExecutionDeps` (spec §8.2):**
  ```ts
  // Add to existing ProtocolExecutionDeps:
  export type ProtocolExecutionDeps = {
    // ... existing deps ...
    skillLoader?: SkillLoader          // null if skills disabled
    skillExecutor?: SkillExecutor      // null if skills disabled
    policyEngine?: PolicyEngine        // null if skills disabled
  }
  ```

- 3.5.2 — **Add tool-calling loop to protocol round:**
  ```ts
  // In ProtocolRunner (e.g., SingleChallengerRunner):
  async executeRound(agent: AgentAssignment, job: Job, deps: ProtocolExecutionDeps) {
    // 1. Build context (includes skill injection from M1)
    const context = deps.contextBuilder.buildFor(agent, job)

    // 2. Run provider
    const providerOutput = await deps.providerExecutor.run(agent, context)

    // 3. Normalize output
    const normalized = deps.outputNormalizer.normalize(providerOutput, { ... })

    // 4. NEW: Check for tool calls in model output
    if (normalized.output.toolCalls && deps.skillExecutor) {
      for (const toolCall of normalized.output.toolCalls) {
        // a. Find matching skill
        const skill = this.resolveToolSkill(toolCall, job)
        if (!skill) {
          // Log warning: model requested unknown tool
          continue
        }

        // b. Execute skill (includes policy check + HITL)
        const result = await deps.skillExecutor.execute({
          jobId: job.id,
          roundIndex: currentRound,
          agentId: agent.id,
          skill,
          input: toolCall.args
        })

        // c. If awaiting approval → job pauses (status = awaiting_decision)
        if (result.status === 'awaiting_approval') {
          await deps.jobStore.updateStatus(job.id, 'awaiting_decision')
          return // round will resume when approval comes
        }

        // d. Feed artifacts back as context for next provider call
        if (result.artifacts) {
          context.toolResults.push(...result.artifacts)
        }
      }

      // 5. Re-run provider with tool results (tool-calling loop)
      // Continue until model produces no more tool_calls or max iterations reached
    }

    // 6. Continue with existing pipeline: ScopeGuard → Clustering → Synthesis
  }
  ```

- 3.5.3 — **Extend `AgentOutput` to support tool calls:**
  ```ts
  // Add to spec §4.10 AgentOutput:
  export type ToolCall = {
    toolName: string
    args: Record<string, unknown>
  }

  export type AgentOutput = {
    // ... existing fields ...
    toolCalls?: ToolCall[]              // NEW: parsed tool calls from model output
    skillArtifacts?: SkillArtifact[]    // NEW: results from skill execution
  }
  ```

- 3.5.4 — **Tool-calling loop limits:**
  - Max iterations per round: 5 (configurable in `JobRuntimeConfig`)
  - Total tool calls per round: 10
  - If limits exceeded: log warning, stop tool-calling, continue with available results

- 3.5.5 — **OutputNormalizer update to parse tool calls:**
  - Detect tool_calls in provider output (provider-specific format)
  - OpenAI format: `choices[0].message.tool_calls`
  - Anthropic format: `content[].type === 'tool_use'`
  - CLI format: custom parsing (future)

**Acceptance criteria:**
- [ ] Tool calls in model output trigger skill execution
- [ ] Approval-required skills pause the job correctly
- [ ] Tool results fed back to model for next iteration
- [ ] Loop terminates on: no more tool_calls, max iterations, or timeout
- [ ] Existing protocol behavior unchanged when no tool calls present
- [ ] OutputNormalizer parses tool calls from OpenAI and Anthropic formats

**Files modified:**
- `packages/core/types.ts` (extend AgentOutput, ProtocolExecutionDeps)
- `packages/core/protocols/single-challenger.ts` (add tool-calling loop)
- `packages/core/output/normalizer.ts` (parse tool calls)

---

### Task 3.6 — Awaiting Decision UX (CLI + Web)

**Goal:** Implement the user-facing approval flow when a skill invocation requires human approval.

**Subtasks:**

- 3.6.1 — **CLI approval flow:**
  ```
  $ agent-orchestra run --job job-123

  [Round 2] Agent reviewer-1 requests skill execution:
    Skill: dependency-audit v1.0.0
    Tool: scan_dependencies
    Args: { "lockfile": "package-lock.json" }
    Capabilities required:
      - fs.read: ["./package-lock.json"]     ← ALLOWED by policy
      - net.http: ["api.osv.dev"]            ← REQUIRES APPROVAL

  Action: [a]pprove / [e]dit / [r]eject? > a

  Approved. Executing dependency-audit...
  Done (1.2s). Found 3 vulnerabilities.
  ```

- 3.6.2 — **CLI edit flow:**
  ```
  Action: [a]pprove / [e]dit / [r]eject? > e

  Edit arguments (JSON):
  > { "lockfile": "package-lock.json", "severity": "high" }

  Re-evaluating policy... OK (all capabilities allowed).
  Executing dependency-audit...
  ```

- 3.6.3 — **Web dashboard approval flow:**
  ```
  Endpoint: GET /api/jobs/:jobId/decisions
  Response: {
    invocations: [{
      id: "inv-001",
      skillId: "dependency-audit",
      toolName: "scan_dependencies",
      args: { "lockfile": "package-lock.json" },
      requiredCapabilities: [
        { capability: "fs.read", scope: ["./package-lock.json"], evaluation: "allowed" },
        { capability: "net.http", scope: ["api.osv.dev"], evaluation: "require_approval" }
      ]
    }]
  }

  Endpoint: POST /api/jobs/:jobId/decisions/:invocationId
  Body: { action: "approve" | "edit" | "reject", editedArgs?: {...}, reason?: "..." }
  ```

- 3.6.4 — **Non-interactive mode:**
  ```
  $ agent-orchestra run --job job-123 --auto-approve=fs.read,fs.write
  # Auto-approve fs.read and fs.write capabilities; still prompt for net.http, proc.spawn

  $ agent-orchestra run --job job-123 --deny-all
  # Deny all capability requests that need approval (never pause)
  ```

- 3.6.5 — **EventBus integration:**
  - Emit `skill:awaiting_approval` event when invocation needs approval
  - Emit `skill:approved` / `skill:rejected` event when user decides
  - Web dashboard subscribes via WebSocket for real-time updates

**Acceptance criteria:**
- [ ] CLI interactive approval works (approve/edit/reject)
- [ ] Web dashboard shows pending decisions with capability details
- [ ] Web dashboard POST endpoint processes decisions
- [ ] Non-interactive mode with `--auto-approve` and `--deny-all` flags
- [ ] EventBus events emitted correctly
- [ ] Job resumes after approval, terminates skill after rejection

**Files modified:**
- `apps/cli/` (add approval prompts)
- `apps/server/` (add decision endpoints + WebSocket events)

---

### Task 3.7 — Registry Trust Tier Enforcement

**Goal:** Enforce trust tier restrictions when loading skills from the registry.

**Subtasks:**

- 3.7.1 — **Trust tier to skill type restrictions:**

  | Tier | Allowed Skill Types | Policy Default |
  |------|-------------------|---------------|
  | `official` | prompt, tool, plugin | Per-skill policy |
  | `verified` | prompt, tool | tool: `require_approval` for all capabilities |
  | `community` | prompt only | No capabilities (prompt injection warning only) |
  | `experimental` | prompt only | Warning banner in context |

- 3.7.2 — **Enforce at load time:**
  ```ts
  // In SkillLoader:
  if (skill.source.type === 'registry') {
    const tier = registryEntry.trustTier
    if (skill.skillType === 'tool' && tier === 'community') {
      logger.error(`Skill ${skill.id}: tool skills require 'verified' or higher trust tier`)
      // Skip this skill
    }
    if (skill.skillType === 'plugin' && tier !== 'official') {
      logger.error(`Skill ${skill.id}: plugin skills require 'official' trust tier`)
      // Skip this skill
    }
  }
  ```

- 3.7.3 — **Trust tier override:**
  ```yaml
  # .agent-orchestra/config.yaml
  trustOverrides:
    # Promote a community skill to verified (user takes responsibility)
    my-custom-scanner: verified
  ```

**Acceptance criteria:**
- [ ] Trust tiers enforced at load time
- [ ] Invalid type/tier combinations blocked with clear error
- [ ] Override mechanism works for explicit trust elevation

**Files modified:**
- `packages/core/skills/loader.ts`
- `packages/core/skills/policy/trust-tier.ts` (new)

---

### Task 3.8 — Security Tests (from M0 Red Team Plan)

**Goal:** Implement the security test cases defined in M0 Task 0.5.

**Subtasks:**

- 3.8.1 — **SSRF prevention tests** (`tests/security/ssrf/`):
  - `localhost-access.test.ts`: tool skill tries `http://127.0.0.1` → blocked
  - `metadata-access.test.ts`: tool skill tries `http://169.254.169.254` → blocked
  - `rfc1918-access.test.ts`: tool skill tries `http://10.0.0.1`, `http://172.16.0.1`, `http://192.168.1.1` → all blocked

- 3.8.2 — **Policy bypass tests** (`tests/security/policy-bypass/`):
  - `escalate-capabilities.test.ts`: skill declares `fs.read` but tries `fs.write` at runtime → blocked
  - `override-system-policy.test.ts`: policy.yaml tries to allow `127.0.0.1` → system rule overrides

- 3.8.3 — **Environment leak tests** (`tests/security/env-leak/`):
  - `stdio-env-sanitization.test.ts`: stdio process cannot see SECRET_*, API_KEY_* env vars
  - `process-env-audit.test.ts`: verify sanitized env list matches expected blocklist

- 3.8.4 — **Timeout enforcement tests** (`tests/security/timeout/`):
  - `tool-call-timeout.test.ts`: tool that sleeps forever → killed after maxExecutionMs
  - `stdio-process-cleanup.test.ts`: timed-out stdio process is properly killed (no zombie)

**Acceptance criteria:**
- [ ] All SSRF tests pass (all internal IPs blocked)
- [ ] All policy bypass tests pass (escalation impossible)
- [ ] All environment leak tests pass (no secrets in child process)
- [ ] All timeout tests pass (processes killed, no zombies)
- [ ] Tests run in CI (<60 seconds total)

**Files created:**
- `tests/security/ssrf/*.test.ts`
- `tests/security/policy-bypass/*.test.ts`
- `tests/security/env-leak/*.test.ts`
- `tests/security/timeout/*.test.ts`

---

## Exit Criteria for M3

- [ ] Policy engine evaluates capabilities against rules correctly
- [ ] MCP client connects via stdio, SSE, and streamable-http
- [ ] Tool-calling loop in protocol rounds works end-to-end
- [ ] HITL approval flow works in CLI (interactive) and web dashboard
- [ ] Non-interactive mode with `--auto-approve` and `--deny-all`
- [ ] Audit log records every skill invocation with full lifecycle
- [ ] Trust tier enforcement blocks unauthorized skill types
- [ ] All security tests from M0 pass
- [ ] No regression in existing non-skill functionality
- [ ] Spec amendments for §26, §4.10, §24 are merged
