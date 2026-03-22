import { spawn } from 'node:child_process'
import type { ProviderOutput } from '@agent-orchestra/core'
import type { AgentProvider, ProviderInput } from '../types.js'
import { ProviderError } from '../types.js'

/** Default timeout for Codex CLI (5 minutes) */
const DEFAULT_TIMEOUT_MS = 300_000

/**
 * Configuration options for the Codex CLI provider.
 */
export type CodexCliProviderConfig = {
  /** Path to the codex binary; defaults to 'codex' (from PATH) */
  command?: string
  /** Default model; defaults to 'o4-mini' */
  defaultModel?: string
}

/**
 * Provider adapter that uses the OpenAI Codex CLI (`codex`) as the LLM backend.
 *
 * Invokes `codex -p <prompt> --model <model>` as a subprocess.
 * The CLI handles its own authentication — no API key required if already logged in.
 *
 * Prompts are passed via the -p flag with the full combined prompt.
 */
export class CodexCliProvider implements AgentProvider {
  private readonly command: string
  private readonly defaultModel: string

  constructor(config: CodexCliProviderConfig = {}) {
    this.command = config.command ?? 'codex'
    this.defaultModel = config.defaultModel ?? 'o4-mini'
  }

  async run(input: ProviderInput): Promise<ProviderOutput> {
    const model = input.model || this.defaultModel
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const startTime = Date.now()

    // Combine system + user prompts
    const combinedPrompt = `${input.systemPrompt}\n\n---\n\n${input.userPrompt}`

    const args = ['-p', combinedPrompt, '--model', model]

    return new Promise<ProviderOutput>((resolve, reject) => {
      const child = spawn(this.command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: timeoutMs,
      })

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
          reject(
            new ProviderError(
              `Codex CLI not found. Install it with 'npm install -g @openai/codex' or check your PATH.`,
              'auth_error',
            ),
          )
        } else {
          reject(
            new ProviderError(`Codex CLI error: ${err.message}`, 'server_error', undefined, true),
          )
        }
      })

      child.on('close', (code) => {
        const latencyMs = Date.now() - startTime

        if (code !== 0) {
          if (
            stderr.includes('authentication') ||
            stderr.includes('API key') ||
            stderr.includes('login')
          ) {
            reject(
              new ProviderError(
                `Codex CLI authentication failed. Run 'codex login' or set OPENAI_API_KEY. stderr: ${stderr.slice(0, 300)}`,
                'auth_error',
              ),
            )
            return
          }

          if (code === null) {
            reject(
              new ProviderError(
                `Codex CLI timed out after ${timeoutMs}ms`,
                'timeout',
                undefined,
                true,
              ),
            )
            return
          }

          reject(
            new ProviderError(
              `Codex CLI exited with code ${code}. stderr: ${stderr.slice(0, 500)}`,
              'server_error',
              code,
              true,
            ),
          )
          return
        }

        const warnings: string[] = []
        if (stderr) {
          const filtered = stderr.trim()
          if (filtered) warnings.push(filtered.slice(0, 300))
        }

        resolve({
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
