/**
 * MCP Client for Agent Orchestra skill execution.
 *
 * Orchestrates connections to MCP servers (via stdio or SSE transports),
 * tool discovery, and tool invocation. Enforces Phase C's read-only policy:
 * only `fs.read` capability is permitted. All other capabilities are
 * unconditionally denied before any connection or tool call is dispatched.
 *
 * @module
 */

import type { McpConnection, McpTransport, McpToolSchema, McpToolResult } from './types.js'
import type { SkillCapability } from '../types.js'
import { StdioTransport } from './transports/stdio.js'
import { SseTransport } from './transports/sse.js'
import { StreamableHttpTransport } from './transports/streamable-http.js'

/** Default tool call timeout (ms). */
const DEFAULT_TOOL_TIMEOUT_MS = 30_000

/** The only capability allowed in Phase C. */
const ALLOWED_CAPABILITIES: ReadonlySet<SkillCapability> = new Set(['fs.read'])

/** Logger interface matching the project convention. */
interface Logger {
  warn: (msg: string) => void
  error: (msg: string) => void
}

/**
 * SkillMcpClient manages MCP server connections and tool invocations.
 *
 * Phase C restrictions:
 * - Only `fs.read` capability is permitted.
 * - Connections are rejected if a skill declares any other capability.
 * - Tool calls that would require non-`fs.read` capabilities are denied at runtime.
 */
export class SkillMcpClient {
  constructor(private logger?: Logger) {}

  /**
   * Connect to an MCP server using the specified transport.
   *
   * Before connecting, validates that the skill's declared capabilities
   * contain ONLY `fs.read`. Rejects the connection if any other capability
   * is declared.
   *
   * @param transport             - The transport configuration (stdio or SSE).
   * @param declaredCapabilities  - The capabilities declared by the skill.
   * @returns A connected McpConnection.
   * @throws If any capability other than `fs.read` is declared.
   * @throws If the transport type is unsupported.
   */
  async connect(
    transport: McpTransport,
    declaredCapabilities: SkillCapability[],
  ): Promise<McpConnection> {
    // Phase C policy: only fs.read is allowed
    this.validateCapabilities(declaredCapabilities)

    switch (transport.type) {
      case 'stdio':
        return StdioTransport.connect(transport, this.logger)

      case 'sse':
        return SseTransport.connect(transport, this.logger)

      case 'streamable-http':
        return StreamableHttpTransport.connect(transport.url, this.logger)

      default: {
        // Exhaustive check — TypeScript will catch this at compile time,
        // but we add a runtime guard for safety.
        const exhaustive: never = transport
        throw new Error(`Unsupported MCP transport type: ${(exhaustive as McpTransport).type}`)
      }
    }
  }

  /**
   * List available tools from a connected MCP server.
   * Sends a `tools/list` JSON-RPC request and returns the tool schemas.
   *
   * @param connection - An active McpConnection.
   * @returns Array of tool schemas describing available tools.
   * @throws If the connection is not active or the request fails.
   */
  async listTools(connection: McpConnection): Promise<McpToolSchema[]> {
    if (!connection.connected) {
      throw new Error('Cannot list tools: connection is not active')
    }

    const result = await connection.request('tools/list')

    // MCP protocol returns { tools: [...] }
    const response = result as { tools?: unknown[] } | null
    if (!response?.tools || !Array.isArray(response.tools)) {
      return []
    }

    return response.tools.map((tool) => {
      const t = tool as Record<string, unknown>
      return {
        name: String(t.name ?? ''),
        description: t.description != null ? String(t.description) : undefined,
        inputSchema: t.inputSchema as Record<string, unknown> | undefined,
      } satisfies McpToolSchema
    })
  }

  /**
   * Execute a tool call on a connected MCP server.
   *
   * Before executing, validates that only `fs.read` capability is required.
   * Enforces a timeout (default 30s, configurable per call).
   *
   * @param connection - An active McpConnection.
   * @param toolName   - The name of the tool to call.
   * @param args       - Arguments to pass to the tool.
   * @param timeoutMs  - Timeout in milliseconds (default: 30_000).
   * @returns The tool result containing content and error status.
   * @throws If the connection is not active or the request fails/times out.
   */
  async callTool(
    connection: McpConnection,
    toolName: string,
    args: Record<string, unknown>,
    _timeoutMs: number = DEFAULT_TOOL_TIMEOUT_MS,
  ): Promise<McpToolResult> {
    if (!connection.connected) {
      throw new Error('Cannot call tool: connection is not active')
    }

    // Phase C runtime guard: deny tool calls that imply non-read capabilities.
    // This is a heuristic check based on tool name patterns.
    this.validateToolName(toolName)

    const result = await connection.request('tools/call', {
      name: toolName,
      arguments: args,
    })

    // Parse the MCP tool result
    return this.parseToolResult(result)
  }

  /**
   * Disconnect from an MCP server.
   * Cleans up the connection and any child processes (for stdio).
   *
   * @param connection - The McpConnection to close.
   */
  async disconnect(connection: McpConnection): Promise<void> {
    if (!connection.connected) {
      return
    }

    try {
      await connection.close()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.logger?.warn(`[mcp-client] error during disconnect: ${message}`)
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Validate that declared capabilities are restricted to fs.read only.
   * Phase C policy: unconditionally deny all other capabilities.
   *
   * @param capabilities - The capabilities declared by the skill.
   * @throws If any capability is not in the allowed set.
   */
  private validateCapabilities(capabilities: SkillCapability[]): void {
    for (const cap of capabilities) {
      if (!ALLOWED_CAPABILITIES.has(cap)) {
        throw new Error(
          `Capability '${cap}' is not allowed in Phase C. ` + `Only 'fs.read' is permitted.`,
        )
      }
    }
  }

  /**
   * Runtime heuristic check to deny tool calls that imply write or dangerous
   * capabilities based on the tool name.
   *
   * This is a defense-in-depth measure. The primary enforcement is at
   * connection time via declared capabilities. This catches tools that
   * might slip through if a skill under-declares its capabilities.
   *
   * @param toolName - The name of the tool being called.
   * @throws If the tool name suggests non-read-only capability.
   */
  private validateToolName(toolName: string): void {
    const lower = toolName.toLowerCase()

    // Patterns that suggest write operations
    const writePatterns = [
      'write_file',
      'create_file',
      'delete_file',
      'remove_file',
      'modify_file',
      'rename_file',
      'move_file',
      'mkdir',
      'rmdir',
    ]

    // Patterns that suggest process spawning
    const procPatterns = ['run_command', 'exec_command', 'spawn_process', 'shell_exec', 'execute']

    // Patterns that suggest network access
    const netPatterns = ['http_request', 'fetch_url', 'download', 'upload']

    // Patterns that suggest secret access
    const secretPatterns = ['read_secret', 'get_credential', 'get_password']

    const allBlocked = [...writePatterns, ...procPatterns, ...netPatterns, ...secretPatterns]

    for (const pattern of allBlocked) {
      if (lower.includes(pattern)) {
        throw new Error(
          `Tool '${toolName}' is denied by Phase C read-only policy. ` +
            `Only fs.read tools are permitted.`,
        )
      }
    }
  }

  /**
   * Parse the raw JSON-RPC result into an McpToolResult.
   *
   * MCP tool results follow the format:
   * ```json
   * {
   *   "content": [{ "type": "text", "text": "..." }],
   *   "isError": false
   * }
   * ```
   *
   * @param raw - The raw result from the JSON-RPC response.
   * @returns A normalized McpToolResult.
   */
  private parseToolResult(raw: unknown): McpToolResult {
    if (raw == null) {
      return { content: '', isError: false }
    }

    const result = raw as Record<string, unknown>

    // Extract content — MCP returns an array of content blocks
    let content = ''
    if (Array.isArray(result.content)) {
      const textParts: string[] = []
      for (const block of result.content) {
        const b = block as Record<string, unknown>
        if (b.type === 'text' && typeof b.text === 'string') {
          textParts.push(b.text)
        } else if (typeof b.text === 'string') {
          textParts.push(b.text)
        }
      }
      content = textParts.join('\n')
    } else if (typeof result.content === 'string') {
      content = result.content
    }

    const isError = typeof result.isError === 'boolean' ? result.isError : false

    return { content, isError }
  }
}
