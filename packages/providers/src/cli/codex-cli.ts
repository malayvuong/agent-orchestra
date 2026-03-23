import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ProviderOutput } from '@malayvuong/agent-orchestra-core'
import type { AgentProvider, ProviderInput } from '../types.js'
import { ProviderError } from '../types.js'
import { getDefaultModelForProvider } from '../default-models.js'

/** Default timeout for Codex CLI (5 minutes) */
const DEFAULT_TIMEOUT_MS = 300_000

/**
 * Configuration options for the Codex CLI provider.
 */
export type CodexCliProviderConfig = {
  /** Path to the codex binary; defaults to 'codex' (from PATH) */
  command?: string
  /** Default model; defaults to 'gpt-5.4' */
  defaultModel?: string
}

/**
 * Provider adapter that uses the OpenAI Codex CLI (`codex`) as the LLM backend.
 *
 * Invokes `codex exec --model <model> -` as a subprocess.
 * The CLI handles its own authentication — no API key required if already logged in.
 *
 * Prompts are passed via stdin, and the last agent message is collected via
 * `--output-last-message` to avoid parsing progress output from stdout.
 */
export class CodexCliProvider implements AgentProvider {
  private readonly command: string
  private readonly defaultModel: string

  constructor(config: CodexCliProviderConfig = {}) {
    this.command = config.command ?? 'codex'
    this.defaultModel = config.defaultModel ?? getDefaultModelForProvider('codex-cli')
  }

  async run(input: ProviderInput): Promise<ProviderOutput> {
    const model = input.model || this.defaultModel
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const startTime = Date.now()

    const combinedPrompt = `${input.systemPrompt}\n\n---\n\n${input.userPrompt}`

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

      const tempDirPromise = mkdtemp(join(tmpdir(), 'ao-codex-cli-'))
      void tempDirPromise
        .then(async (tempDir) => {
          const outputPath = join(tempDir, 'last-message.txt')
          const cleanup = async () => {
            await rm(tempDir, { recursive: true, force: true })
          }
          const args = ['exec', '--model', model, '--output-last-message', outputPath, '-']

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
                `Codex CLI stdin error: ${err.message}`,
                'server_error',
                undefined,
                true,
              ),
            )
          })

          child.stdin.end(combinedPrompt)

          let stdout = ''
          let stderr = ''

          child.stdout.on('data', (chunk: Buffer) => {
            stdout += chunk.toString()
          })

          child.stderr.on('data', (chunk: Buffer) => {
            stderr += chunk.toString()
          })

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
              void cleanup()
              rejectOnce(
                new ProviderError(
                  `Codex CLI not found. Install it with 'npm install -g @openai/codex' or check your PATH.`,
                  'auth_error',
                ),
              )
            } else {
              void cleanup()
              rejectOnce(
                new ProviderError(
                  `Codex CLI error: ${err.message}`,
                  'server_error',
                  undefined,
                  true,
                ),
              )
            }
          })

          child.on('close', async (code) => {
            const latencyMs = Date.now() - startTime

            if (code !== 0) {
              if (
                stderr.includes('authentication') ||
                stderr.includes('API key') ||
                stderr.includes('login')
              ) {
                rejectOnce(
                  new ProviderError(
                    `Codex CLI authentication failed. Run 'codex login' or set OPENAI_API_KEY. stderr: ${stderr.slice(0, 300)}`,
                    'auth_error',
                  ),
                )
                await cleanup()
                return
              }

              if (code === null) {
                rejectOnce(
                  new ProviderError(
                    `Codex CLI timed out after ${timeoutMs}ms`,
                    'timeout',
                    undefined,
                    true,
                  ),
                )
                await cleanup()
                return
              }

              rejectOnce(
                new ProviderError(
                  `Codex CLI exited with code ${code}. stderr: ${stderr.slice(0, 500)}`,
                  'server_error',
                  code,
                  true,
                ),
              )
              await cleanup()
              return
            }

            let finalText = stdout.trim()
            try {
              finalText = (await readFile(outputPath, 'utf-8')).trim() || finalText
            } catch {
              // Fall back to stdout when the output file is not created.
            }

            const warnings: string[] = []
            if (stderr) {
              const filtered = stderr.trim()
              if (filtered) warnings.push(filtered.slice(0, 300))
            }

            resolveOnce({
              rawText: finalText,
              warnings: warnings.length > 0 ? warnings : undefined,
              usage: {
                latencyMs,
              },
              exitCode: code,
              stderrText: stderr || undefined,
            })
            await cleanup()
          })
        })
        .catch((err: unknown) => {
          rejectOnce(
            new ProviderError(
              `Codex CLI setup error: ${err instanceof Error ? err.message : String(err)}`,
              'server_error',
              undefined,
              true,
            ),
          )
        })
    })
  }
}
