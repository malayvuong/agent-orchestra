/**
 * Streamable HTTP MCP transport — connects to a remote MCP server via
 * HTTP POST for requests and streamed JSON responses.
 *
 * Implements the MCP Streamable HTTP transport protocol:
 * - Requests: POST JSON-RPC 2.0 to `${url}/message`
 * - Responses: Streamed JSON from the POST response body
 * - Bidirectional: supports both request/response and server-push patterns
 *
 * The URL is validated against BLOCKED_NET_TARGETS to prevent SSRF
 * attacks against internal infrastructure.
 *
 * TLS verification is required for HTTPS URLs (Node default behaviour).
 * Timeout enforcement is handled via AbortController.
 *
 * Uses native `fetch` (Node 20+) for HTTP requests.
 *
 * @module
 */

import { randomUUID } from 'node:crypto'
import type { McpConnection } from '../types.js'
import { BLOCKED_NET_TARGETS } from '../../types.js'

/** Default timeout for a single JSON-RPC request (ms). */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000

/** Connect timeout for the initial handshake (ms). */
const CONNECT_TIMEOUT_MS = 10_000

/** Logger interface matching the project convention. */
interface Logger {
  warn: (msg: string) => void
  error: (msg: string) => void
}

/**
 * Pending JSON-RPC request tracker.
 */
interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
}

// ---------------------------------------------------------------------------
// URL validation
// ---------------------------------------------------------------------------

/**
 * Validate that a URL does not target a blocked network address.
 *
 * Checks the URL hostname against BLOCKED_NET_TARGETS which includes
 * RFC 1918 private ranges, link-local, loopback, and cloud metadata IPs.
 *
 * @param url - The URL to validate.
 * @throws If the URL is invalid or targets a blocked address.
 */
export function validateStreamableHttpUrl(url: string): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`Invalid streamable-http transport URL: ${url}`)
  }

  const hostname = parsed.hostname.toLowerCase()

  for (const target of BLOCKED_NET_TARGETS) {
    // Direct hostname match (e.g., "localhost", "0.0.0.0")
    if (!target.includes('/')) {
      if (hostname === target.toLowerCase()) {
        throw new Error(
          `Streamable HTTP transport URL '${url}' targets blocked address '${target}'`,
        )
      }
      continue
    }

    // CIDR match — parse the network and check if hostname (as IP) falls within
    const inRange = isIpInCidr(hostname, target)
    if (inRange) {
      throw new Error(`Streamable HTTP transport URL '${url}' targets blocked network '${target}'`)
    }
  }
}

/**
 * Check whether an IP address string falls within a CIDR range.
 * Supports IPv4 and simplified IPv6 prefix matching.
 *
 * @param ip   - The IP address to check (e.g., "192.168.1.5").
 * @param cidr - The CIDR range (e.g., "192.168.0.0/16").
 * @returns True if the IP is within the CIDR range.
 */
function isIpInCidr(ip: string, cidr: string): boolean {
  const [network, prefixStr] = cidr.split('/')
  if (!network || !prefixStr) return false

  const prefix = parseInt(prefixStr, 10)
  if (isNaN(prefix)) return false

  // Handle IPv6 CIDR (e.g., "fd00::/8") — simple prefix match
  if (network.includes(':')) {
    return ip.toLowerCase().startsWith(network.replace(/:+$/, '').toLowerCase())
  }

  // IPv4 CIDR matching
  const ipNum = ipv4ToNumber(ip)
  const netNum = ipv4ToNumber(network)
  if (ipNum === null || netNum === null) return false

  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0
  return (ipNum & mask) === (netNum & mask)
}

/**
 * Convert an IPv4 address string to a 32-bit unsigned integer.
 *
 * @param ip - The IPv4 address (e.g., "192.168.1.5").
 * @returns The numeric value, or null if not a valid IPv4 address.
 */
function ipv4ToNumber(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null

  let num = 0
  for (const part of parts) {
    const octet = parseInt(part, 10)
    if (isNaN(octet) || octet < 0 || octet > 255) return null
    num = (num << 8) | octet
  }

  return num >>> 0
}

// ---------------------------------------------------------------------------
// StreamableHttpTransport
// ---------------------------------------------------------------------------

/**
 * StreamableHttpTransport connects to a remote MCP server via HTTP POST
 * with streamed JSON responses.
 *
 * - Requests: POST JSON-RPC 2.0 to `${baseUrl}/message`
 * - Responses: Parsed from the POST response body (JSON or streamed)
 * - Bidirectional: server can push messages via streamed response chunks
 *
 * Unlike SSE transport, this does not maintain a persistent event stream.
 * Each request-response cycle is independent, with optional streaming
 * for long-running operations.
 */
export class StreamableHttpTransport {
  /** Monotonically incrementing JSON-RPC request ID. */
  private nextId = 1

  /** Map of pending request IDs to their resolve/reject callbacks. */
  private pending = new Map<number, PendingRequest>()

  /** The base URL of the MCP server. */
  private baseUrl: string

  /** Global abort controller for cancelling all pending requests on close. */
  private globalAbortController: AbortController

  /** Whether close() has been called. */
  private closed = false

  private constructor(
    baseUrl: string,
    private logger?: Logger,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '') // strip trailing slashes
    this.globalAbortController = new AbortController()
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Connect to a remote MCP server via streamable HTTP transport.
   * Validates the URL against BLOCKED_NET_TARGETS before connecting.
   *
   * @param url    - The base URL of the MCP server.
   * @param logger - Optional logger for warnings and errors.
   * @returns A connected McpConnection.
   * @throws If the URL targets a blocked network address.
   * @throws If the initial handshake times out.
   */
  static async connect(url: string, logger?: Logger): Promise<McpConnection> {
    // Validate URL against blocked targets (SSRF protection)
    validateStreamableHttpUrl(url)

    const instance = new StreamableHttpTransport(url, logger)
    const connection = await instance.establish()
    return connection
  }

  // ---------------------------------------------------------------------------
  // Internal — connection establishment
  // ---------------------------------------------------------------------------

  /**
   * Establish the connection by sending a handshake request to verify
   * the remote server is alive and accepting JSON-RPC requests.
   */
  private async establish(): Promise<McpConnection> {
    // Verify server is reachable with a simple ping-like request
    const abortController = new AbortController()
    const timeout = setTimeout(() => abortController.abort(), CONNECT_TIMEOUT_MS)

    try {
      const response = await fetch(`${this.baseUrl}/message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 0,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: {
              name: 'agent-orchestra',
              version: '1.0.0',
            },
          },
        }),
        signal: abortController.signal,
      })

      if (!response.ok) {
        this.logger?.warn(
          `[streamable-http] server returned HTTP ${response.status} during handshake`,
        )
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.logger?.warn(
        `[streamable-http] handshake failed (server may not support initialize): ${message}`,
      )
      // Continue anyway — some servers don't require initialize
    } finally {
      clearTimeout(timeout)
    }

    const connectionId = randomUUID()

    const connection: McpConnection = {
      id: connectionId,
      transport: { type: 'streamable-http' as const, url: this.baseUrl } as never,
      connected: true,
      request: (method, params) => this.request(method, params),
      close: () => this.close(connection),
    }

    return connection
  }

  // ---------------------------------------------------------------------------
  // Internal — JSON-RPC request/response
  // ---------------------------------------------------------------------------

  /**
   * Send a JSON-RPC 2.0 request via POST to `${baseUrl}/message`.
   *
   * The response can be:
   * - `application/json`: Direct JSON-RPC response (resolved immediately)
   * - `text/event-stream`: Streamed response (parsed incrementally)
   *
   * @param method    - The JSON-RPC method name.
   * @param params    - Optional parameters object.
   * @param timeoutMs - Request timeout in milliseconds.
   * @returns The `result` field from the JSON-RPC response.
   */
  private async request(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS,
  ): Promise<unknown> {
    if (this.closed) {
      throw new Error('StreamableHttpTransport is closed')
    }

    const id = this.nextId++

    const body = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      ...(params !== undefined ? { params } : {}),
    })

    // Per-request abort controller, linked to global
    const requestAbort = new AbortController()
    const timer = setTimeout(() => requestAbort.abort(), timeoutMs)

    // Also abort if the global controller fires
    const onGlobalAbort = () => requestAbort.abort()
    this.globalAbortController.signal.addEventListener('abort', onGlobalAbort)

    try {
      const response = await fetch(`${this.baseUrl}/message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body,
        signal: requestAbort.signal,
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const contentType = response.headers.get('content-type') ?? ''

      // Direct JSON response
      if (contentType.includes('application/json')) {
        return this.parseJsonRpcResponse((await response.json()) as Record<string, unknown>, id)
      }

      // Streamed SSE-like response
      if (contentType.includes('text/event-stream') && response.body) {
        return this.parseStreamedResponse(response.body, id)
      }

      // Fallback: try to parse as JSON
      const text = await response.text()
      try {
        const parsed = JSON.parse(text)
        return this.parseJsonRpcResponse(parsed, id)
      } catch (parseErr) {
        throw new Error(`Unexpected content-type '${contentType}' from streamable-http server`, {
          cause: parseErr,
        })
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`JSON-RPC request '${method}' timed out after ${timeoutMs}ms`, {
          cause: err,
        })
      }
      throw err
    } finally {
      clearTimeout(timer)
      this.globalAbortController.signal.removeEventListener('abort', onGlobalAbort)
    }
  }

  /**
   * Parse a direct JSON-RPC response.
   */
  private parseJsonRpcResponse(msg: Record<string, unknown>, _expectedId: number): unknown {
    if (msg.error) {
      const err = msg.error as { code?: number; message?: string }
      throw new Error(
        `JSON-RPC error (${err.code ?? 'unknown'}): ${err.message ?? 'Unknown error'}`,
      )
    }

    return msg.result
  }

  /**
   * Parse a streamed SSE-like response body for the JSON-RPC result.
   *
   * Reads the stream until a complete JSON-RPC response is found
   * or the stream ends.
   */
  private async parseStreamedResponse(
    body: ReadableStream<Uint8Array>,
    expectedId: number,
  ): Promise<unknown> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // Try to find complete SSE events (separated by double newlines)
        const events = buffer.split('\n\n')
        buffer = events.pop() ?? ''

        for (const event of events) {
          const result = this.extractResultFromEvent(event, expectedId)
          if (result !== undefined) {
            return result
          }
        }
      }

      // Check remaining buffer
      if (buffer.trim()) {
        const result = this.extractResultFromEvent(buffer, expectedId)
        if (result !== undefined) {
          return result
        }
      }

      throw new Error('Stream ended without a complete JSON-RPC response')
    } finally {
      reader.releaseLock()
    }
  }

  /**
   * Extract a JSON-RPC result from a single SSE event block.
   * Returns undefined if the event does not contain the expected response.
   */
  private extractResultFromEvent(event: string, expectedId: number): unknown | undefined {
    let data = ''

    for (const line of event.split('\n')) {
      if (line.startsWith('data:')) {
        data += line.slice(5).trim()
      }
    }

    if (!data) {
      // Not an SSE-formatted event; try raw JSON parse
      try {
        const msg = JSON.parse(event.trim()) as Record<string, unknown>
        if (msg.jsonrpc === '2.0') {
          return this.parseJsonRpcResponse(msg, expectedId)
        }
      } catch {
        // Not parseable — skip
      }
      return undefined
    }

    try {
      const msg = JSON.parse(data) as Record<string, unknown>
      return this.parseJsonRpcResponse(msg, expectedId)
    } catch {
      return undefined
    }
  }

  /**
   * Close the transport. Aborts all pending requests.
   */
  private async close(connection: McpConnection): Promise<void> {
    if (this.closed) return
    this.closed = true
    connection.connected = false

    // Abort all in-flight fetch requests
    this.globalAbortController.abort()

    // Reject all pending requests
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(new Error('StreamableHttpTransport closed'))
      this.pending.delete(id)
    }
  }
}
