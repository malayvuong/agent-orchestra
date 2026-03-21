import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { rm, mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SkillExecutor } from '../executor.js'
import type { SkillEventEmitter } from '../executor.js'
import { SkillInvocationManager } from '../invocation.js'
import { PolicyEngine } from '../../policy/engine.js'
import { ToolAuditLogger } from '../audit-logger.js'
import { InMemoryInvocationStore } from '../store.js'
import type { McpConnection, McpToolResult, McpTransport, SkillExecutionRequest } from '../types.js'
import type { SkillPolicy } from '../../types.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeLogger() {
  return {
    warn: vi.fn(),
    error: vi.fn(),
  }
}

function makeMockMcpClient() {
  const mockConnection: McpConnection = {
    id: 'mock-conn-1',
    transport: { type: 'stdio' as const, command: 'echo', args: [] },
    connected: true,
    request: vi.fn(),
    close: vi.fn(),
  }

  return {
    connect: vi.fn().mockResolvedValue(mockConnection),
    callTool: vi.fn().mockResolvedValue({
      content: '{"result": "success"}',
      isError: false,
    } satisfies McpToolResult),
    disconnect: vi.fn().mockResolvedValue(undefined),
    mockConnection,
  }
}

function makeMockEventEmitter(): SkillEventEmitter & {
  calls: Array<{ event: string; payload: unknown }>
} {
  const calls: Array<{ event: string; payload: unknown }> = []
  return {
    calls,
    emit(event: string, payload: unknown) {
      calls.push({ event, payload })
    },
  }
}

/** Policy that allows fs.read only */
const READ_ONLY_POLICY: SkillPolicy = {
  defaultAction: 'deny',
  rules: [{ capability: 'fs.read', action: 'allow' }],
  maxExecutionMs: 30_000,
  networkAllowed: false,
}

/** Policy that requires approval for fs.write */
const WRITE_APPROVAL_POLICY: SkillPolicy = {
  defaultAction: 'deny',
  rules: [
    { capability: 'fs.read', action: 'allow' },
    { capability: 'fs.write', action: 'require_approval' },
  ],
  maxExecutionMs: 30_000,
  networkAllowed: false,
}

const STDIO_TRANSPORT: McpTransport = { type: 'stdio', command: 'echo', args: [] }

function makeRequest(overrides: Partial<SkillExecutionRequest> = {}): SkillExecutionRequest {
  return {
    jobId: 'job-1',
    roundIndex: 0,
    agentId: 'agent-1',
    skillId: 'test-skill',
    skillVersion: '1.0.0',
    transport: STDIO_TRANSPORT,
    toolName: 'read_file',
    args: { path: '/src/index.ts' },
    capabilityScopes: [{ capability: 'fs.read', scope: ['./src/**'] }],
    policy: READ_ONLY_POLICY,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// SkillExecutor
// ---------------------------------------------------------------------------

describe('SkillExecutor', () => {
  let tmpDir: string
  let store: InMemoryInvocationStore
  let engine: PolicyEngine
  let invocationManager: SkillInvocationManager
  let mcpClient: ReturnType<typeof makeMockMcpClient>
  let auditLogger: ToolAuditLogger
  let logger: ReturnType<typeof makeLogger>
  let executor: SkillExecutor

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'executor-test-'))
    store = new InMemoryInvocationStore()
    engine = new PolicyEngine()
    invocationManager = new SkillInvocationManager(store, engine)
    mcpClient = makeMockMcpClient()
    auditLogger = new ToolAuditLogger(join(tmpDir, 'audit'))
    logger = makeLogger()
    executor = new SkillExecutor(invocationManager, mcpClient, auditLogger, logger)
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  // -------------------------------------------------------------------------
  // Successful execution
  // -------------------------------------------------------------------------

  describe('execute — success', () => {
    it('executes a tool call end-to-end and returns artifacts', async () => {
      const result = await executor.execute(makeRequest())

      expect(result.status).toBe('completed')
      expect(result.artifacts).toHaveLength(1)
      expect(result.artifacts[0].type).toBe('finding')
      expect(result.artifacts[0].name).toBe('read_file-result')
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
      expect(result.error).toBeUndefined()
    })

    it('connects to MCP server with correct transport', async () => {
      await executor.execute(makeRequest())

      expect(mcpClient.connect).toHaveBeenCalledWith(
        STDIO_TRANSPORT,
        ['fs.read'], // Flat capabilities extracted from capabilityScopes
      )
    })

    it('calls the tool with correct arguments', async () => {
      await executor.execute(makeRequest({ args: { path: '/test/file.ts' } }))

      expect(mcpClient.callTool).toHaveBeenCalledWith(
        mcpClient.mockConnection,
        'read_file',
        { path: '/test/file.ts' },
        30_000,
      )
    })

    it('disconnects after execution', async () => {
      await executor.execute(makeRequest())

      expect(mcpClient.disconnect).toHaveBeenCalledWith(mcpClient.mockConnection)
    })
  })

  // -------------------------------------------------------------------------
  // Policy denial
  // -------------------------------------------------------------------------

  describe('execute — policy denial', () => {
    it('returns failed result when capability is denied', async () => {
      const result = await executor.execute(
        makeRequest({
          capabilityScopes: [{ capability: 'fs.write', scope: ['./src/**'] }],
          policy: READ_ONLY_POLICY,
        }),
      )

      expect(result.status).toBe('failed')
      expect(result.error).toContain('denied')
      expect(result.artifacts).toEqual([])
    })

    it('does not connect to MCP server when denied', async () => {
      await executor.execute(
        makeRequest({
          capabilityScopes: [{ capability: 'net.http', scope: ['api.example.com'] }],
          policy: READ_ONLY_POLICY,
        }),
      )

      expect(mcpClient.connect).not.toHaveBeenCalled()
    })

    it('logs denial warning', async () => {
      await executor.execute(
        makeRequest({
          capabilityScopes: [{ capability: 'proc.spawn', scope: ['npm test'] }],
          policy: READ_ONLY_POLICY,
        }),
      )

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('denied by policy'))
    })
  })

  // -------------------------------------------------------------------------
  // Approval flow
  // -------------------------------------------------------------------------

  describe('execute — approval flow', () => {
    it('returns awaiting_approval when policy requires approval', async () => {
      const result = await executor.execute(
        makeRequest({
          capabilityScopes: [{ capability: 'fs.write', scope: ['./src/**'] }],
          policy: WRITE_APPROVAL_POLICY,
        }),
      )

      expect(result.status).toBe('awaiting_approval')
      expect(result.artifacts).toEqual([])
      expect(result.error).toBeUndefined()
    })

    it('does not connect to MCP server when approval required', async () => {
      await executor.execute(
        makeRequest({
          capabilityScopes: [{ capability: 'fs.write', scope: ['./src/**'] }],
          policy: WRITE_APPROVAL_POLICY,
        }),
      )

      expect(mcpClient.connect).not.toHaveBeenCalled()
    })

    it('emits skill:awaiting_approval event', async () => {
      const eventEmitter = makeMockEventEmitter()
      const executorWithEvents = new SkillExecutor(
        invocationManager,
        mcpClient,
        auditLogger,
        logger,
        eventEmitter,
      )

      await executorWithEvents.execute(
        makeRequest({
          capabilityScopes: [{ capability: 'fs.write', scope: ['./src/**'] }],
          policy: WRITE_APPROVAL_POLICY,
        }),
      )

      expect(eventEmitter.calls).toHaveLength(1)
      expect(eventEmitter.calls[0].event).toBe('skill:awaiting_approval')
    })
  })

  // -------------------------------------------------------------------------
  // Resume after approval
  // -------------------------------------------------------------------------

  describe('resume', () => {
    it('executes tool call after approval', async () => {
      const result = await executor.execute(
        makeRequest({
          capabilityScopes: [{ capability: 'fs.write', scope: ['./src/**'] }],
          policy: WRITE_APPROVAL_POLICY,
          toolName: 'write_file',
          args: { path: './src/test.ts', content: 'hello' },
        }),
      )

      expect(result.status).toBe('awaiting_approval')

      const resumed = await executor.resume(
        result.invocationId,
        { action: 'approve' },
        STDIO_TRANSPORT,
      )

      expect(resumed.status).toBe('completed')
      expect(resumed.artifacts).toHaveLength(1)
      expect(mcpClient.connect).toHaveBeenCalled()
    })

    it('returns rejected when user rejects', async () => {
      const result = await executor.execute(
        makeRequest({
          capabilityScopes: [{ capability: 'fs.write', scope: ['./src/**'] }],
          policy: WRITE_APPROVAL_POLICY,
        }),
      )

      const resumed = await executor.resume(
        result.invocationId,
        { action: 'reject', reason: 'Not needed' },
        STDIO_TRANSPORT,
      )

      expect(resumed.status).toBe('rejected')
      expect(resumed.error).toBe('Not needed')
      expect(mcpClient.connect).not.toHaveBeenCalled()
    })

    it('uses edited args when user edits', async () => {
      const result = await executor.execute(
        makeRequest({
          capabilityScopes: [{ capability: 'fs.write', scope: ['./src/**'] }],
          policy: WRITE_APPROVAL_POLICY,
          args: { path: './src/old.ts' },
        }),
      )

      await executor.resume(
        result.invocationId,
        { action: 'edit', editedArgs: { path: './src/new.ts' } },
        STDIO_TRANSPORT,
      )

      expect(mcpClient.callTool).toHaveBeenCalledWith(
        mcpClient.mockConnection,
        expect.any(String),
        { path: './src/new.ts' },
        expect.any(Number),
      )
    })

    it('emits skill:rejected event on rejection', async () => {
      const eventEmitter = makeMockEventEmitter()
      const executorWithEvents = new SkillExecutor(
        invocationManager,
        mcpClient,
        auditLogger,
        logger,
        eventEmitter,
      )

      const result = await executorWithEvents.execute(
        makeRequest({
          capabilityScopes: [{ capability: 'fs.write', scope: ['./src/**'] }],
          policy: WRITE_APPROVAL_POLICY,
        }),
      )

      await executorWithEvents.resume(result.invocationId, { action: 'reject' }, STDIO_TRANSPORT)

      const rejectEvent = eventEmitter.calls.find((c) => c.event === 'skill:rejected')
      expect(rejectEvent).toBeDefined()
    })

    it('throws when resuming non-existent invocation', async () => {
      await expect(
        executor.resume('nonexistent', { action: 'approve' }, STDIO_TRANSPORT),
      ).rejects.toThrow(/not found/)
    })

    it('throws when resuming non-awaiting invocation', async () => {
      const result = await executor.execute(makeRequest())

      await expect(
        executor.resume(result.invocationId, { action: 'approve' }, STDIO_TRANSPORT),
      ).rejects.toThrow(/expected 'awaiting_approval'/)
    })
  })

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe('execute — error handling', () => {
    it('handles MCP connection failure', async () => {
      mcpClient.connect.mockRejectedValue(new Error('Connection refused'))

      const result = await executor.execute(makeRequest())

      expect(result.status).toBe('failed')
      expect(result.error).toBe('Connection refused')
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    })

    it('handles tool call failure', async () => {
      mcpClient.callTool.mockRejectedValue(new Error('Tool error'))

      const result = await executor.execute(makeRequest())

      expect(result.status).toBe('failed')
      expect(result.error).toBe('Tool error')
    })

    it('detects timeout errors', async () => {
      const timeoutError = new Error('Request timed out')
      timeoutError.name = 'AbortError'
      mcpClient.callTool.mockRejectedValue(timeoutError)

      const result = await executor.execute(makeRequest())

      expect(result.status).toBe('failed')
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('timed out'))
    })

    it('disconnects even on error', async () => {
      mcpClient.callTool.mockRejectedValue(new Error('Tool error'))

      await executor.execute(makeRequest())

      expect(mcpClient.disconnect).toHaveBeenCalledWith(mcpClient.mockConnection)
    })

    it('handles tool result with isError flag', async () => {
      mcpClient.callTool.mockResolvedValue({
        content: 'File not found',
        isError: true,
      })

      const result = await executor.execute(makeRequest())

      expect(result.status).toBe('completed')
      expect(result.artifacts[0].includeInContext).toBe(false)
    })
  })
})
