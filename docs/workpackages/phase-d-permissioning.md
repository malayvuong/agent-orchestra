# Phase D — Permissioning + Approval (Build the Wall)

> **Duration:** ~3.5 weeks
> **Owner:** Backend/CLI Dev (1.0 FTE) + Platform Dev (1.0 FTE) + UX Designer (0.25 FTE)
> **Prerequisites:** Phase C complete, spec amendments merged
> **Objective:** Add capability-based permissions, policy engine, and human-in-the-loop approval. Unlocks `fs.write` and `net.http` for tool skills.

---

## Pre-conditions

1. **Spec amendments for sections 26, 4.10, and 24 must be merged BEFORE this phase starts.** These amendments define the Bridge layer, AgentConfig extensions, and the `awaiting_decision` UX contract.
2. **Phase C MCP client already exists** — Phase D adds write/network capabilities on top of it (the read-only MCP client from Phase C is the foundation).
3. **Streamable HTTP MCP transport** — deferred from Phase C — is delivered in this phase as part of Task D.2.

## Dependencies

| Dependency | Source | Required By |
|-----------|--------|-------------|
| Phase C MCP client (stdio + SSE transports) | `packages/core/skills/executor/` | Task D.2 |
| Skill system (loader, matcher, injector) | `packages/core/skills/` | All tasks |
| Registry client and lockfile | `packages/registry/` | Task D.4 |
| Security RFC (approved) | `docs/rfcs/rfc-001-skill-security.md` | Task D.1 |
| Spec amendments (approved and merged) | `docs/rfcs/rfc-002-spec-amendments.md` | Task D.1, D.2 |
| Threat model | `docs/rfcs/threat-model.md` | Task D.5 |

## Deliverables

1. `packages/core/skills/policy/` — Policy engine
2. `packages/core/skills/executor/executor.ts` — Skill executor (policy check, approval, MCP execution)
3. Streamable HTTP MCP transport (deferred from Phase C)
4. `awaiting_decision` UX (CLI + web dashboard)
5. Trust tier enforcement in skill loader
6. Security tests from red team plan

---

## Tasks

### Task D.1 — Policy Engine

**Goal:** Implement the capability-based policy engine that evaluates skill invocations against rules.

**Subtasks:**

- D.1.1 — **Create `packages/core/skills/policy/types.ts`:**
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

- D.1.2 — **Create `packages/core/skills/policy/engine.ts`:**
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
     * 1. System rules (non-overridable) -> deny if matched
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

- D.1.3 — **Non-overridable system rules:**
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

- D.1.4 — **Scope matching implementation:**
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

- D.1.5 — **Policy configuration file:**
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
- [ ] Policy evaluation is deterministic (same input produces same output)
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

### Task D.2 — Skill Executor

**Goal:** Orchestrate the full skill execution flow: policy check, approval (if needed), MCP call, and artifact collection. Also delivers the streamable HTTP MCP transport deferred from Phase C.

**Context:** The MCP client from Phase C provides stdio and SSE transports with read-only capabilities. This task builds the executor layer on top of that client and adds the streamable HTTP transport that was deferred.

**Subtasks:**

- D.2.1 — **Create `packages/core/skills/executor/executor.ts`:**
  ```ts
  export class SkillExecutor {
    constructor(
      private invocationManager: SkillInvocationManager,
      private policyEngine: PolicyEngine,
      private mcpClient: SkillMcpClient,    // from Phase C
      private eventBus: EventBus,            // from spec section 8.2
      private logger: Logger
    ) {}

    /**
     * Execute a skill invocation.
     * Full flow:
     * 1. Create invocation (policy evaluation happens here)
     * 2. If awaiting_approval -> emit event, return (HITL will call resume)
     * 3. If approved -> connect to MCP, execute tool, collect artifacts
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

- D.2.2 — **Execution flow detail:**
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

- D.2.3 — **Artifact-to-Finding conversion:**
  ```ts
  /**
   * Convert skill artifacts of type 'finding' into spec-compliant Finding objects.
   * These can then be fed into the existing OutputNormalizer -> ClusteringEngine pipeline.
   */
  convertArtifactToFinding(artifact: SkillArtifact): Finding | null {
    if (artifact.type !== 'finding') return null
    // Map artifact.content to Finding fields
    // Use 'skill_generated' as source indicator
  }
  ```

- D.2.4 — **Error handling and retry:**
  - MCP connection failure: retry once after 2 seconds, then fail
  - Tool call timeout: no retry (mark as timed_out)
  - Tool call error: no retry (mark as failed with error message)
  - Process crash (stdio): no retry (mark as failed, clean up process)
  - All failures logged to audit log

- D.2.5 — **Streamable HTTP MCP transport** (deferred from Phase C):
  ```ts
  class StreamableHttpMcpTransport {
    /**
     * Connect to remote MCP server via streamable HTTP.
     * Same URL validation as SSE (block RFC1918/metadata).
     * Supports bidirectional communication.
     */
    async connect(config: StreamableHttpTransportConfig): Promise<McpConnection>
  }
  ```
  This transport is added to the existing MCP client from Phase C alongside the stdio and SSE transports.

**Acceptance criteria:**
- [ ] Full execution flow works end-to-end
- [ ] Policy denial stops execution before MCP connection
- [ ] Approval flow pauses job correctly
- [ ] Resume continues from where it paused
- [ ] Artifacts collected and stored
- [ ] Finding conversion integrates with existing pipeline
- [ ] Error handling covers all failure modes
- [ ] Streamable HTTP transport connects to remote server with bidirectional communication
- [ ] Streamable HTTP transport validates URLs against policy (same rules as SSE)

**Files created:**
- `packages/core/skills/executor/executor.ts`
- `packages/core/skills/executor/executor.test.ts`
- `packages/core/skills/executor/artifact-converter.ts`
- `packages/core/skills/executor/transports/streamable-http.ts`
- `packages/core/skills/executor/transports/streamable-http.test.ts`

---

### Task D.3 — Awaiting Decision UX (CLI + Web)

**Goal:** Implement the user-facing approval flow when a skill invocation requires human approval (spec section 24).

**Subtasks:**

- D.3.1 — **CLI approval flow:**
  ```
  $ agent-orchestra run --job job-123

  [Round 2] Agent reviewer-1 requests skill execution:
    Skill: dependency-audit v1.0.0
    Tool: scan_dependencies
    Args: { "lockfile": "package-lock.json" }
    Capabilities required:
      - fs.read: ["./package-lock.json"]     <- ALLOWED by policy
      - net.http: ["api.osv.dev"]            <- REQUIRES APPROVAL

  Action: [a]pprove / [e]dit / [r]eject? > a

  Approved. Executing dependency-audit...
  Done (1.2s). Found 3 vulnerabilities.
  ```

- D.3.2 — **CLI edit flow:**
  ```
  Action: [a]pprove / [e]dit / [r]eject? > e

  Edit arguments (JSON):
  > { "lockfile": "package-lock.json", "severity": "high" }

  Re-evaluating policy... OK (all capabilities allowed).
  Executing dependency-audit...
  ```

- D.3.3 — **Web dashboard approval flow:**
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

- D.3.4 — **Non-interactive mode:**
  ```
  $ agent-orchestra run --job job-123 --auto-approve=fs.read,fs.write
  # Auto-approve fs.read and fs.write capabilities; still prompt for net.http, proc.spawn

  $ agent-orchestra run --job job-123 --deny-all
  # Deny all capability requests that need approval (never pause)
  ```

- D.3.5 — **EventBus integration:**
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

### Task D.4 — Registry Trust Tier Enforcement

**Goal:** Enforce trust tier restrictions when loading skills from the registry.

**Subtasks:**

- D.4.1 — **Trust tier to skill type restrictions:**

  | Tier | Allowed Skill Types | Policy Default |
  |------|-------------------|---------------|
  | `official` | prompt, tool, plugin | Per-skill policy |
  | `verified` | prompt, tool | tool: `require_approval` for all capabilities |
  | `community` | prompt only | No capabilities (prompt injection warning only) |
  | `experimental` | prompt only | Warning banner in context |

- D.4.2 — **Enforce at load time:**
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

- D.4.3 — **Trust tier override:**
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

### Task D.5 — Security Tests (from Red Team Plan)

**Goal:** Implement the security test cases defined in the red team plan (from the Security RFC phase).

**Subtasks:**

- D.5.1 — **SSRF prevention tests** (`tests/security/ssrf/`):
  - `localhost-access.test.ts`: tool skill tries `http://127.0.0.1` -> blocked
  - `metadata-access.test.ts`: tool skill tries `http://169.254.169.254` -> blocked
  - `rfc1918-access.test.ts`: tool skill tries `http://10.0.0.1`, `http://172.16.0.1`, `http://192.168.1.1` -> all blocked

- D.5.2 — **Policy bypass tests** (`tests/security/policy-bypass/`):
  - `escalate-capabilities.test.ts`: skill declares `fs.read` but tries `fs.write` at runtime -> blocked
  - `override-system-policy.test.ts`: policy.yaml tries to allow `127.0.0.1` -> system rule overrides

- D.5.3 — **Environment leak tests** (`tests/security/env-leak/`):
  - `stdio-env-sanitization.test.ts`: stdio process cannot see SECRET_*, API_KEY_* env vars
  - `process-env-audit.test.ts`: verify sanitized env list matches expected blocklist

- D.5.4 — **Timeout enforcement tests** (`tests/security/timeout/`):
  - `tool-call-timeout.test.ts`: tool that sleeps forever -> killed after maxExecutionMs
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

## Cross-Reference Map

| Phase D Task | Original M3 Task | Notes |
|-------------|------------------|-------|
| D.1 | 3.1 (Policy Engine) | Taken entirely |
| D.2 | 3.4 (Skill Executor) | Taken entirely; adds streamable-http transport deferred from Phase C |
| D.3 | 3.6 (Awaiting Decision UX) | Taken entirely |
| D.4 | 3.7 (Registry Trust Tier Enforcement) | Taken entirely |
| D.5 | 3.8 (Security Tests) | Taken entirely |

**M3 tasks NOT included in Phase D** (handled elsewhere):
- Task 3.2 (Skill Invocation Model) — prerequisite infrastructure, handled in Phase C or earlier
- Task 3.3 (MCP Client Implementation) — delivered in Phase C (stdio + SSE); streamable-http added here in D.2
- Task 3.5 (Protocol Pipeline Integration / Tool-Calling Loop) — handled separately as protocol-layer work

## Exit Criteria for Phase D

- [ ] Policy engine evaluates capabilities against rules correctly
- [ ] Skill executor orchestrates policy check, approval, and MCP execution end-to-end
- [ ] Streamable HTTP MCP transport connects and communicates bidirectionally
- [ ] HITL approval flow works in CLI (interactive) and web dashboard
- [ ] Non-interactive mode with `--auto-approve` and `--deny-all`
- [ ] Audit log records every skill invocation with full lifecycle
- [ ] Trust tier enforcement blocks unauthorized skill types
- [ ] All security tests from red team plan pass
- [ ] No regression in existing non-skill functionality
- [ ] Spec amendments for sections 26, 4.10, and 24 are merged
