import type { CapabilityScope, SkillCapability, SkillPolicy } from '../types.js'
import type { PolicyEvaluation } from '../policy/types.js'

/** Phase C/D — MCP and executor types */

// ---------------------------------------------------------------------------
// MCP Transport
// ---------------------------------------------------------------------------

export type McpTransport =
  | { type: 'stdio'; command: string; args: string[] }
  | { type: 'sse'; url: string }
  | { type: 'streamable-http'; url: string }

export type McpConnection = {
  id: string
  transport: McpTransport
  connected: boolean
  /** Send a JSON-RPC request and return the response */
  request: (method: string, params?: Record<string, unknown>) => Promise<unknown>
  /** Close the connection */
  close: () => Promise<void>
}

export type McpToolSchema = {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

export type McpToolResult = {
  content: string
  isError: boolean
}

// ---------------------------------------------------------------------------
// Skill Artifact
// ---------------------------------------------------------------------------

export type SkillArtifact = {
  type: 'finding' | 'file' | 'report' | 'test_result' | 'metric'
  name: string
  content: string | Record<string, unknown>
  /** If true, include in subsequent round contexts (consumes context budget) */
  includeInContext: boolean
}

// ---------------------------------------------------------------------------
// Tool Call (parsed from model output)
// ---------------------------------------------------------------------------

export type ToolCall = {
  toolName: string
  args: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Skill Invocation
// ---------------------------------------------------------------------------

export type SkillInvocationStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'awaiting_approval'
  | 'rejected'

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
  /** Phase D: policy evaluations stored for HITL approval display */
  policyEvaluations?: PolicyEvaluation[]
  timestamps: {
    createdAt: string
    startedAt?: string
    completedAt?: string
  }
}

// ---------------------------------------------------------------------------
// Skill Execution Request / Result
// ---------------------------------------------------------------------------

export type SkillExecutionRequest = {
  jobId: string
  roundIndex: number
  agentId: string
  skillId: string
  skillVersion: string
  transport: McpTransport
  toolName: string
  args: Record<string, unknown>
  /** Phase D: capability scopes for policy evaluation (replaces Phase C flat capabilities) */
  capabilityScopes: CapabilityScope[]
  /** Policy to evaluate against. Defaults to DEFAULT_POLICY if omitted. */
  policy?: SkillPolicy
  timeoutMs?: number
}

export type SkillExecutionResult = {
  invocationId: string
  status: SkillInvocationStatus
  artifacts: SkillArtifact[]
  durationMs?: number
  error?: string
}

// ---------------------------------------------------------------------------
// Audit Entry
// ---------------------------------------------------------------------------

export type ToolAuditResult = {
  truncated: boolean
  contentType: string
  content: string
  originalSizeBytes: number
}

export type ToolAuditEntry = {
  id: string
  timestamp: string
  skillId: string
  skillVersion: string
  toolName: string
  args: Record<string, unknown>
  result: ToolAuditResult
  durationMs: number | null
  outcome: 'success' | 'failure' | 'timeout' | 'denied'
  error?: string
  jobId: string
  roundIndex: number
  agentId: string
  invocationId: string
}

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

export interface SkillInvocationStore {
  save(invocation: SkillInvocation): void
  get(invocationId: string): SkillInvocation | null
  listByJob(jobId: string): SkillInvocation[]
}

// ---------------------------------------------------------------------------
// Phase D — Approval flow types
// ---------------------------------------------------------------------------

/**
 * Payload emitted when an invocation requires human-in-the-loop approval.
 *
 * Contains all information the user needs to make an informed decision:
 * the invocation context, the tool being called, and the policy
 * evaluations that triggered the approval requirement.
 */
export type AwaitingDecisionPayload = {
  invocationId: string
  skillId: string
  toolName: string
  args: Record<string, unknown>
  requiredCapabilities: SkillCapability[]
  evaluations: Array<{
    capability: SkillCapability
    action: 'allow' | 'deny' | 'require_approval'
    scope: string[]
    reason: string
  }>
}

/**
 * User decision action for an awaiting invocation.
 *
 * - `approve`  — proceed with execution as-is
 * - `edit`     — modify the arguments and re-evaluate policy
 * - `reject`   — cancel the invocation entirely
 */
export type DecisionAction = 'approve' | 'edit' | 'reject'

/**
 * User response to an awaiting decision.
 *
 * When action is `edit`, `editedArgs` contains the modified arguments
 * that will be re-evaluated against the policy before execution.
 */
export type DecisionResponse = {
  action: DecisionAction
  editedArgs?: Record<string, unknown>
  reason?: string
}
