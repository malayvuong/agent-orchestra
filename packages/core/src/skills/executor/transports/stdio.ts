/**
 * Stdio MCP transport — spawns a child process and communicates
 * via JSON-RPC 2.0 over stdin/stdout (newline-delimited JSON).
 *
 * The child process runs with a sanitized environment that strips
 * host secrets. On disconnect, the process receives SIGTERM with a
 * 2-second grace period before SIGKILL.
 *
 * @module
 */

import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { McpConnection, McpTransport } from '../types.js'
import { sanitizeEnvironment } from './env-sanitizer.js'

/** Default timeout for a single JSON-RPC request (ms). */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000

/** Grace period after SIGTERM before sending SIGKILL (ms). */
const SIGKILL_GRACE_MS = 2_000

/** Logger interface matching the project convention. */
interface Logger {
  warn: (msg: string) => void
  error: (msg: string) => void
}

/**
 * Pending JSON-RPC request tracker.
 * Each outbound request stores its resolve/reject callbacks and a timeout handle.
 */
interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * StdioTransport manages a child process that speaks JSON-RPC 2.0
 * over stdin (requests) and stdout (responses), using newline-delimited JSON.
 */
export class StdioTransport {
  /** Monotonically incrementing JSON-RPC request ID. */
  private nextId = 1

  /** Map of pending request IDs to their resolve/reject callbacks. */
  private pending = new Map<number, PendingRequest>()

  /** The spawned child process, set after connect(). */
  private child: ChildProcess | null = null

  /** Buffered partial line from stdout (JSON may arrive in chunks). */
  private stdoutBuffer = ''

  /** Whether close() has been called. */
  private closed = false

  private constructor(private logger?: Logger) {}

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Spawn a child process for the given stdio transport config and return
   * an McpConnection that can send JSON-RPC requests over stdin/stdout.
   *
   * @param transport - Must be a stdio transport with command + args.
   * @param logger    - Optional logger for stderr and warnings.
   * @returns A connected McpConnection.
   */
  static async connect(
    transport: Extract<McpTransport, { type: 'stdio' }>,
    logger?: Logger,
  ): Promise<McpConnection> {
    const instance = new StdioTransport(logger)
    const connection = await instance.spawn(transport)
    return connection
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  /**
   * Spawn the child process and wire up stdin/stdout/stderr handlers.
   */
  private async spawn(transport: Extract<McpTransport, { type: 'stdio' }>): Promise<McpConnection> {
    const env = sanitizeEnvironment(process.env as Record<string, string>)

    const child = spawn(transport.command, transport.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    })

    this.child = child

    // --- stdout: newline-delimited JSON-RPC responses ---
    child.stdout?.on('data', (chunk: Buffer) => {
      this.stdoutBuffer += chunk.toString('utf-8')
      this.drainBuffer()
    })

    // --- stderr: log as warnings ---
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8').trim()
      if (text) {
        this.logger?.warn(`[stdio:${child.pid}] stderr: ${text}`)
      }
    })

    // --- process exit: reject all pending requests ---
    child.on('exit', (code, signal) => {
      this.logger?.warn(`[stdio:${child.pid}] process exited (code=${code}, signal=${signal})`)
      this.rejectAllPending(
        new Error(`MCP process exited unexpectedly (code=${code}, signal=${signal})`),
      )
    })

    child.on('error', (err) => {
      this.logger?.error(`[stdio:${child.pid}] process error: ${err.message}`)
      this.rejectAllPending(err)
    })

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
   * Send a JSON-RPC 2.0 request over stdin and wait for the matching response.
   *
   * @param method  - The JSON-RPC method name.
   * @param params  - Optional parameters object.
   * @param timeoutMs - Request timeout in milliseconds (default: 30s).
   * @returns The `result` field from the JSON-RPC response.
   * @throws On timeout, process exit, or JSON-RPC error response.
   */
  private request(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS,
  ): Promise<unknown> {
    if (this.closed || !this.child?.stdin?.writable) {
      return Promise.reject(new Error('StdioTransport is closed'))
    }

    const id = this.nextId++

    const message = JSON.stringify({
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

      this.pending.set(id, { resolve, reject, timer })

      // Write the request as a single line followed by newline
      this.child!.stdin!.write(message + '\n', 'utf-8', (err) => {
        if (err) {
          clearTimeout(timer)
          this.pending.delete(id)
          reject(new Error(`Failed to write to stdin: ${err.message}`))
        }
      })
    })
  }

  /**
   * Close the connection. Sends SIGTERM, waits 2 seconds, then SIGKILL
   * if the process is still alive. Rejects all pending requests.
   */
  private async close(connection: McpConnection): Promise<void> {
    if (this.closed) return
    this.closed = true
    connection.connected = false

    this.rejectAllPending(new Error('StdioTransport closed'))

    const child = this.child
    if (!child || child.exitCode !== null) {
      // Already exited
      return
    }

    // Send SIGTERM
    child.kill('SIGTERM')

    // Wait up to SIGKILL_GRACE_MS for graceful exit
    const exited = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        resolve(false)
      }, SIGKILL_GRACE_MS)

      child.once('exit', () => {
        clearTimeout(timer)
        resolve(true)
      })
    })

    // If still alive, force kill
    if (!exited) {
      this.logger?.warn(`[stdio:${child.pid}] SIGTERM timeout, sending SIGKILL`)
      child.kill('SIGKILL')
    }
  }

  /**
   * Drain the stdout buffer, parsing complete lines as JSON-RPC responses.
   * Each line is expected to be a complete JSON object.
   */
  private drainBuffer(): void {
    const lines = this.stdoutBuffer.split('\n')

    // The last element may be an incomplete line — keep it in the buffer
    this.stdoutBuffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue

      try {
        const msg = JSON.parse(trimmed) as {
          jsonrpc?: string
          id?: number
          result?: unknown
          error?: { code?: number; message?: string; data?: unknown }
        }

        // Only handle responses (messages with an id matching a pending request)
        if (msg.id == null) {
          // Could be a notification — ignore for now
          continue
        }

        const pending = this.pending.get(msg.id)
        if (!pending) {
          this.logger?.warn(`[stdio] received response for unknown request id=${msg.id}`)
          continue
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
        this.logger?.warn(`[stdio] failed to parse stdout line: ${trimmed}`)
      }
    }
  }

  /**
   * Reject all pending requests with the given error and clear the map.
   */
  private rejectAllPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(error)
      this.pending.delete(id)
    }
  }
}
