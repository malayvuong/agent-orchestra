import { randomUUID } from 'node:crypto'
import type {
  McpConnection,
  McpToolResult,
  McpTransport,
  SkillArtifact,
  SkillExecutionRequest,
  SkillExecutionResult,
  SkillInvocation,
  ToolAuditEntry,
  DecisionResponse,
  AwaitingDecisionPayload,
} from './types.js'
import type { CapabilityScope, SkillCapability } from '../types.js'
import type { SkillInvocationManager } from './invocation.js'
import { SkillPolicyDeniedError } from './invocation.js'
import { ToolAuditLogger } from './audit-logger.js'

// ---------------------------------------------------------------------------
// Logger interface
// ---------------------------------------------------------------------------

/** Logger interface for warnings and errors */
interface Logger {
  warn: (msg: string) => void
  error: (msg: string) => void
}

// ---------------------------------------------------------------------------
// MCP Client interface (duck-typed so executor is not coupled to a concrete
// implementation — the real SkillMcpClient is injected at runtime)
// ---------------------------------------------------------------------------

/**
 * Minimal MCP client contract required by the executor.
 * Matches the public API of `SkillMcpClient` from `mcp-client.ts`.
 */
interface McpClient {
  connect(transport: McpTransport, declaredCapabilities: SkillCapability[]): Promise<McpConnection>
  callTool(
    connection: McpConnection,
    toolName: string,
    args: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<McpToolResult>
  disconnect(connection: McpConnection): Promise<void>
}

// ---------------------------------------------------------------------------
// Event emitter interface (duck-typed for approval flow)
// ---------------------------------------------------------------------------

/**
 * Minimal event bus contract for emitting approval events.
 * The executor emits events but does not depend on a concrete implementation.
 */
export interface SkillEventEmitter {
  emit(event: 'skill:awaiting_approval', payload: AwaitingDecisionPayload): void
  emit(event: 'skill:approved', payload: { invocationId: string }): void
  emit(event: 'skill:rejected', payload: { invocationId: string; reason?: string }): void
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default tool call timeout when not specified in the request */
const DEFAULT_TIMEOUT_MS = 30_000

// ---------------------------------------------------------------------------
// SkillExecutor
// ---------------------------------------------------------------------------

/**
 * Orchestrates the full lifecycle of a single skill (tool) execution:
 *
 * 1. Create invocation via {@link SkillInvocationManager} (policy evaluation)
 * 2. If denied → return rejection with audit log
 * 3. If awaiting_approval → emit event, return (HITL will call resume)
 * 4. If allowed → connect to MCP, execute tool, collect artifacts
 * 5. Mark invocation completed / failed
 * 6. Write an audit log entry
 * 7. Disconnect from the MCP server
 */
export class SkillExecutor {
  constructor(
    private readonly invocationManager: SkillInvocationManager,
    private readonly mcpClient: McpClient,
    private readonly auditLogger: ToolAuditLogger,
    private readonly logger?: Logger,
    private readonly eventEmitter?: SkillEventEmitter,
  ) {}

  /**
   * Execute a skill tool call end-to-end.
   *
   * @param request  Fully-resolved execution request including transport,
   *                 tool name, arguments, and capability scopes.
   * @returns        Execution result with invocation ID, status, artifacts,
   *                 duration, and optional error.
   */
  async execute(request: SkillExecutionRequest): Promise<SkillExecutionResult> {
    const {
      jobId,
      roundIndex,
      agentId,
      skillId,
      skillVersion,
      transport,
      toolName,
      args,
      capabilityScopes,
      policy,
      timeoutMs = DEFAULT_TIMEOUT_MS,
    } = request

    // ------------------------------------------------------------------
    // 1. Create invocation (runs policy evaluation)
    // ------------------------------------------------------------------
    let invocation: SkillInvocation

    try {
      invocation = this.invocationManager.create(
        jobId,
        roundIndex,
        agentId,
        skillId,
        skillVersion,
        capabilityScopes,
        args,
        policy,
      )
    } catch (err) {
      if (err instanceof SkillPolicyDeniedError) {
        const deniedId = randomUUID()
        this.logger?.warn?.(`Skill ${skillId} denied by policy: ${err.message}`)

        // Audit log the denial
        await this.auditLogger.log(
          this.buildAuditEntry({
            id: deniedId,
            invocationId: deniedId,
            jobId,
            roundIndex,
            agentId,
            skillId,
            skillVersion,
            toolName,
            args,
            outcome: 'denied',
            error: err.message,
            durationMs: null,
            resultContent: '',
          }),
        )

        return {
          invocationId: deniedId,
          status: 'failed',
          artifacts: [],
          error: err.message,
        }
      }
      throw err
    }

    // ------------------------------------------------------------------
    // 2. Check if approval is required
    // ------------------------------------------------------------------
    if (invocation.status === 'awaiting_approval') {
      this.logger?.warn?.(`Skill ${skillId} requires approval — invocation ${invocation.id} paused`)

      // Emit event for UX layer
      if (this.eventEmitter) {
        const approvalEvals = (invocation.policyEvaluations ?? []).map((e) => ({
          capability: e.capability,
          action: e.action,
          scope: e.requestedScope,
          reason: e.reason,
        }))

        this.eventEmitter.emit('skill:awaiting_approval', {
          invocationId: invocation.id,
          skillId,
          toolName,
          args,
          requiredCapabilities: capabilityScopes.map((cs) => cs.capability),
          evaluations: approvalEvals,
        })
      }

      return {
        invocationId: invocation.id,
        status: 'awaiting_approval',
        artifacts: [],
      }
    }

    // ------------------------------------------------------------------
    // 3. Execute the tool (invocation status is 'pending')
    // ------------------------------------------------------------------
    return this.executeToolCall(invocation.id, {
      transport,
      toolName,
      args,
      capabilityScopes,
      timeoutMs,
      jobId,
      roundIndex,
      agentId,
      skillId,
      skillVersion,
    })
  }

  /**
   * Resume a paused invocation after HITL approval.
   *
   * @param invocationId  The invocation to resume.
   * @param decision      The user's decision (approve, edit, or reject).
   * @param transport     MCP transport config (needed for execution).
   * @param timeoutMs     Tool call timeout.
   * @returns             Execution result.
   */
  async resume(
    invocationId: string,
    decision: DecisionResponse,
    transport: McpTransport,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<SkillExecutionResult> {
    const invocation = this.invocationManager.get(invocationId)
    if (!invocation) {
      throw new Error(`Invocation ${invocationId} not found`)
    }

    if (invocation.status !== 'awaiting_approval') {
      throw new Error(
        `Cannot resume invocation ${invocationId}: status is '${invocation.status}', expected 'awaiting_approval'`,
      )
    }

    // Handle rejection
    if (decision.action === 'reject') {
      this.invocationManager.markRejected(invocationId, decision.reason)

      if (this.eventEmitter) {
        this.eventEmitter.emit('skill:rejected', {
          invocationId,
          reason: decision.reason,
        })
      }

      return {
        invocationId,
        status: 'rejected',
        artifacts: [],
        error: decision.reason ?? 'Rejected by user',
      }
    }

    // Handle approval (with optional argument edits)
    const editedArgs = decision.action === 'edit' ? decision.editedArgs : undefined
    this.invocationManager.markApproved(invocationId, editedArgs)

    if (this.eventEmitter) {
      this.eventEmitter.emit('skill:approved', { invocationId })
    }

    const effectiveArgs = editedArgs ?? invocation.input
    const capabilityScopes: CapabilityScope[] = (invocation.policyEvaluations ?? []).map((e) => ({
      capability: e.capability,
      scope: e.requestedScope,
    }))

    return this.executeToolCall(invocationId, {
      transport,
      toolName: (invocation.input._toolName as string) ?? 'unknown',
      args: effectiveArgs,
      capabilityScopes,
      timeoutMs,
      jobId: invocation.jobId,
      roundIndex: invocation.roundIndex,
      agentId: invocation.agentId,
      skillId: invocation.skillId,
      skillVersion: invocation.resolvedVersion,
    })
  }

  // -----------------------------------------------------------------------
  // Internal: execute MCP tool call
  // -----------------------------------------------------------------------

  private async executeToolCall(
    invocationId: string,
    params: {
      transport: McpTransport
      toolName: string
      args: Record<string, unknown>
      capabilityScopes: CapabilityScope[]
      timeoutMs: number
      jobId: string
      roundIndex: number
      agentId: string
      skillId: string
      skillVersion: string
    },
  ): Promise<SkillExecutionResult> {
    const {
      transport,
      toolName,
      args,
      capabilityScopes,
      timeoutMs,
      jobId,
      roundIndex,
      agentId,
      skillId,
      skillVersion,
    } = params

    // Mark running
    this.invocationManager.markRunning(invocationId)

    const startTime = Date.now()
    let connection: McpConnection | null = null

    // Extract flat capabilities for MCP client (transport-level validation)
    const declaredCapabilities = capabilityScopes.map((cs) => cs.capability)

    try {
      // Connect to MCP server
      connection = await this.mcpClient.connect(transport, declaredCapabilities)

      // Call tool via MCP
      const toolResult: McpToolResult = await this.mcpClient.callTool(
        connection,
        toolName,
        args,
        timeoutMs,
      )

      const durationMs = Date.now() - startTime

      // Build artifact from result
      const artifact: SkillArtifact = {
        type: 'finding',
        name: `${toolName}-result`,
        content: toolResult.content,
        includeInContext: !toolResult.isError,
      }
      const artifacts: SkillArtifact[] = [artifact]

      // Mark completed + audit log
      this.invocationManager.markCompleted(invocationId, artifacts, durationMs)

      await this.auditLogger.log(
        this.buildAuditEntry({
          id: randomUUID(),
          invocationId,
          jobId,
          roundIndex,
          agentId,
          skillId,
          skillVersion,
          toolName,
          args,
          outcome: toolResult.isError ? 'failure' : 'success',
          error: toolResult.isError ? toolResult.content : undefined,
          durationMs,
          resultContent: toolResult.content,
        }),
      )

      return {
        invocationId,
        status: 'completed',
        artifacts,
        durationMs,
      }
    } catch (err) {
      const durationMs = Date.now() - startTime
      const isTimeout = this.isTimeoutError(err)
      const errorMessage = err instanceof Error ? err.message : String(err)

      // On timeout or error: mark failed + audit log
      this.invocationManager.markFailed(invocationId, errorMessage)

      this.logger?.error?.(
        `Skill ${skillId} execution ${isTimeout ? 'timed out' : 'failed'}: ${errorMessage}`,
      )

      await this.auditLogger.log(
        this.buildAuditEntry({
          id: randomUUID(),
          invocationId,
          jobId,
          roundIndex,
          agentId,
          skillId,
          skillVersion,
          toolName,
          args,
          outcome: isTimeout ? 'timeout' : 'failure',
          error: errorMessage,
          durationMs,
          resultContent: '',
        }),
      )

      return {
        invocationId,
        status: 'failed',
        artifacts: [],
        durationMs,
        error: errorMessage,
      }
    } finally {
      // Always disconnect
      if (connection) {
        try {
          await this.mcpClient.disconnect(connection)
        } catch (disconnectErr) {
          const msg = disconnectErr instanceof Error ? disconnectErr.message : String(disconnectErr)
          this.logger?.warn?.(`Failed to disconnect MCP client: ${msg}`)
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  /**
   * Build a {@link ToolAuditEntry} from execution parameters and result.
   * Applies result truncation via {@link ToolAuditLogger.truncateResult}.
   */
  private buildAuditEntry(params: {
    id: string
    invocationId: string
    jobId: string
    roundIndex: number
    agentId: string
    skillId: string
    skillVersion: string
    toolName: string
    args: Record<string, unknown>
    outcome: ToolAuditEntry['outcome']
    error?: string
    durationMs: number | null
    resultContent: string
  }): ToolAuditEntry {
    const result = ToolAuditLogger.truncateResult(params.resultContent)

    const entry: ToolAuditEntry = {
      id: params.id,
      timestamp: new Date().toISOString(),
      skillId: params.skillId,
      skillVersion: params.skillVersion,
      toolName: params.toolName,
      args: params.args,
      result,
      durationMs: params.durationMs,
      outcome: params.outcome,
      jobId: params.jobId,
      roundIndex: params.roundIndex,
      agentId: params.agentId,
      invocationId: params.invocationId,
    }

    if (params.error) {
      entry.error = params.error
    }

    return entry
  }

  /**
   * Detect timeout-related errors by name or message pattern.
   */
  private isTimeoutError(err: unknown): boolean {
    if (err instanceof Error) {
      if (err.name === 'AbortError' || err.name === 'TimeoutError') {
        return true
      }
      if (/timeout|timed?\s*out/i.test(err.message)) {
        return true
      }
    }
    return false
  }
}
