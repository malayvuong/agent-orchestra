import type { ProviderOutput } from '@malayvuong/agent-orchestra-core'
import type { AgentProvider, ProviderInput } from '../types.js'
import { ProviderError } from '../types.js'

/** Anthropic API base URL */
const ANTHROPIC_API_URL = 'https://api.anthropic.com'

/** Anthropic API version header */
const ANTHROPIC_VERSION = '2023-06-01'

/** Pricing per 1M tokens (USD) for Anthropic models */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-20250514': { input: 3, output: 15 },
  'claude-opus-4-20250514': { input: 15, output: 75 },
  'claude-3-5-sonnet-20241022': { input: 3, output: 15 },
  'claude-3-5-haiku-20241022': { input: 0.8, output: 4 },
  'claude-3-opus-20240229': { input: 15, output: 75 },
  'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },
}

/** Default timeout for Anthropic requests (120 seconds) */
const DEFAULT_TIMEOUT_MS = 120_000

/** Default max tokens if not specified */
const DEFAULT_MAX_TOKENS = 4096

/**
 * Configuration options for the Anthropic provider adapter.
 */
export type AnthropicProviderConfig = {
  /** API key; defaults to process.env.ANTHROPIC_API_KEY */
  apiKey?: string
  /** Default model to use when not specified in ProviderInput */
  defaultModel?: string
}

/**
 * Anthropic Messages API provider adapter.
 *
 * Spec v1.3 §13.1 — native Anthropic adapter for non-OpenAI-compatible
 * features. Uses native fetch (Node 20+), no SDK dependency.
 */
export class AnthropicProvider implements AgentProvider {
  private readonly apiKey: string
  private readonly defaultModel: string

  constructor(config: AnthropicProviderConfig = {}) {
    this.apiKey = config.apiKey ?? process.env.ANTHROPIC_API_KEY ?? ''
    this.defaultModel = config.defaultModel ?? 'claude-sonnet-4-20250514'

    if (!this.apiKey) {
      throw new ProviderError(
        'Anthropic API key is required. Set ANTHROPIC_API_KEY environment variable or pass apiKey in config.',
        'auth_error',
      )
    }
  }

  /**
   * Execute a message request against the Anthropic Messages API.
   *
   * @param input - The provider input containing prompts and parameters
   * @returns ProviderOutput with rawText, usage data, and optional structured sections
   * @throws ProviderError on rate limit (429), auth failure (401), server error (5xx), or timeout
   */
  async run(input: ProviderInput): Promise<ProviderOutput> {
    const model = input.model || this.defaultModel
    const maxTokens = input.maxTokens ?? DEFAULT_MAX_TOKENS
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS

    const requestBody = {
      model,
      max_tokens: maxTokens,
      system: input.systemPrompt,
      messages: [{ role: 'user' as const, content: input.userPrompt }],
      ...(input.temperature !== undefined && { temperature: input.temperature }),
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

    // Link external abort signal if provided
    if (input.abortSignal) {
      if (input.abortSignal.aborted) {
        controller.abort()
      } else {
        input.abortSignal.addEventListener('abort', () => controller.abort(), { once: true })
      }
    }

    const startTime = Date.now()

    try {
      const response = await fetch(`${ANTHROPIC_API_URL}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      })

      const latencyMs = Date.now() - startTime

      if (!response.ok) {
        await this.handleErrorResponse(response)
      }

      const data = (await response.json()) as Record<string, unknown>

      return this.parseResponse(data, model, latencyMs)
    } catch (error: unknown) {
      if (error instanceof ProviderError) {
        throw error
      }

      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new ProviderError(
          `Anthropic request timed out after ${timeoutMs}ms`,
          'timeout',
          undefined,
          true,
        )
      }

      throw new ProviderError(
        `Anthropic request failed: ${error instanceof Error ? error.message : String(error)}`,
        'network_error',
        undefined,
        true,
      )
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * Parse the Anthropic Messages API response into a ProviderOutput.
   */
  private parseResponse(
    data: Record<string, unknown>,
    model: string,
    latencyMs: number,
  ): ProviderOutput {
    const content = data.content as Array<{ type: string; text?: string }> | undefined

    if (!content || content.length === 0) {
      throw new ProviderError('Anthropic response contained no content blocks', 'invalid_response')
    }

    // Extract text from the first text content block
    const textBlock = content.find((block) => block.type === 'text')
    const rawText = textBlock?.text ?? ''

    const usage = data.usage as { input_tokens?: number; output_tokens?: number } | undefined

    const inputTokens = usage?.input_tokens
    const outputTokens = usage?.output_tokens

    const cost = this.estimateCost(model, inputTokens, outputTokens)

    const warnings: string[] = []
    const stopReason = data.stop_reason as string | undefined
    if (stopReason === 'max_tokens') {
      warnings.push('Response was truncated due to max_tokens limit')
    }

    return {
      rawText,
      warnings: warnings.length > 0 ? warnings : undefined,
      usage: {
        inputTokens,
        outputTokens,
        cost,
        latencyMs,
      },
    }
  }

  /**
   * Handle non-OK HTTP responses from the Anthropic API.
   */
  private async handleErrorResponse(response: Response): Promise<never> {
    let errorMessage: string

    try {
      const errorData = (await response.json()) as {
        error?: { message?: string; type?: string }
      }
      errorMessage = errorData.error?.message ?? response.statusText
    } catch {
      errorMessage = response.statusText
    }

    switch (response.status) {
      case 401:
        throw new ProviderError(
          `Anthropic authentication failed: ${errorMessage}`,
          'auth_error',
          401,
        )
      case 429: {
        const retryAfter = response.headers.get('retry-after')
        const retryAfterMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : undefined
        throw new ProviderError(
          `Anthropic rate limit exceeded: ${errorMessage}`,
          'rate_limit',
          429,
          true,
          retryAfterMs,
        )
      }
      default:
        if (response.status >= 500) {
          throw new ProviderError(
            `Anthropic server error (${response.status}): ${errorMessage}`,
            'server_error',
            response.status,
            true,
          )
        }
        throw new ProviderError(
          `Anthropic request failed (${response.status}): ${errorMessage}`,
          'server_error',
          response.status,
        )
    }
  }

  /**
   * Estimate cost based on model pricing and token usage.
   */
  private estimateCost(
    model: string,
    inputTokens?: number,
    outputTokens?: number,
  ): number | undefined {
    const pricing = MODEL_PRICING[model]
    if (!pricing || inputTokens === undefined || outputTokens === undefined) {
      return undefined
    }

    return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output
  }
}
