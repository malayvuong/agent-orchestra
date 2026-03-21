/**
 * SSE MCP transport — connects to a remote MCP server via HTTP
 * Server-Sent Events for responses and POST for requests.
 *
 * Requests are sent as JSON-RPC 2.0 via POST to `${baseUrl}/message`.
 * Responses arrive via an SSE event stream from the base URL.
 *
 * The URL is validated against BLOCKED_NET_TARGETS to prevent SSRF
 * attacks against internal infrastructure.
 *
 * Uses native `fetch` (Node 20+) for HTTP requests.
 *
 * @module
 */

import { randomUUID } from 'node:crypto'
import type { McpConnection, McpTransport } from '../types.js'
import { BLOCKED_NET_TARGETS } from '../../types.js'

/** Default timeout for a single JSON-RPC request (ms). */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000

/** Connect timeout for the SSE event stream (ms). */
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

/**
 * Validate that a URL does not target a blocked network address.
 *
 * Checks the URL hostname against BLOCKED_NET_TARGETS which includes
 * RFC 1918 private ranges, link-local, loopback, and cloud metadata IPs.
 *
 * @param url - The URL to validate.
 * @throws If the URL targets a blocked address.
 */
export function validateUrl(url: string): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`Invalid SSE transport URL: ${url}`)
  }

  const hostname = parsed.hostname.toLowerCase()

  for (const target of BLOCKED_NET_TARGETS) {
    // Direct hostname match (e.g., "localhost", "0.0.0.0")
    if (!target.includes('/')) {
      if (hostname === target.toLowerCase()) {
        throw new Error(`SSE transport URL '${url}' targets blocked address '${target}'`)
      }
      continue
    }

    // CIDR match — parse the network and check if hostname (as IP) falls within
    const inRange = isIpInCidr(hostname, target)
    if (inRange) {
      throw new Error(`SSE transport URL '${url}' targets blocked network '${target}'`)
    }
  }
}

/**
 * Check whether an IP address string falls within a CIDR range.
 * Supports IPv4 only for Phase C (IPv6 CIDR matching deferred).
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

  // Handle IPv6 CIDR (e.g., "fd00::/8") — check for simple prefix match
  if (network.includes(':')) {
    // Simplified IPv6: only match if the hostname starts with the network prefix
    // Full IPv6 CIDR matching is deferred to Phase D
    return ip.toLowerCase().startsWith(network.replace(/:+$/, '').toLowerCase())
  }

  // IPv4 CIDR matching
  const ipNum = ipv4ToNumber(ip)
  const netNum = ipv4ToNumber(network)
  if (ipNum === null || netNum === null) return false

  // Create mask from prefix length
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

  // Convert to unsigned 32-bit
  return num >>> 0
}

/**
 * SseTransport connects to a remote MCP server via HTTP Server-Sent Events.
 *
 * - Requests: POST JSON-RPC to `${baseUrl}/message`
 * - Responses: Parsed from the SSE event stream at the base URL
 *
 * For Phase C this is a simplified implementation — it sends individual
 * POST requests and parses JSON-RPC responses from them directly, with
 * optional SSE event stream for server-initiated messages.
 */
export class SseTransport {
  /** Monotonically incrementing JSON-RPC request ID. */
  private nextId = 1

  /** Map of pending request IDs to their resolve/reject callbacks. */
  private pending = new Map<number, PendingRequest>()

  /** The base URL of the MCP server. */
  private baseUrl: string

  /** SSE stream abort controller. */
  private abortController: AbortController | null = null

  /** Whether close() has been called. */
  private closed = false

  private constructor(
    baseUrl: string,
    private logger?: Logger,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '') // strip trailing slashes
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Connect to a remote MCP server via SSE transport.
   * Validates the URL against BLOCKED_NET_TARGETS before connecting.
   *
   * @param transport - Must be an SSE transport with a url field.
   * @param logger    - Optional logger for warnings and errors.
   * @returns A connected McpConnection.
   * @throws If the URL targets a blocked network address.
   */
  static async connect(
    transport: Extract<McpTransport, { type: 'sse' }>,
    logger?: Logger,
  ): Promise<McpConnection> {
    // Validate URL against blocked targets (SSRF protection)
    validateUrl(transport.url)

    const instance = new SseTransport(transport.url, logger)
    const connection = await instance.establish(transport)
    return connection
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  /**
   * Establish the SSE connection and start listening for server events.
   */
  private async establish(
    transport: Extract<McpTransport, { type: 'sse' }>,
  ): Promise<McpConnection> {
    this.abortController = new AbortController()

    // Attempt to connect to the SSE event stream to verify the server is alive
    const connectPromise = this.startEventStream()
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`SSE connect timeout after ${CONNECT_TIMEOUT_MS}ms`)),
        CONNECT_TIMEOUT_MS,
      )
    })

    try {
      await Promise.race([connectPromise, timeoutPromise])
    } catch (err) {
      // If the SSE stream fails to connect, we still allow the connection
      // to proceed — some MCP servers only respond to POST requests and
      // don't provide a persistent SSE stream. Log the warning.
      const message = err instanceof Error ? err.message : String(err)
      this.logger?.warn(`[sse] event stream not available: ${message}`)
    }

    const connectionId = randomUUID()

    const connection: McpConnection = {
      id: connectionId,
      transport,
      connected: true,
      request: (method, params) => this.request(method, params),
      close: () => this.close(connection),
    }

    return connection
  }

  /**
   * Start listening on the SSE event stream for server-pushed messages.
   * Uses native fetch with streaming response body parsing.
   */
  private async startEventStream(): Promise<void> {
    const response = await fetch(this.baseUrl, {
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
      },
      signal: this.abortController?.signal,
    })

    if (!response.ok) {
      throw new Error(`SSE stream returned HTTP ${response.status}`)
    }

    // Start reading the SSE stream in the background
    if (response.body) {
      this.readEventStream(response.body).catch((err) => {
        if (!this.closed) {
          const message = err instanceof Error ? err.message : String(err)
          this.logger?.warn(`[sse] event stream error: ${message}`)
        }
      })
    }
  }

  /**
   * Read and parse the SSE event stream. Each event with `data:` containing
   * a JSON-RPC response is dispatched to the matching pending request.
   */
  private async readEventStream(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (!this.closed) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // SSE events are separated by double newlines
        const events = buffer.split('\n\n')
        buffer = events.pop() ?? ''

        for (const event of events) {
          this.handleSseEvent(event)
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  /**
   * Parse a single SSE event block and resolve the matching pending request.
   */
  private handleSseEvent(event: string): void {
    let data = ''

    for (const line of event.split('\n')) {
      if (line.startsWith('data:')) {
        data += line.slice(5).trim()
      }
    }

    if (!data) return

    try {
      const msg = JSON.parse(data) as {
        jsonrpc?: string
        id?: number
        result?: unknown
        error?: { code?: number; message?: string; data?: unknown }
      }

      if (msg.id == null) return // notification, skip

      const pending = this.pending.get(msg.id)
      if (!pending) {
        this.logger?.warn(`[sse] response for unknown request id=${msg.id}`)
        return
      }

      clearTimeout(pending.timer)
      this.pending.delete(msg.id)

      if (msg.error) {
        pending.reject(
          new Error(
            `JSON-RPC error (${msg.error.code ?? 'unknown'}): ${msg.error.message ?? 'Unknown error'}`,
          ),
        )
      } else {
        pending.resolve(msg.result)
      }
    } catch {
      this.logger?.warn(`[sse] failed to parse SSE data: ${data}`)
    }
  }

  /**
   * Send a JSON-RPC 2.0 request via POST to `${baseUrl}/message`.
   *
   * The response is either returned inline from the POST response body
   * (for simple request/response servers) or resolved via the SSE stream
   * (for streaming servers).
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
      throw new Error('SseTransport is closed')
    }

    const id = this.nextId++

    const body = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      ...(params !== undefined ? { params } : {}),
    })

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`JSON-RPC request '${method}' timed out after ${timeoutMs}ms`))
      }, timeoutMs)

      // Register in pending map so SSE stream can also resolve this
      this.pending.set(id, { resolve, reject, timer })

      // Send POST request
      fetch(`${this.baseUrl}/message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`)
          }

          const contentType = response.headers.get('content-type') ?? ''

          // If the server responds with JSON directly (not SSE), resolve inline
          if (contentType.includes('application/json')) {
            const msg = (await response.json()) as {
              jsonrpc?: string
              id?: number
              result?: unknown
              error?: { code?: number; message?: string; data?: unknown }
            }

            // Only resolve if this request is still pending (not resolved by SSE)
            const pending = this.pending.get(id)
            if (!pending) return // already resolved via SSE

            clearTimeout(pending.timer)
            this.pending.delete(id)

            if (msg.error) {
              pending.reject(
                new Error(
                  `JSON-RPC error (${msg.error.code ?? 'unknown'}): ${msg.error.message ?? 'Unknown error'}`,
                ),
              )
            } else {
              pending.resolve(msg.result)
            }
          }
          // If content-type is text/event-stream, the response will arrive via SSE
          // and be handled by handleSseEvent(). Nothing to do here.
        })
        .catch((err) => {
          // Only reject if still pending
          const pending = this.pending.get(id)
          if (!pending) return

          clearTimeout(pending.timer)
          this.pending.delete(id)

          const message = err instanceof Error ? err.message : String(err)
          pending.reject(new Error(`SSE POST request failed: ${message}`))
        })
    })
  }

  /**
   * Close the SSE connection. Aborts the event stream and rejects
   * all pending requests.
   */
  private async close(connection: McpConnection): Promise<void> {
    if (this.closed) return
    this.closed = true
    connection.connected = false

    // Abort the SSE event stream
    this.abortController?.abort()

    // Reject all pending requests
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(new Error('SseTransport closed'))
      this.pending.delete(id)
    }
  }
}
