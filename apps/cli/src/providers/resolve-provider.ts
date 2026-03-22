import type { AgentAssignment, ProviderOutput } from '@agent-orchestra/core'
import { detectCliProviders } from '@agent-orchestra/providers'
import type { AgentsConfig } from '../init/agents-config.js'

type ProviderDescriptor = {
  providerKey: string
  modelOrCommand: string
}

type RoleOverride = {
  provider?: string
  model?: string
}

type ResolveProviderPlansOptions = {
  agents: AgentAssignment[]
  defaultProvider: string
  defaultModel: string
  agentsConfig?: AgentsConfig | null
  architectOverride?: RoleOverride
  reviewerOverride?: RoleOverride
  detectCliProviders?: typeof detectCliProviders
}

type ResolvedAgentPlan = AgentAssignment & ProviderDescriptor

export type ResolvedProviderPlans = {
  agents: ResolvedAgentPlan[]
  defaultPlan: ProviderDescriptor | null
}

export interface ProviderAdapter {
  run(input: {
    systemPrompt: string
    userPrompt: string
    model: string
    maxTokens?: number
    temperature?: number
    timeoutMs?: number
    abortSignal?: AbortSignal
  }): Promise<ProviderOutput>
}

export async function buildProviderExecutor(options: ResolveProviderPlansOptions): Promise<{
  agents: ResolvedAgentPlan[]
  providerExecutor: ProviderAdapter
  defaultPlan: ProviderDescriptor | null
}> {
  const resolved = await resolveProviderPlans(options)
  if (resolved.agents.length === 0) {
    throw new Error('At least one enabled agent is required to resolve providers')
  }

  const providers = await import('@agent-orchestra/providers')
  const cache = new Map<string, ProviderAdapter>()

  const getProvider = async (descriptor: ProviderDescriptor): Promise<ProviderAdapter> => {
    const cacheKey = `${descriptor.providerKey}::${descriptor.modelOrCommand}`
    const cached = cache.get(cacheKey)
    if (cached) return cached

    const provider = await createProvider(descriptor.providerKey, descriptor.modelOrCommand)
    cache.set(cacheKey, provider)
    return provider
  }

  const defaultDescriptor = resolved.defaultPlan ?? {
    providerKey: resolved.agents[0].providerKey,
    modelOrCommand: resolved.agents[0].modelOrCommand,
  }

  const router = new providers.ProviderRouter(await getProvider(defaultDescriptor))

  for (const agent of resolved.agents) {
    router.setProvider(
      agent.id,
      await getProvider({
        providerKey: agent.providerKey,
        modelOrCommand: agent.modelOrCommand,
      }),
    )
  }

  return {
    agents: resolved.agents,
    providerExecutor: router as ProviderAdapter,
    defaultPlan: resolved.defaultPlan,
  }
}

export async function resolveProviderPlans(
  options: ResolveProviderPlansOptions,
): Promise<ResolvedProviderPlans> {
  const detectCli = options.detectCliProviders ?? detectCliProviders
  let detectedPromise: ReturnType<typeof detectCli> | null = null

  const getDetected = () => {
    if (!detectedPromise) {
      detectedPromise = detectCli()
    }
    return detectedPromise
  }

  const defaultPlan = await normalizeDescriptor(
    options.defaultProvider,
    options.defaultModel,
    getDetected,
  )

  let needsDefaultPlan = false

  const agents = await Promise.all(
    options.agents.map(async (agent) => {
      const roleOverride =
        agent.role === 'architect'
          ? options.architectOverride
          : agent.role === 'reviewer'
            ? options.reviewerOverride
            : undefined

      const configProvider = resolveConfigProvider(agent, options.agentsConfig)
      const configModel = resolveConfigModel(agent, options.agentsConfig)
      const agentProvider = agent.providerKey || undefined
      const agentModel = agent.modelOrCommand || undefined

      const providerSource =
        roleOverride?.provider ?? configProvider ?? concreteProviderOrUndefined(agentProvider)
      const modelSource = roleOverride?.model ?? configModel ?? nonEmptyOrUndefined(agentModel)

      if (!providerSource) {
        needsDefaultPlan = true
      }

      const resolved = providerSource
        ? await normalizeDescriptor(
            providerSource,
            modelSource ?? defaultPlan.modelOrCommand,
            getDetected,
          )
        : defaultPlan

      return {
        ...agent,
        providerKey: resolved.providerKey,
        modelOrCommand: roleOverride?.model ?? modelSource ?? resolved.modelOrCommand,
      }
    }),
  )

  return {
    agents,
    defaultPlan: needsDefaultPlan ? defaultPlan : null,
  }
}

function resolveConfigProvider(
  agent: AgentAssignment,
  agentsConfig: AgentsConfig | null | undefined,
): string | undefined {
  if (agent.role === 'architect') {
    return agentsConfig?.architect?.provider
  }

  if (agent.role === 'reviewer') {
    return agentsConfig?.reviewers?.[0]?.provider
  }

  return undefined
}

function resolveConfigModel(
  agent: AgentAssignment,
  agentsConfig: AgentsConfig | null | undefined,
): string | undefined {
  if (agent.role === 'architect') {
    return agentsConfig?.architect?.model
  }

  if (agent.role === 'reviewer') {
    return agentsConfig?.reviewers?.[0]?.model
  }

  return undefined
}

async function normalizeDescriptor(
  provider: string,
  model: string | undefined,
  getDetected: () => ReturnType<typeof detectCliProviders>,
): Promise<ProviderDescriptor> {
  if (provider !== 'auto') {
    return {
      providerKey: provider,
      modelOrCommand: model ?? '',
    }
  }

  const detected = await getDetected()
  return {
    providerKey: detected.preferred ?? 'openai',
    modelOrCommand: model ?? '',
  }
}

function concreteProviderOrUndefined(provider: string | undefined): string | undefined {
  if (!provider || provider === 'auto') return undefined
  return provider
}

function nonEmptyOrUndefined(value: string | undefined): string | undefined {
  if (!value) return undefined
  return value
}

async function createProvider(providerName: string, model: string): Promise<ProviderAdapter> {
  const providers = await import('@agent-orchestra/providers')

  if (providerName === 'auto') {
    const detected = await providers.detectCliProviders()
    if (detected.preferred) {
      return createProvider(detected.preferred, model)
    }
    return createProvider('openai', model)
  }

  if (providerName === 'claude-cli') {
    return new providers.ClaudeCliProvider({ defaultModel: model })
  }

  if (providerName === 'codex-cli') {
    return new providers.CodexCliProvider({ defaultModel: model })
  }

  if (providerName === 'openai') {
    return new providers.OpenAIProvider({ defaultModel: model })
  }

  if (providerName === 'anthropic') {
    return new providers.AnthropicProvider({ defaultModel: model })
  }

  if (providerName === 'grok') {
    return new providers.OpenAIProvider({
      apiKey: process.env.XAI_API_KEY ?? process.env.GROK_API_KEY,
      baseUrl: 'https://api.x.ai',
      defaultModel: model || 'grok-3',
    })
  }

  if (providerName === 'deepseek') {
    return new providers.OpenAIProvider({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseUrl: 'https://api.deepseek.com',
      defaultModel: model || 'deepseek-chat',
    })
  }

  throw new Error(
    `Unknown provider: ${providerName}. Supported: auto, claude-cli, codex-cli, openai, anthropic, grok, deepseek`,
  )
}
