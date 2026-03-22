import type { ProviderOutput } from '@agent-orchestra/core'
import type { AgentProvider, ProviderInput } from './types.js'

/**
 * Minimal agent shape needed for provider routing.
 * Matches AgentAssignment from core without importing it.
 */
interface AgentRef {
  id: string
  providerKey: string
  modelOrCommand: string
}

/**
 * ProviderRouter dispatches provider calls to per-agent provider instances.
 *
 * The protocol runner calls `router.forAgent(agent).run(input)` instead of
 * calling a single provider directly. This enables different agents to use
 * different LLM backends (CLI tools, API providers, etc.)
 *
 * Backward-compatible: when constructed with only a default provider,
 * `forAgent()` always returns that default.
 */
export class ProviderRouter {
  private readonly providers = new Map<string, AgentProvider>()
  private readonly defaultProvider: AgentProvider

  constructor(defaultProvider: AgentProvider) {
    this.defaultProvider = defaultProvider
  }

  /**
   * Register a provider for a specific agent ID.
   */
  setProvider(agentId: string, provider: AgentProvider): void {
    this.providers.set(agentId, provider)
  }

  /**
   * Register a provider for agents matching a provider key.
   * This is a convenience for config-driven setups where the agent ID
   * isn't known yet but the provider key is.
   */
  setProviderByKey(providerKey: string, provider: AgentProvider): void {
    this.providers.set(`key:${providerKey}`, provider)
  }

  /**
   * Resolve the provider for a given agent.
   *
   * Lookup order:
   * 1. Exact agent ID match
   * 2. Provider key match (via setProviderByKey)
   * 3. Default provider
   */
  forAgent(agent: AgentRef): AgentProvider {
    // 1. Exact agent ID match
    const byId = this.providers.get(agent.id)
    if (byId) return byId

    // 2. Provider key match
    const byKey = this.providers.get(`key:${agent.providerKey}`)
    if (byKey) return byKey

    // 3. Default
    return this.defaultProvider
  }

  /**
   * Also implement the AgentProvider interface directly so the router
   * can be used as a drop-in replacement for a single provider.
   * Uses the default provider.
   */
  async run(input: ProviderInput): Promise<ProviderOutput> {
    return this.defaultProvider.run(input)
  }
}
