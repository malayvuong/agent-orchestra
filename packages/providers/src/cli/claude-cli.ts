import { spawn } from 'node:child_process'
import type { ProviderOutput } from '@malayvuong/agent-orchestra-core'
import { getDefaultModelForProvider } from '@malayvuong/agent-orchestra-shared'
import type { AgentProvider, ProviderInput } from '../types.js'
import { ProviderError } from '../types.js'

/** Default timeout for Claude CLI (15 minutes — iterative debate on large documents can be slow) */
const DEFAULT_TIMEOUT_MS = 900_000

/**
 * Approximate character limits for prompts sent to Claude CLI.
 *
 * Claude CLI adds its own system prompt (~30K tokens of tool definitions and
 * instructions) on top of the user-provided content.  The available context
 * depends on the model suffix:
 *
 *   - `claude-opus-4-6`      → 200K tokens (~695K chars empirically)
 *   - `claude-opus-4-6[1m]`  → 1M tokens  (~3.5M chars empirically)
 *
 * We apply conservative limits with headroom for the internal system prompt.
 */
const MAX_PROMPT_CHARS_200K = 680_000
const MAX_PROMPT_CHARS_1M = 3_400_000

/** Returns the prompt char limit based on model ID (1M models get a larger budget). */
function maxPromptCharsForModel(model: string): number {
  return model.includes('[1m]') ? MAX_PROMPT_CHARS_1M : MAX_PROMPT_CHARS_200K
}

/**
 * Configuration options for the Claude CLI provider.
 */
export type ClaudeCliProviderConfig = {
  /** Path to the claude binary; defaults to 'claude' (from PATH) */
  command?: string
  /** Default model; defaults to 'claude-opus-4-6[1m]' (1M context) */
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
    this.defaultModel = config.defaultModel ?? getDefaultModelForProvider('claude-cli')
  }

  async run(input: ProviderInput): Promise<ProviderOutput> {
    const model = input.model || this.defaultModel
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const startTime = Date.now()

    // Separate system prompt from user prompt.  Passing the system prompt via
    // `--system-prompt` replaces Claude CLI's default (tool-heavy) system prompt,
    // freeing context window space for the actual content.
    const userPrompt = input.userPrompt

    // Pre-flight size check — fail fast with a clear message instead of an
    // opaque "Prompt is too long" from the CLI subprocess.
    const estimatedChars = (input.systemPrompt?.length ?? 0) + userPrompt.length
    const limit = maxPromptCharsForModel(model)
    if (estimatedChars > limit) {
      const hint = !model.includes('[1m]')
        ? ` Try using the 1M context model (e.g. claude-opus-4-6[1m]).`
        : ''
      throw new ProviderError(
        `Prompt too large for Claude CLI (${Math.round(estimatedChars / 1000)}K chars, limit ~${Math.round(limit / 1000)}K).${hint} ` +
          `Reduce target content or split across multiple reviews.`,
        'invalid_response',
      )
    }

    // Use stdin for prompt delivery to avoid OS argument length limits (~256KB on macOS).
    // Claude CLI reads from stdin when `-p` is given without an argument value.
    const args = ['-p', '--model', model, '--output-format', 'text']

    // macOS ARG_MAX is ~262144 bytes.  Keep a safety margin for env vars and
    // other arguments already on the command line.
    const SYSTEM_PROMPT_CLI_LIMIT = 200_000

    // Pass agent-orchestra's system prompt via --system-prompt so it replaces
    // Claude CLI's default tool-heavy system prompt, maximizing available
    // context for the actual review content.
    //
    // When the system prompt exceeds the OS argument-length limit we fold it
    // into the stdin payload instead — slightly less optimal (Claude CLI keeps
    // its default system prompt) but avoids an E2BIG spawn failure.
    const systemPromptViaStdin =
      input.systemPrompt && input.systemPrompt.length > SYSTEM_PROMPT_CLI_LIMIT
    if (input.systemPrompt && !systemPromptViaStdin) {
      args.push('--system-prompt', input.systemPrompt)
    }

    const stdinContent = systemPromptViaStdin
      ? `<system-instructions>\n${input.systemPrompt}\n</system-instructions>\n\n${userPrompt}`
      : userPrompt

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

      // Write prompt content to stdin (system prompt may be folded in for large prompts)
      child.stdin.end(stdinContent)

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
          // Use combined output for error detection — Claude CLI may write
          // error messages to stdout, stderr, or both depending on the error.
          const combined = `${stderr}\n${stdout}`

          // Check for common error patterns
          if (
            combined.includes('authentication') ||
            combined.includes('login') ||
            combined.includes('not logged in')
          ) {
            rejectOnce(
              new ProviderError(
                `Claude CLI authentication failed. Run 'claude login' first. stderr: ${stderr.slice(0, 300)}`,
                'auth_error',
              ),
            )
            return
          }

          if (
            combined.includes('Prompt is too long') ||
            combined.includes('prompt is too long') ||
            combined.includes('too many tokens')
          ) {
            rejectOnce(
              new ProviderError(
                `Prompt too large for Claude CLI context window. ` +
                  `Reduce target content or split across multiple reviews.`,
                'invalid_response',
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

          // Include stdout in error when stderr is empty — some errors only appear on stdout
          const errorDetail = stderr.trim() || stdout.trim()
          rejectOnce(
            new ProviderError(
              `Claude CLI exited with code ${code}. ${errorDetail ? `Output: ${errorDetail.slice(0, 500)}` : '(no output)'}`,
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
