import type { ProviderOutput } from '@malayvuong/agent-orchestra-core'

/**
 * Input to an LLM provider adapter.
 *
 * Spec v1.3 §23.3 — the provider adapter receives this and returns
 * a ProviderOutput after calling the upstream API.
 */
export type ProviderInput = {
  /** System-level instructions for the model */
  systemPrompt: string
  /** User-facing prompt content */
  userPrompt: string
  /** Model identifier (e.g. 'gpt-4o', 'claude-sonnet-4-20250514') */
  model: string
  /** Maximum tokens to generate */
  maxTokens?: number
  /** Sampling temperature (0-2) */
  temperature?: number
  /** Request timeout in milliseconds */
  timeoutMs?: number
  /** Abort signal for cancellation support */
  abortSignal?: AbortSignal
}

/**
 * Contract for LLM provider adapters.
 *
 * Spec v1.3 §23.3 — each provider handles its own response format
 * internally and returns a consistent ProviderOutput.
 */
export interface AgentProvider {
  /** Execute a prompt against the provider and return normalized output */
  run(input: ProviderInput): Promise<ProviderOutput>
}

/**
 * Configuration for provider error responses.
 */
export type ProviderErrorCode =
  | 'rate_limit'
  | 'auth_error'
  | 'server_error'
  | 'timeout'
  | 'network_error'
  | 'invalid_response'

/**
 * Structured error thrown by provider adapters.
 */
export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly code: ProviderErrorCode,
    public readonly statusCode?: number,
    public readonly retryable: boolean = false,
    public readonly retryAfterMs?: number,
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}
