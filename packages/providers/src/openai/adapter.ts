import type { ProviderOutput } from '@malayvuong/agent-orchestra-core'
import { getDefaultModelForProvider } from '@malayvuong/agent-orchestra-shared'
import type { AgentProvider, ProviderInput } from '../types.js'
import { ProviderError } from '../types.js'

/** Pricing per 1M tokens (USD) for common OpenAI models */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-5.4': { input: 2.5, output: 10 },
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4-turbo': { input: 10, output: 30 },
  'gpt-4': { input: 30, output: 60 },
  'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
}

/** Default timeout for OpenAI requests (120 seconds) */
const DEFAULT_TIMEOUT_MS = 120_000

/** Default max tokens if not specified */
const DEFAULT_MAX_TOKENS = 4096

/**
 * Configuration options for the OpenAI provider adapter.
 */
export type OpenAIProviderConfig = {
  /** API key; defaults to process.env.OPENAI_API_KEY */
  apiKey?: string
  /** Base URL for the API; defaults to 'https://api.openai.com' */
  baseUrl?: string
  /** Default model to use when not specified in ProviderInput */
  defaultModel?: string
}

/**
 * OpenAI-compatible provider adapter.
 *
 * Spec v1.3 §13.1 — covers OpenAI, Azure, and local proxies via
 * configurable baseUrl. Uses native fetch (Node 20+), no SDK dependency.
 */
export class OpenAIProvider implements AgentProvider {
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly defaultModel: string

  /**
   * Hostnames/IP patterns that must not be used as baseUrl (SSRF prevention).
   * localhost and 127.0.0.1 are intentionally allowed for local model proxies
   * (e.g. Ollama, LM Studio, vLLM).
   */
  private static readonly BLOCKED_BASE_HOSTS =
    /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|0\.0\.0\.0)/i

  constructor(config: OpenAIProviderConfig = {}) {
    this.apiKey = config.apiKey ?? process.env.OPENAI_API_KEY ?? ''
    this.baseUrl = (config.baseUrl ?? 'https://api.openai.com').replace(/\/+$/, '')
    this.defaultModel = config.defaultModel ?? getDefaultModelForProvider('openai')

    if (!this.apiKey) {
      throw new ProviderError(
        'OpenAI API key is required. Set OPENAI_API_KEY environment variable or pass apiKey in config.',
        'auth_error',
      )
    }

    // Validate baseUrl to prevent SSRF and credential leakage to internal hosts
    if (config.baseUrl) {
      try {
        const url = new URL(this.baseUrl)
        if (OpenAIProvider.BLOCKED_BASE_HOSTS.test(url.hostname)) {
          throw new ProviderError(
            `OpenAI baseUrl points to a blocked internal address: ${url.hostname}`,
            'auth_error',
          )
        }
      } catch (err) {
        if (err instanceof ProviderError) throw err
        throw new ProviderError(`Invalid OpenAI baseUrl: ${this.baseUrl}`, 'auth_error')
      }
    }
  }

  /**
   * Execute a chat completion request against the OpenAI API.
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
      messages: [
        { role: 'system' as const, content: input.systemPrompt },
        { role: 'user' as const, content: input.userPrompt },
      ],
      max_tokens: maxTokens,
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
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
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
          `OpenAI request timed out after ${timeoutMs}ms`,
          'timeout',
          undefined,
          true,
        )
      }

      throw new ProviderError(
        `OpenAI request failed: ${error instanceof Error ? error.message : String(error)}`,
        'network_error',
        undefined,
        true,
      )
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * Parse the OpenAI API response into a ProviderOutput.
   */
  private parseResponse(
    data: Record<string, unknown>,
    model: string,
    latencyMs: number,
  ): ProviderOutput {
    const choices = data.choices as Array<{
      message?: { content?: string }
      finish_reason?: string
    }>

    if (!choices || choices.length === 0) {
      throw new ProviderError('OpenAI response contained no choices', 'invalid_response')
    }

    const rawText = choices[0]?.message?.content ?? ''

    const usage = data.usage as
      | { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
      | undefined

    const inputTokens = usage?.prompt_tokens
    const outputTokens = usage?.completion_tokens

    const cost = this.estimateCost(model, inputTokens, outputTokens)

    const warnings: string[] = []
    if (choices[0]?.finish_reason === 'length') {
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
   * Handle non-OK HTTP responses from the OpenAI API.
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
        throw new ProviderError(`OpenAI authentication failed: ${errorMessage}`, 'auth_error', 401)
      case 429: {
        const retryAfter = response.headers.get('retry-after')
        const retryAfterMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : undefined
        throw new ProviderError(
          `OpenAI rate limit exceeded: ${errorMessage}`,
          'rate_limit',
          429,
          true,
          retryAfterMs,
        )
      }
      default:
        if (response.status >= 500) {
          throw new ProviderError(
            `OpenAI server error (${response.status}): ${errorMessage}`,
            'server_error',
            response.status,
            true,
          )
        }
        throw new ProviderError(
          `OpenAI request failed (${response.status}): ${errorMessage}`,
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
