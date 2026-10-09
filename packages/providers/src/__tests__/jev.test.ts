import { afterEach, describe, expect, it, vi } from 'vitest'
import { createJevReviewAssessor, JevClient } from '../jev.js'

const state = {
  previousFindings: [],
  currentFindings: [],
  architectResponse: 'Fixed',
  reviewerResponse: 'Verified',
}
const response = {
  model: 'jev-1.13.0',
  answers: {
    next_round: {
      type: 'choice',
      choice: 'stop',
      confidence: 0.95,
      probabilities: { continue: 0.02, stop: 0.97, needs_attention: 0.01 },
    },
    unresolved_risk: { type: 'noul', noul: 0.03 },
  },
  usage: { input_tokens: 500 },
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('JevClient', () => {
  it('does not enable or call JEV without a nonempty key', () => {
    vi.stubEnv('TYPESAFE_API_KEY', ' ')
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    expect(createJevReviewAssessor()).toBeUndefined()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('calls the official API with a pinned model and validates typed answers', async () => {
    vi.stubEnv('TYPESAFE_API_KEY', 'test-key')
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(response)))
    vi.stubGlobal('fetch', fetch)
    const assessment = await createJevReviewAssessor()!.assess(state)
    expect(assessment).toMatchObject({ choice: 'stop', unresolvedRisk: 0.03, inputTokens: 500 })
    const [url, options] = fetch.mock.calls[0]
    expect(url).toBe('https://api.typesafe.ai/v1/systemone')
    expect(options.headers.Authorization).toBe('Bearer test-key')
    expect(JSON.parse(options.body)).toMatchObject({ model: 'jev-1.13.0', state })
    expect(options.signal).toBeInstanceOf(AbortSignal)
  })

  it.each([401, 429, 529])(
    'rejects HTTP %s for caller fallback without exposing the response',
    async (status) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response('private upstream message', { status })),
      )
      await expect(new JevClient('test').assess(state)).rejects.toThrow(`JEV HTTP ${status}`)
    },
  )

  it.each([
    { ...response, answers: {} },
    { ...response, model: 'other-model' },
    { ...response, answers: { ...response.answers, unresolved_risk: { type: 'noul', noul: 2 } } },
    {
      ...response,
      answers: {
        ...response.answers,
        next_round: {
          ...response.answers.next_round,
          probabilities: { continue: 0.8, stop: 0.1, needs_attention: 0.1 },
        },
      },
    },
  ])('rejects malformed or inconsistent answers', async (body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body))))
    await expect(new JevClient('test').assess(state)).rejects.toThrow('Invalid JEV review response')
  })

  it('rejects oversized evidence instead of truncating it into a misleading decision', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(
      new JevClient('test').assess({ ...state, architectResponse: 'x'.repeat(25_000) }),
    ).rejects.toThrow('limit')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('propagates network/timeout failure for the normal-flow fallback', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('Timed out', 'TimeoutError')))
    await expect(new JevClient('test').assess(state)).rejects.toThrow('Timed out')
  })
})
