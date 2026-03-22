import { describe, it, expect } from 'vitest'
import { ProviderRouter } from '../router.js'
import type { AgentProvider, ProviderInput } from '../types.js'
import type { ProviderOutput } from '@malayvuong/agent-orchestra-core'

// ---------------------------------------------------------------------------
// Mock providers
// ---------------------------------------------------------------------------

function mockProvider(name: string): AgentProvider {
  return {
    async run(_input: ProviderInput): Promise<ProviderOutput> {
      return { rawText: `response-from-${name}` }
    },
  }
}

function makeAgent(id: string, providerKey: string) {
  return { id, providerKey, modelOrCommand: 'test-model' }
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('ProviderRouter — construction', () => {
  it('can be constructed with a default provider', () => {
    const router = new ProviderRouter(mockProvider('default'))
    expect(router).toBeDefined()
  })

  it('implements run() directly as fallback', async () => {
    const router = new ProviderRouter(mockProvider('default'))
    const result = await router.run({
      systemPrompt: 'test',
      userPrompt: 'test',
      model: 'test',
    })
    expect(result.rawText).toBe('response-from-default')
  })
})

// ---------------------------------------------------------------------------
// forAgent routing
// ---------------------------------------------------------------------------

describe('ProviderRouter — forAgent', () => {
  it('returns default provider when no per-agent config', async () => {
    const router = new ProviderRouter(mockProvider('default'))
    const agent = makeAgent('agent-1', 'openai')

    const provider = router.forAgent(agent)
    const result = await provider.run({
      systemPrompt: 'test',
      userPrompt: 'test',
      model: 'test',
    })
    expect(result.rawText).toBe('response-from-default')
  })

  it('returns per-agent provider when registered by ID', async () => {
    const router = new ProviderRouter(mockProvider('default'))
    router.setProvider('architect-1', mockProvider('claude-cli'))

    const agent = makeAgent('architect-1', 'openai')
    const provider = router.forAgent(agent)
    const result = await provider.run({
      systemPrompt: 'test',
      userPrompt: 'test',
      model: 'test',
    })
    expect(result.rawText).toBe('response-from-claude-cli')
  })

  it('returns per-key provider when registered by provider key', async () => {
    const router = new ProviderRouter(mockProvider('default'))
    router.setProviderByKey('claude-cli', mockProvider('claude-cli'))

    const agent = makeAgent('any-agent', 'claude-cli')
    const provider = router.forAgent(agent)
    const result = await provider.run({
      systemPrompt: 'test',
      userPrompt: 'test',
      model: 'test',
    })
    expect(result.rawText).toBe('response-from-claude-cli')
  })

  it('agent ID takes priority over provider key', async () => {
    const router = new ProviderRouter(mockProvider('default'))
    router.setProvider('agent-1', mockProvider('by-id'))
    router.setProviderByKey('openai', mockProvider('by-key'))

    const agent = makeAgent('agent-1', 'openai')
    const provider = router.forAgent(agent)
    const result = await provider.run({
      systemPrompt: 'test',
      userPrompt: 'test',
      model: 'test',
    })
    expect(result.rawText).toBe('response-from-by-id')
  })

  it('supports different providers for architect and reviewer', async () => {
    const router = new ProviderRouter(mockProvider('default'))
    router.setProvider('architect-1', mockProvider('codex-cli'))
    router.setProvider('reviewer-1', mockProvider('claude-cli'))

    const architect = makeAgent('architect-1', 'openai')
    const reviewer = makeAgent('reviewer-1', 'openai')

    const archResult = await router.forAgent(architect).run({
      systemPrompt: 'test',
      userPrompt: 'test',
      model: 'test',
    })
    const revResult = await router.forAgent(reviewer).run({
      systemPrompt: 'test',
      userPrompt: 'test',
      model: 'test',
    })

    expect(archResult.rawText).toBe('response-from-codex-cli')
    expect(revResult.rawText).toBe('response-from-claude-cli')
  })

  it('unregistered agents fall through to default', async () => {
    const router = new ProviderRouter(mockProvider('default'))
    router.setProvider('architect-1', mockProvider('codex-cli'))

    const unknown = makeAgent('builder-1', 'unknown')
    const provider = router.forAgent(unknown)
    const result = await provider.run({
      systemPrompt: 'test',
      userPrompt: 'test',
      model: 'test',
    })
    expect(result.rawText).toBe('response-from-default')
  })
})

// ---------------------------------------------------------------------------
// Multiple reviewers scenario
// ---------------------------------------------------------------------------

describe('ProviderRouter — multiple reviewers', () => {
  it('supports different providers for multiple reviewer agents', async () => {
    const router = new ProviderRouter(mockProvider('default'))
    router.setProvider('reviewer-security', mockProvider('claude-cli'))
    router.setProvider('reviewer-scope', mockProvider('grok'))
    router.setProvider('reviewer-risk', mockProvider('deepseek'))

    const results = await Promise.all([
      router.forAgent(makeAgent('reviewer-security', 'x')).run({
        systemPrompt: 'test',
        userPrompt: 'test',
        model: 'test',
      }),
      router.forAgent(makeAgent('reviewer-scope', 'x')).run({
        systemPrompt: 'test',
        userPrompt: 'test',
        model: 'test',
      }),
      router.forAgent(makeAgent('reviewer-risk', 'x')).run({
        systemPrompt: 'test',
        userPrompt: 'test',
        model: 'test',
      }),
    ])

    expect(results[0].rawText).toBe('response-from-claude-cli')
    expect(results[1].rawText).toBe('response-from-grok')
    expect(results[2].rawText).toBe('response-from-deepseek')
  })
})
