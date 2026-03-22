import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OpenAIProvider } from '../openai/adapter.js'
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

describe('OpenAIProvider', () => {
  let originalFetch: typeof globalThis.fetch
  let originalEnv: string | undefined

  beforeEach(() => {
    originalFetch = globalThis.fetch
    originalEnv = process.env.OPENAI_API_KEY
    process.env.OPENAI_API_KEY = 'test-api-key'
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    if (originalEnv !== undefined) {
      process.env.OPENAI_API_KEY = originalEnv
    } else {
      delete process.env.OPENAI_API_KEY
    }
    vi.restoreAllMocks()
  })

  describe('constructor', () => {
    it('should use provided apiKey over env variable', () => {
      const provider = new OpenAIProvider({ apiKey: 'custom-key' })
      expect(provider).toBeDefined()
    })

    it('should use env variable when no apiKey provided', () => {
      process.env.OPENAI_API_KEY = 'env-key'
      const provider = new OpenAIProvider()
      expect(provider).toBeDefined()
    })

    it('should throw ProviderError when no API key available', () => {
      delete process.env.OPENAI_API_KEY
      expect(() => new OpenAIProvider()).toThrow(ProviderError)
      expect(() => new OpenAIProvider()).toThrow('OpenAI API key is required')
    })

    it('should accept custom baseUrl', () => {
      const provider = new OpenAIProvider({
        apiKey: 'key',
        baseUrl: 'http://localhost:8080',
      })
      expect(provider).toBeDefined()
    })
  })

  describe('run - successful response', () => {
    it('should return ProviderOutput on successful completion', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResponse({
          choices: [
            {
              message: { content: '## Findings\n\n### Finding 1\nSome finding' },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 50,
            total_tokens: 150,
          },
        }),
      )
      globalThis.fetch = mockFetch

      const provider = new OpenAIProvider({ apiKey: 'test-key' })
      const result = await provider.run({
        systemPrompt: 'You are a reviewer.',
        userPrompt: 'Review this code.',
        model: 'gpt-4o',
      })

      expect(result.rawText).toBe('## Findings\n\n### Finding 1\nSome finding')
      expect(result.usage?.inputTokens).toBe(100)
      expect(result.usage?.outputTokens).toBe(50)
      expect(result.usage?.cost).toBeDefined()
      expect(result.usage?.latencyMs).toBeGreaterThanOrEqual(0)

      // Verify fetch was called with correct parameters
      expect(mockFetch).toHaveBeenCalledOnce()
      const [url, options] = mockFetch.mock.calls[0]
      expect(url).toBe('https://api.openai.com/v1/chat/completions')
      expect(options.method).toBe('POST')
      expect(options.headers['Authorization']).toBe('Bearer test-key')

      const body = JSON.parse(options.body)
      expect(body.model).toBe('gpt-4o')
      expect(body.messages).toHaveLength(2)
      expect(body.messages[0].role).toBe('system')
      expect(body.messages[1].role).toBe('user')
    })

    it('should use default model when not specified', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResponse({
          choices: [{ message: { content: 'response' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
      )
      globalThis.fetch = mockFetch

      const provider = new OpenAIProvider({ apiKey: 'key', defaultModel: 'gpt-4o-mini' })
      await provider.run({
        systemPrompt: 'sys',
        userPrompt: 'user',
        model: '',
      })

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.model).toBe('gpt-4o-mini')
    })

    it('should include temperature when specified', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResponse({
          choices: [{ message: { content: 'response' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
      )
      globalThis.fetch = mockFetch

      const provider = new OpenAIProvider({ apiKey: 'key' })
      await provider.run({
        systemPrompt: 'sys',
        userPrompt: 'user',
        model: 'gpt-4o',
        temperature: 0.2,
      })

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.temperature).toBe(0.2)
    })

    it('should add warning when response is truncated', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResponse({
          choices: [{ message: { content: 'truncated...' }, finish_reason: 'length' }],
          usage: { prompt_tokens: 10, completion_tokens: 4096 },
        }),
      )
      globalThis.fetch = mockFetch

      const provider = new OpenAIProvider({ apiKey: 'key' })
      const result = await provider.run({
        systemPrompt: 'sys',
        userPrompt: 'user',
        model: 'gpt-4o',
      })

      expect(result.warnings).toContain('Response was truncated due to max_tokens limit')
    })

    it('should use custom baseUrl', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResponse({
          choices: [{ message: { content: 'response' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
      )
      globalThis.fetch = mockFetch

      const provider = new OpenAIProvider({
        apiKey: 'key',
        baseUrl: 'http://localhost:11434',
      })
      await provider.run({
        systemPrompt: 'sys',
        userPrompt: 'user',
        model: 'llama3',
      })

      const url = mockFetch.mock.calls[0][0]
      expect(url).toBe('http://localhost:11434/v1/chat/completions')
    })
  })

  describe('run - error handling', () => {
    it('should throw ProviderError with rate_limit code on 429', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValue(
          mockResponse(
            { error: { message: 'Rate limit exceeded', type: 'tokens' } },
            { status: 429, headers: { 'retry-after': '30' } },
          ),
        )
      globalThis.fetch = mockFetch

      const provider = new OpenAIProvider({ apiKey: 'key' })
      const error = await provider
        .run({
          systemPrompt: 'sys',
          userPrompt: 'user',
          model: 'gpt-4o',
        })
        .catch((e: unknown) => e)

      expect(error).toBeInstanceOf(ProviderError)
      const providerError = error as ProviderError
      expect(providerError.code).toBe('rate_limit')
      expect(providerError.statusCode).toBe(429)
      expect(providerError.retryable).toBe(true)
      expect(providerError.retryAfterMs).toBe(30000)
    })

    it('should throw ProviderError with auth_error code on 401', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValue(mockResponse({ error: { message: 'Invalid API key' } }, { status: 401 }))
      globalThis.fetch = mockFetch

      const provider = new OpenAIProvider({ apiKey: 'bad-key' })
      const error = await provider
        .run({
          systemPrompt: 'sys',
          userPrompt: 'user',
          model: 'gpt-4o',
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

      const provider = new OpenAIProvider({ apiKey: 'key' })
      const error = await provider
        .run({
          systemPrompt: 'sys',
          userPrompt: 'user',
          model: 'gpt-4o',
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

      const provider = new OpenAIProvider({ apiKey: 'key' })
      const error = await provider
        .run({
          systemPrompt: 'sys',
          userPrompt: 'user',
          model: 'gpt-4o',
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

      const provider = new OpenAIProvider({ apiKey: 'key' })
      const error = await provider
        .run({
          systemPrompt: 'sys',
          userPrompt: 'user',
          model: 'gpt-4o',
        })
        .catch((e: unknown) => e)

      expect(error).toBeInstanceOf(ProviderError)
      const providerError = error as ProviderError
      expect(providerError.code).toBe('network_error')
      expect(providerError.retryable).toBe(true)
    })

    it('should throw ProviderError with invalid_response when no choices', async () => {
      const mockFetch = vi.fn().mockResolvedValue(mockResponse({ choices: [] }))
      globalThis.fetch = mockFetch

      const provider = new OpenAIProvider({ apiKey: 'key' })
      const error = await provider
        .run({
          systemPrompt: 'sys',
          userPrompt: 'user',
          model: 'gpt-4o',
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
          choices: [{ message: { content: 'response' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1000, completion_tokens: 500 },
        }),
      )
      globalThis.fetch = mockFetch

      const provider = new OpenAIProvider({ apiKey: 'key' })
      const result = await provider.run({
        systemPrompt: 'sys',
        userPrompt: 'user',
        model: 'gpt-4o',
      })

      // gpt-4o: $2.5/1M input, $10/1M output
      // cost = (1000/1M * 2.5) + (500/1M * 10) = 0.0025 + 0.005 = 0.0075
      expect(result.usage?.cost).toBeCloseTo(0.0075, 6)
    })

    it('should return undefined cost for unknown models', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResponse({
          choices: [{ message: { content: 'response' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1000, completion_tokens: 500 },
        }),
      )
      globalThis.fetch = mockFetch

      const provider = new OpenAIProvider({ apiKey: 'key' })
      const result = await provider.run({
        systemPrompt: 'sys',
        userPrompt: 'user',
        model: 'custom-model',
      })

      expect(result.usage?.cost).toBeUndefined()
    })
  })

  describe('run - abort signal', () => {
    it('should respect external abort signal', async () => {
      const mockFetch = vi
        .fn()
        .mockRejectedValue(new DOMException('The operation was aborted', 'AbortError'))
      globalThis.fetch = mockFetch

      const externalController = new AbortController()
      externalController.abort()

      const provider = new OpenAIProvider({ apiKey: 'key' })
      const error = await provider
        .run({
          systemPrompt: 'sys',
          userPrompt: 'user',
          model: 'gpt-4o',
          abortSignal: externalController.signal,
        })
        .catch((e: unknown) => e)

      expect(error).toBeInstanceOf(ProviderError)
      expect((error as ProviderError).code).toBe('timeout')
    })
  })
})
