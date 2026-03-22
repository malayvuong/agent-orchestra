import { spawn } from 'node:child_process'
import type { ProviderOutput } from '@malayvuong/agent-orchestra-core'
import type { AgentProvider, ProviderInput } from '../types.js'
import { ProviderError } from '../types.js'

/** Default timeout for Claude CLI (15 minutes — iterative debate on large documents can be slow) */
const DEFAULT_TIMEOUT_MS = 900_000

/**
 * Configuration options for the Claude CLI provider.
 */
export type ClaudeCliProviderConfig = {
  /** Path to the claude binary; defaults to 'claude' (from PATH) */
  command?: string
  /** Default model; defaults to 'sonnet' */
  defaultModel?: string
}

/**
 * Provider adapter that uses the Claude Code CLI (`claude`) as the LLM backend.
 *
 * Invokes `claude -p <prompt> --model <model> --output-format text` as a subprocess.
 * The CLI handles its own authentication — no API key required if already logged in.
 *
 * Prompts are piped via stdin to avoid shell escaping issues with large content.
 */
export class ClaudeCliProvider implements AgentProvider {
  private readonly command: string
  private readonly defaultModel: string

  constructor(config: ClaudeCliProviderConfig = {}) {
    this.command = config.command ?? 'claude'
    this.defaultModel = config.defaultModel ?? 'sonnet'
  }

  async run(input: ProviderInput): Promise<ProviderOutput> {
    const model = input.model || this.defaultModel
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const startTime = Date.now()

    // Combine system + user prompts for single-turn CLI invocation
    const combinedPrompt = `${input.systemPrompt}\n\n---\n\n${input.userPrompt}`

    // Use stdin for prompt delivery to avoid OS argument length limits (~256KB on macOS).
    // Claude CLI reads from stdin when `-p` is given without an argument value.
    const args = ['-p', '--model', model, '--output-format', 'text']

    if (input.maxTokens) {
      args.push('--max-tokens', String(input.maxTokens))
    }

    return new Promise<ProviderOutput>((resolve, reject) => {
      let settled = false
      const resolveOnce = (value: ProviderOutput) => {
        if (settled) return
        settled = true
        resolve(value)
      }
      const rejectOnce = (error: ProviderError) => {
        if (settled) return
        settled = true
        reject(error)
      }

      const child = spawn(this.command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: timeoutMs,
      })

      child.stdin.on('error', (err) => {
        const code = (err as NodeJS.ErrnoException).code
        if (code === 'EPIPE' || code === 'ERR_STREAM_DESTROYED') {
          return
        }

        rejectOnce(
          new ProviderError(
            `Claude CLI stdin error: ${err.message}`,
            'server_error',
            undefined,
            true,
          ),
        )
      })

      // Write prompt to stdin
      child.stdin.end(combinedPrompt)

      let stdout = ''
      let stderr = ''

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString()
      })

      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })

      // Support abort signal
      if (input.abortSignal) {
        if (input.abortSignal.aborted) {
          child.kill('SIGTERM')
        } else {
          input.abortSignal.addEventListener(
            'abort',
            () => {
              child.kill('SIGTERM')
            },
            { once: true },
          )
        }
      }

      child.on('error', (err) => {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          rejectOnce(
            new ProviderError(
              `Claude CLI not found. Install it from https://claude.ai/download or check your PATH.`,
              'auth_error',
            ),
          )
        } else {
          rejectOnce(
            new ProviderError(`Claude CLI error: ${err.message}`, 'server_error', undefined, true),
          )
        }
      })

      child.on('close', (code) => {
        const latencyMs = Date.now() - startTime

        if (code !== 0) {
          // Check for common error patterns
          if (
            stderr.includes('authentication') ||
            stderr.includes('login') ||
            stderr.includes('not logged in')
          ) {
            rejectOnce(
              new ProviderError(
                `Claude CLI authentication failed. Run 'claude login' first. stderr: ${stderr.slice(0, 300)}`,
                'auth_error',
              ),
            )
            return
          }

          if (code === null) {
            rejectOnce(
              new ProviderError(
                `Claude CLI timed out after ${timeoutMs}ms`,
                'timeout',
                undefined,
                true,
              ),
            )
            return
          }

          rejectOnce(
            new ProviderError(
              `Claude CLI exited with code ${code}. stderr: ${stderr.slice(0, 500)}`,
              'server_error',
              code,
              true,
            ),
          )
          return
        }

        const warnings: string[] = []
        if (stderr && !stderr.startsWith('[')) {
          // Non-progress stderr output may contain warnings
          const filtered = stderr.trim()
          if (filtered) warnings.push(filtered.slice(0, 300))
        }

        resolveOnce({
          rawText: stdout.trim(),
          warnings: warnings.length > 0 ? warnings : undefined,
          usage: {
            latencyMs,
          },
          exitCode: code,
          stderrText: stderr || undefined,
        })
      })
    })
  }
}
