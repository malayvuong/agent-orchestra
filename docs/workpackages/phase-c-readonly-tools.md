# Phase C — Read-only Tool Skills (MCP)

> **Duration:** ~3 weeks.
> **Owner:** Backend/CLI Dev (1.0 FTE) + Platform Dev (0.5 FTE)
> **Prerequisite:** Phase B complete
> **Objective:** Enable tool-type skills via MCP with read-only capabilities only (`fs.read`). No write, no network, no approval needed.

---

## Scope

Phase C introduces the MCP tool runtime in a strictly read-only mode. Skills can connect to MCP servers and call tools, but the only permitted capability is `fs.read`. All other capabilities (`fs.write`, `proc.spawn`, `net.http`, `secrets.read`) are unconditionally denied. There is no approval UX, no policy engine configurability, and no write-side operations. Every tool invocation is audit-logged.

## Dependencies

| Dependency | Source | Required By |
|-----------|--------|-------------|
| Phase B skill system (loader, matcher, injector) | `packages/core/skills/` | All tasks |

## Deliverables

1. `packages/core/skills/executor/mcp-client.ts` — MCP client (stdio + SSE transports)
2. `packages/core/skills/executor/invocation.ts` — Simplified skill invocation lifecycle
3. Updated protocol pipeline — tool-calling loop (read-only)
4. `packages/core/skills/executor/audit-logger.ts` — Audit logging for every tool invocation

---

## Tasks

### Task C.1 — MCP Client Implementation

**Goal:** Implement an MCP client that can connect to skill-declared MCP servers and execute tool calls. **Capabilities are restricted to `fs.read` ONLY** — the client must enforce this before any tool call is dispatched.

**Subtasks:**

- C.1.1 — **Create `packages/core/skills/executor/mcp-client.ts`:**
  ```ts
  export class SkillMcpClient {
    /**
     * Connect to an MCP server using the specified transport.
     * Only stdio and SSE transports are supported in Phase C.
     *
     * IMPORTANT: Before connecting, validate that the skill's declared
     * capabilities contain ONLY fs.read. Reject connection if any other
     * capability is declared.
     */
    async connect(
      transport: McpTransport,
      declaredCapabilities: SkillCapability[]
    ): Promise<McpConnection>

    /**
     * List available tools from a connected MCP server.
     */
    async listTools(connection: McpConnection): Promise<McpToolSchema[]>

    /**
     * Execute a tool call on a connected MCP server.
     * Enforces timeout from hardcoded maxExecutionMs (30s default).
     *
     * IMPORTANT: Before executing, verify the tool call maps to fs.read
     * capability only. Deny any tool call that would require fs.write,
     * net.http, proc.spawn, or secrets.read.
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

- C.1.2 — **Transport implementations (stdio + SSE only):**

  **stdio transport:**
  ```ts
  class StdioMcpTransport {
    /**
     * Spawn child process with command + args.
     * Communicate via stdin/stdout JSON-RPC.
     * IMPORTANT: Process runs with restricted env (no host secrets).
     */
    async connect(config: StdioTransportConfig): Promise<McpConnection> {
      // 1. Spawn process with sanitized environment:
      //    - Strip: all SECRET_*, API_KEY, TOKEN, PASSWORD env vars
      //    - Keep: PATH, HOME, NODE_PATH, LANG
      // 2. Set up JSON-RPC over stdin/stdout
      // 3. Start timeout watchdog
    }
  }
  ```

  **SSE transport:**
  ```ts
  class SseMcpTransport {
    /**
     * Connect to remote MCP server via SSE.
     * In Phase C, SSE is allowed but network capability is NOT granted —
     * this transport is available only for local MCP servers exposed via SSE
     * (e.g., localhost dev servers during testing).
     */
    async connect(config: SseTransportConfig): Promise<McpConnection> {
      // 1. Validate URL (block RFC1918/metadata IPs as safety net)
      // 2. Establish SSE connection with TLS verification
      // 3. Start timeout watchdog
    }
  }
  ```

  > **Note:** Streamable HTTP transport is deferred to a future phase.

- C.1.3 — **Connection lifecycle management:**
  ```
  1. connect() → validate capabilities are fs.read only → establish connection
  2. listTools() → fetch available tools → cache tool schemas
  3. callTool() → serialize args → send request → wait for response → deserialize
  4. disconnect() → close connection → kill stdio process (if applicable)

  Timeout enforcement:
  - connect timeout: 10 seconds (hardcoded)
  - tool call timeout: 30 seconds (hardcoded default, configurable per-skill)
  - idle timeout: 60 seconds (disconnect if no calls)
  ```

- C.1.4 — **Environment sanitization for stdio:**
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

- C.1.5 — **Process cleanup for stdio:**
  - On timeout: SIGTERM, wait 5s, SIGKILL if still alive
  - On disconnect: SIGTERM, wait 2s, SIGKILL
  - Track child PIDs; kill on Orchestrator shutdown
  - Prevent zombie processes (handle SIGCHLD)

**Acceptance criteria:**
- [ ] stdio transport: spawns process, communicates via JSON-RPC, enforces timeout, cleans up
- [ ] SSE transport: connects to server, validates URL, handles reconnection
- [ ] Environment sanitized for stdio (no secrets leaked)
- [ ] Process cleanup prevents zombies
- [ ] All transports enforce timeout
- [ ] Connection is rejected if skill declares any capability other than `fs.read`
- [ ] Tool calls that would require non-`fs.read` capabilities are denied at runtime

**Files created:**
- `packages/core/skills/executor/mcp-client.ts`
- `packages/core/skills/executor/mcp-client.test.ts`
- `packages/core/skills/executor/transports/stdio.ts`
- `packages/core/skills/executor/transports/sse.ts`
- `packages/core/skills/executor/transports/env-sanitizer.ts`

---

### Task C.2 — Skill Invocation Model (Simplified)

**Goal:** Implement a simplified `SkillInvocation` lifecycle that tracks every skill execution. No approval flow — invocations are either allowed (fs.read) or denied (everything else).

**Subtasks:**

- C.2.1 — **`SkillInvocation` type:**
  ```ts
  export type SkillInvocationStatus = 'pending' | 'running' | 'completed' | 'failed'

  export type SkillInvocation = {
    id: string
    jobId: string
    roundIndex: number
    agentId: string
    skillId: string
    resolvedVersion: string
    input: Record<string, unknown>
    status: SkillInvocationStatus
    artifacts: SkillArtifact[]
    durationMs?: number
    error?: string
    timestamps: {
      createdAt: string    // ISO 8601
      startedAt?: string
      completedAt?: string
    }
  }
  ```

- C.2.2 — **Create `packages/core/skills/executor/invocation.ts`:**
  ```ts
  export class SkillInvocationManager {
    constructor(
      private store: SkillInvocationStore,
      private logger: Logger
    ) {}

    /**
     * Create a new invocation request. Does NOT execute yet.
     * Runs hardcoded policy check: allow fs.read, deny everything else.
     * Returns the invocation with status:
     * - 'pending' if all capabilities are fs.read
     * - throws if any capability is not fs.read (denied)
     */
    create(
      jobId: string,
      roundIndex: number,
      agentId: string,
      skill: SkillDefinition,
      input: Record<string, unknown>
    ): SkillInvocation

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
  }
  ```

- C.2.3 — **`SkillInvocationStore` interface:**
  ```ts
  export interface SkillInvocationStore {
    save(invocation: SkillInvocation): void
    get(invocationId: string): SkillInvocation | null
    listByJob(jobId: string): SkillInvocation[]
    listByRound(jobId: string, roundIndex: number): SkillInvocation[]
  }
  ```
  Phase C implementation: JSON file store (alongside job data).
  Future: database store.

- C.2.4 — **Hardcoded policy check:**
  ```ts
  /**
   * Phase C policy: allow fs.read, deny everything else.
   * No configurable policy engine, no approval flow.
   * This is intentionally simple — full policy engine comes in a later phase.
   */
  function checkReadOnlyPolicy(skill: SkillDefinition): void {
    const declaredCapabilities = skill.capabilitiesRequired ?? []
    for (const cap of declaredCapabilities) {
      if (cap.capability !== 'fs.read') {
        throw new SkillPolicyDeniedError(
          `Capability '${cap.capability}' is not allowed in Phase C. ` +
          `Only 'fs.read' is permitted.`
        )
      }
    }
  }
  ```

**Acceptance criteria:**
- [ ] Full simplified lifecycle: create (pending) → run (running) → complete/fail
- [ ] Invocations with non-`fs.read` capabilities are rejected at creation time
- [ ] No approval states exist (`awaiting_approval`, `rejected` are absent)
- [ ] Invocations persisted to store (survives process restart)
- [ ] All state transitions recorded with timestamps

**Files created:**
- `packages/core/skills/executor/invocation.ts`
- `packages/core/skills/executor/invocation.test.ts`
- `packages/core/skills/executor/store.ts`

---

### Task C.3 — Protocol Pipeline Integration (Tool-Calling Loop)

**Goal:** Modify the existing protocol round pipeline to support tool calls from model output. No approval/awaiting_decision logic — tool calls either execute (fs.read) or are denied.

**Subtasks:**

- C.3.1 — **Extend `ProtocolExecutionDeps` (spec section 8.2):**
  ```ts
  // Add to existing ProtocolExecutionDeps:
  export type ProtocolExecutionDeps = {
    // ... existing deps ...
    skillLoader?: SkillLoader          // null if skills disabled
    skillExecutor?: SkillExecutor      // null if skills disabled
  }
  ```

- C.3.2 — **Add tool-calling loop to protocol round:**
  ```ts
  // In ProtocolRunner (e.g., SingleChallengerRunner):
  async executeRound(agent: AgentAssignment, job: Job, deps: ProtocolExecutionDeps) {
    // 1. Build context (includes skill injection from Phase B)
    const context = deps.contextBuilder.buildFor(agent, job)

    // 2. Run provider
    const providerOutput = await deps.providerExecutor.run(agent, context)

    // 3. Normalize output
    const normalized = deps.outputNormalizer.normalize(providerOutput, { ... })

    // 4. Check for tool calls in model output
    if (normalized.output.toolCalls && deps.skillExecutor) {
      for (const toolCall of normalized.output.toolCalls) {
        // a. Find matching skill
        const skill = this.resolveToolSkill(toolCall, job)
        if (!skill) {
          // Log warning: model requested unknown tool
          continue
        }

        // b. Execute skill (hardcoded policy: allow fs.read, deny all else)
        const result = await deps.skillExecutor.execute({
          jobId: job.id,
          roundIndex: currentRound,
          agentId: agent.id,
          skill,
          input: toolCall.args
        })

        // c. If denied (non-fs.read capability), log and skip
        if (result.status === 'failed' && result.error?.includes('not allowed')) {
          logger.warn(`Tool call denied by read-only policy: ${toolCall.toolName}`)
          continue
        }

        // d. Feed artifacts back as context for next provider call
        if (result.artifacts) {
          context.toolResults.push(...result.artifacts)
        }
      }

      // 5. Re-run provider with tool results (tool-calling loop)
      // Continue until model produces no more tool_calls or max iterations reached
    }

    // 6. Continue with existing pipeline: ScopeGuard -> Clustering -> Synthesis
  }
  ```

- C.3.3 — **Extend `AgentOutput` to support tool calls:**
  ```ts
  export type ToolCall = {
    toolName: string
    args: Record<string, unknown>
  }

  export type AgentOutput = {
    // ... existing fields ...
    toolCalls?: ToolCall[]              // Parsed tool calls from model output
    skillArtifacts?: SkillArtifact[]    // Results from skill execution
  }
  ```

- C.3.4 — **Tool-calling loop limits:**
  - Max iterations per round: 5 (configurable in `JobRuntimeConfig`)
  - Total tool calls per round: 10
  - If limits exceeded: log warning, stop tool-calling, continue with available results

- C.3.5 — **OutputNormalizer update to parse tool calls:**
  - Detect tool_calls in provider output (provider-specific format)
  - OpenAI format: `choices[0].message.tool_calls`
  - Anthropic format: `content[].type === 'tool_use'`
  - CLI format: custom parsing (future)

**Acceptance criteria:**
- [ ] Tool calls in model output trigger skill execution
- [ ] Non-`fs.read` tool calls are denied and logged (no job pause, no approval)
- [ ] Tool results fed back to model for next iteration
- [ ] Loop terminates on: no more tool_calls, max iterations, or timeout
- [ ] Existing protocol behavior unchanged when no tool calls present
- [ ] OutputNormalizer parses tool calls from OpenAI and Anthropic formats

**Files modified:**
- `packages/core/types.ts` (extend AgentOutput, ProtocolExecutionDeps)
- `packages/core/protocols/single-challenger.ts` (add tool-calling loop)
- `packages/core/output/normalizer.ts` (parse tool calls)

---

### Task C.4 — Audit Logging

**Goal:** Every tool invocation is logged with full details for observability, debugging, and future compliance. This is mandatory for all invocations regardless of outcome (success, failure, denial).

**Subtasks:**

- C.4.1 — **Create `packages/core/skills/executor/audit-logger.ts`:**
  ```ts
  export type ToolAuditEntry = {
    /** Unique ID for this audit entry */
    id: string
    /** Timestamp when the invocation was initiated (ISO 8601) */
    timestamp: string
    /** ID of the skill that owns this tool */
    skillId: string
    /** Resolved version of the skill */
    skillVersion: string
    /** Name of the MCP tool that was called */
    toolName: string
    /** Arguments passed to the tool call */
    args: Record<string, unknown>
    /** Result of the tool call (truncated if > 10KB) */
    result: ToolAuditResult
    /** Duration of the tool call in milliseconds (null if denied before execution) */
    durationMs: number | null
    /** Outcome of the invocation */
    outcome: 'success' | 'failure' | 'timeout' | 'denied'
    /** Error message if outcome is failure/timeout/denied */
    error?: string
    /** Job context */
    jobId: string
    /** Round in which the tool call occurred */
    roundIndex: number
    /** Agent that triggered the tool call */
    agentId: string
    /** Invocation ID (links to SkillInvocation) */
    invocationId: string
  }

  export type ToolAuditResult = {
    /** Whether the result was truncated */
    truncated: boolean
    /** Content type of the result */
    contentType: string
    /** Result content (string, truncated to 10KB max) */
    content: string
    /** Original size in bytes before truncation */
    originalSizeBytes: number
  }

  export class ToolAuditLogger {
    constructor(
      private logDir: string,
      private logger: Logger
    ) {}

    /**
     * Log a tool invocation. Called for EVERY invocation attempt,
     * including denied ones.
     */
    log(entry: ToolAuditEntry): void

    /**
     * Query audit logs by job ID.
     */
    queryByJob(jobId: string): ToolAuditEntry[]

    /**
     * Query audit logs by skill ID across all jobs.
     */
    queryBySkill(skillId: string): ToolAuditEntry[]

    /**
     * Query audit logs within a time range.
     */
    queryByTimeRange(from: string, to: string): ToolAuditEntry[]
  }
  ```

- C.4.2 — **Audit log storage:**
  - Logs are written as JSONL (one JSON object per line) to `<jobDir>/audit/tool-invocations.jsonl`
  - One file per job for easy correlation
  - Global index file at `.agent-orchestra/audit/index.jsonl` for cross-job queries
  - Rotation: archive files older than 30 days (configurable)

- C.4.3 — **Integration points:**
  - `SkillInvocationManager.create()` — log entry with outcome `denied` if policy check fails
  - `SkillMcpClient.callTool()` — log entry with outcome `success`, `failure`, or `timeout`
  - `SkillExecutor.execute()` — wraps timing measurement and passes to audit logger

- C.4.4 — **Result truncation:**
  ```ts
  /**
   * Truncate tool result to maxBytes (default 10KB).
   * Preserves beginning of content and appends truncation marker.
   */
  function truncateResult(content: string, maxBytes: number = 10240): ToolAuditResult {
    const originalSize = Buffer.byteLength(content, 'utf-8')
    if (originalSize <= maxBytes) {
      return { truncated: false, contentType: 'text/plain', content, originalSizeBytes: originalSize }
    }
    const truncated = content.slice(0, maxBytes) + '\n...[TRUNCATED]'
    return { truncated: true, contentType: 'text/plain', content: truncated, originalSizeBytes: originalSize }
  }
  ```

- C.4.5 — **CLI audit query command:**
  ```
  $ agent-orchestra audit --job job-123
  $ agent-orchestra audit --skill dependency-audit
  $ agent-orchestra audit --from 2026-03-01 --to 2026-03-20
  ```

**Acceptance criteria:**
- [ ] Every tool invocation (success, failure, timeout, denied) is logged
- [ ] Audit entries contain: timestamp, skill ID, tool name, args, result, duration
- [ ] Results truncated to 10KB to prevent log bloat
- [ ] Logs queryable by job ID, skill ID, and time range
- [ ] JSONL format is append-only and human-readable
- [ ] CLI command can display audit logs
- [ ] Audit logging does not block or slow down tool execution (async write)

**Files created:**
- `packages/core/skills/executor/audit-logger.ts`
- `packages/core/skills/executor/audit-logger.test.ts`

---

## Exit Criteria for Phase C

- [ ] MCP client connects via stdio and SSE transports
- [ ] Only `fs.read` capability is permitted; all other capabilities are unconditionally denied
- [ ] Tool-calling loop in protocol rounds works end-to-end for read-only tools
- [ ] No approval UX exists — denied capabilities produce a log entry and skip, never pause
- [ ] Skill invocation lifecycle is tracked: pending -> running -> completed/failed
- [ ] Every tool invocation is audit-logged with timestamp, skill ID, tool name, args, result, and duration
- [ ] Environment sanitized for stdio child processes (no secrets leaked)
- [ ] Process cleanup prevents zombie processes
- [ ] No regression in existing non-skill functionality
