import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AnthropicProvider } from '../anthropic/adapter.js'
import { ProviderError } from '../types.js'

/**
 * Create a mock Response object for fetch.
 */
function mockResponse(
  body: unknown,
  options: { status?: number; headers?: Record<string, string> } = {},
): Response {
  const { status = 200, headers = {} } = options
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: new Headers(headers),
    json: async () => body,
  } as unknown as Response
}

describe('AnthropicProvider', () => {
  let originalFetch: typeof globalThis.fetch
  let originalEnv: string | undefined

  beforeEach(() => {
    originalFetch = globalThis.fetch
    originalEnv = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = 'test-api-key'
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    if (originalEnv !== undefined) {
      process.env.ANTHROPIC_API_KEY = originalEnv
    } else {
      delete process.env.ANTHROPIC_API_KEY
    }
    vi.restoreAllMocks()
  })

  describe('constructor', () => {
    it('should use provided apiKey over env variable', () => {
      const provider = new AnthropicProvider({ apiKey: 'custom-key' })
      expect(provider).toBeDefined()
    })

    it('should use env variable when no apiKey provided', () => {
      process.env.ANTHROPIC_API_KEY = 'env-key'
      const provider = new AnthropicProvider()
      expect(provider).toBeDefined()
    })

    it('should throw ProviderError when no API key available', () => {
      delete process.env.ANTHROPIC_API_KEY
      expect(() => new AnthropicProvider()).toThrow(ProviderError)
      expect(() => new AnthropicProvider()).toThrow('Anthropic API key is required')
    })
  })

  describe('run - successful response', () => {
    it('should return ProviderOutput on successful completion', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResponse({
          content: [{ type: 'text', text: '## Findings\n\n### Finding 1\nSome finding' }],
          stop_reason: 'end_turn',
          usage: {
            input_tokens: 100,
            output_tokens: 50,
          },
        }),
      )
      globalThis.fetch = mockFetch

      const provider = new AnthropicProvider({ apiKey: 'test-key' })
      const result = await provider.run({
        systemPrompt: 'You are a reviewer.',
        userPrompt: 'Review this code.',
        model: 'claude-sonnet-4-20250514',
      })

      expect(result.rawText).toBe('## Findings\n\n### Finding 1\nSome finding')
      expect(result.usage?.inputTokens).toBe(100)
      expect(result.usage?.outputTokens).toBe(50)
      expect(result.usage?.cost).toBeDefined()
      expect(result.usage?.latencyMs).toBeGreaterThanOrEqual(0)

      // Verify fetch was called with correct parameters
      expect(mockFetch).toHaveBeenCalledOnce()
      const [url, options] = mockFetch.mock.calls[0]
      expect(url).toBe('https://api.anthropic.com/v1/messages')
      expect(options.method).toBe('POST')
      expect(options.headers['x-api-key']).toBe('test-key')
      expect(options.headers['anthropic-version']).toBe('2023-06-01')

      const body = JSON.parse(options.body)
      expect(body.model).toBe('claude-sonnet-4-20250514')
      expect(body.system).toBe('You are a reviewer.')
      expect(body.messages).toHaveLength(1)
      expect(body.messages[0].role).toBe('user')
    })

    it('should use default model when not specified', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResponse({
          content: [{ type: 'text', text: 'response' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      )
      globalThis.fetch = mockFetch

      const provider = new AnthropicProvider({
        apiKey: 'key',
        defaultModel: 'claude-3-haiku-20240307',
      })
      await provider.run({
        systemPrompt: 'sys',
        userPrompt: 'user',
        model: '',
      })

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.model).toBe('claude-3-haiku-20240307')
    })

    it('should add warning when response is truncated', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResponse({
          content: [{ type: 'text', text: 'truncated...' }],
          stop_reason: 'max_tokens',
          usage: { input_tokens: 10, output_tokens: 4096 },
        }),
      )
      globalThis.fetch = mockFetch

      const provider = new AnthropicProvider({ apiKey: 'key' })
      const result = await provider.run({
        systemPrompt: 'sys',
        userPrompt: 'user',
        model: 'claude-sonnet-4-20250514',
      })

      expect(result.warnings).toContain('Response was truncated due to max_tokens limit')
    })

    it('should include temperature when specified', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResponse({
          content: [{ type: 'text', text: 'response' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      )
      globalThis.fetch = mockFetch

      const provider = new AnthropicProvider({ apiKey: 'key' })
      await provider.run({
        systemPrompt: 'sys',
        userPrompt: 'user',
        model: 'claude-sonnet-4-20250514',
        temperature: 0.3,
      })

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.temperature).toBe(0.3)
    })
  })

  describe('run - error handling', () => {
    it('should throw ProviderError with rate_limit code on 429', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValue(
          mockResponse(
            { error: { message: 'Rate limit exceeded', type: 'rate_limit_error' } },
            { status: 429, headers: { 'retry-after': '60' } },
          ),
        )
      globalThis.fetch = mockFetch

      const provider = new AnthropicProvider({ apiKey: 'key' })
      const error = await provider
        .run({
          systemPrompt: 'sys',
          userPrompt: 'user',
          model: 'claude-sonnet-4-20250514',
        })
        .catch((e: unknown) => e)

      expect(error).toBeInstanceOf(ProviderError)
      const providerError = error as ProviderError
      expect(providerError.code).toBe('rate_limit')
      expect(providerError.statusCode).toBe(429)
      expect(providerError.retryable).toBe(true)
      expect(providerError.retryAfterMs).toBe(60000)
    })

    it('should throw ProviderError with auth_error code on 401', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValue(mockResponse({ error: { message: 'Invalid API key' } }, { status: 401 }))
      globalThis.fetch = mockFetch

      const provider = new AnthropicProvider({ apiKey: 'bad-key' })
      const error = await provider
        .run({
          systemPrompt: 'sys',
          userPrompt: 'user',
          model: 'claude-sonnet-4-20250514',
        })
        .catch((e: unknown) => e)

      expect(error).toBeInstanceOf(ProviderError)
      const providerError = error as ProviderError
      expect(providerError.code).toBe('auth_error')
      expect(providerError.statusCode).toBe(401)
      expect(providerError.retryable).toBe(false)
    })

    it('should throw ProviderError with server_error code on 500', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValue(
          mockResponse({ error: { message: 'Internal server error' } }, { status: 500 }),
        )
      globalThis.fetch = mockFetch

      const provider = new AnthropicProvider({ apiKey: 'key' })
      const error = await provider
        .run({
          systemPrompt: 'sys',
          userPrompt: 'user',
          model: 'claude-sonnet-4-20250514',
        })
        .catch((e: unknown) => e)

      expect(error).toBeInstanceOf(ProviderError)
      const providerError = error as ProviderError
      expect(providerError.code).toBe('server_error')
      expect(providerError.statusCode).toBe(500)
      expect(providerError.retryable).toBe(true)
    })

    it('should throw ProviderError with timeout code on abort', async () => {
      const mockFetch = vi
        .fn()
        .mockRejectedValue(new DOMException('The operation was aborted', 'AbortError'))
      globalThis.fetch = mockFetch

      const provider = new AnthropicProvider({ apiKey: 'key' })
      const error = await provider
        .run({
          systemPrompt: 'sys',
          userPrompt: 'user',
          model: 'claude-sonnet-4-20250514',
          timeoutMs: 1000,
        })
        .catch((e: unknown) => e)

      expect(error).toBeInstanceOf(ProviderError)
      const providerError = error as ProviderError
      expect(providerError.code).toBe('timeout')
      expect(providerError.retryable).toBe(true)
    })

    it('should throw ProviderError with network_error on fetch failure', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
      globalThis.fetch = mockFetch

      const provider = new AnthropicProvider({ apiKey: 'key' })
      const error = await provider
        .run({
          systemPrompt: 'sys',
          userPrompt: 'user',
          model: 'claude-sonnet-4-20250514',
        })
        .catch((e: unknown) => e)

      expect(error).toBeInstanceOf(ProviderError)
      const providerError = error as ProviderError
      expect(providerError.code).toBe('network_error')
      expect(providerError.retryable).toBe(true)
    })

    it('should throw ProviderError with invalid_response when no content', async () => {
      const mockFetch = vi.fn().mockResolvedValue(mockResponse({ content: [] }))
      globalThis.fetch = mockFetch

      const provider = new AnthropicProvider({ apiKey: 'key' })
      const error = await provider
        .run({
          systemPrompt: 'sys',
          userPrompt: 'user',
          model: 'claude-sonnet-4-20250514',
        })
        .catch((e: unknown) => e)

      expect(error).toBeInstanceOf(ProviderError)
      const providerError = error as ProviderError
      expect(providerError.code).toBe('invalid_response')
    })
  })

  describe('run - cost estimation', () => {
    it('should estimate cost for known models', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResponse({
          content: [{ type: 'text', text: 'response' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 1000, output_tokens: 500 },
        }),
      )
      globalThis.fetch = mockFetch

      const provider = new AnthropicProvider({ apiKey: 'key' })
      const result = await provider.run({
        systemPrompt: 'sys',
        userPrompt: 'user',
        model: 'claude-sonnet-4-20250514',
      })

      // claude-sonnet-4-20250514: $3/1M input, $15/1M output
      // cost = (1000/1M * 3) + (500/1M * 15) = 0.003 + 0.0075 = 0.0105
      expect(result.usage?.cost).toBeCloseTo(0.0105, 6)
    })

    it('should return undefined cost for unknown models', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResponse({
          content: [{ type: 'text', text: 'response' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 1000, output_tokens: 500 },
        }),
      )
      globalThis.fetch = mockFetch

      const provider = new AnthropicProvider({ apiKey: 'key' })
      const result = await provider.run({
        systemPrompt: 'sys',
        userPrompt: 'user',
        model: 'custom-model',
      })

      expect(result.usage?.cost).toBeUndefined()
    })
  })
})
