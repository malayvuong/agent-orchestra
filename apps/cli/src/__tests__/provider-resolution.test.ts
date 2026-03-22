import { describe, expect, it, vi } from 'vitest'
import type { AgentAssignment } from '@malayvuong/agent-orchestra-core'
import type { AgentsConfig } from '../init/agents-config.js'
import { resolveProviderPlans } from '../providers/resolve-provider.js'

function makeAgents(): AgentAssignment[] {
  return [
    {
      id: 'architect-1',
      agentConfigId: 'cfg-arch',
      role: 'architect',
      connectionType: 'api',
      providerKey: 'auto',
      modelOrCommand: '',
      protocol: 'single_challenger',
      enabled: true,
      allowReferenceScan: false,
      canWriteCode: false,
    },
    {
      id: 'reviewer-1',
      agentConfigId: 'cfg-reviewer',
      role: 'reviewer',
      lens: 'logic',
      connectionType: 'api',
      providerKey: 'auto',
      modelOrCommand: '',
      protocol: 'single_challenger',
      enabled: true,
      allowReferenceScan: false,
      canWriteCode: false,
    },
  ]
}

describe('resolveProviderPlans', () => {
  it('does not require a shared fallback provider when both agents have concrete provider plans', async () => {
    const agentsConfig: AgentsConfig = {
      architect: { provider: 'codex-cli', model: 'o4-mini' },
      reviewers: [{ provider: 'anthropic', model: 'claude-3-7-sonnet' }],
    }

    const result = await resolveProviderPlans({
      agents: makeAgents(),
      defaultProvider: 'auto',
      defaultModel: '',
      agentsConfig,
      detectCliProviders: vi.fn().mockResolvedValue({
        claudeCli: false,
        codexCli: false,
        preferred: null,
      }),
    })

    expect(result.defaultPlan).toBeNull()
    expect(
      result.agents.map((agent) => ({
        id: agent.id,
        providerKey: agent.providerKey,
        modelOrCommand: agent.modelOrCommand,
      })),
    ).toEqual([
      { id: 'architect-1', providerKey: 'codex-cli', modelOrCommand: 'o4-mini' },
      { id: 'reviewer-1', providerKey: 'anthropic', modelOrCommand: 'claude-3-7-sonnet' },
    ])
  })

  it('uses CLI-first autodetection for unresolved auto providers', async () => {
    const result = await resolveProviderPlans({
      agents: makeAgents(),
      defaultProvider: 'auto',
      defaultModel: '',
      detectCliProviders: vi.fn().mockResolvedValue({
        claudeCli: false,
        codexCli: true,
        preferred: 'codex-cli',
      }),
    })

    expect(result.defaultPlan).toEqual({
      providerKey: 'codex-cli',
      modelOrCommand: '',
    })
    expect(result.agents.every((agent) => agent.providerKey === 'codex-cli')).toBe(true)
  })

  it('applies explicit per-role overrides before agents.yaml and shared defaults', async () => {
    const agentsConfig: AgentsConfig = {
      architect: { provider: 'codex-cli', model: 'o4-mini' },
      reviewers: [{ provider: 'anthropic', model: 'claude-3-7-sonnet' }],
    }

    const result = await resolveProviderPlans({
      agents: makeAgents(),
      defaultProvider: 'openai',
      defaultModel: 'gpt-4o',
      agentsConfig,
      architectOverride: { provider: 'deepseek', model: 'deepseek-chat' },
      reviewerOverride: { provider: 'grok', model: 'grok-3' },
      detectCliProviders: vi.fn(),
    })

    expect(result.defaultPlan).toBeNull()
    expect(
      result.agents.map((agent) => ({
        role: agent.role,
        providerKey: agent.providerKey,
        modelOrCommand: agent.modelOrCommand,
      })),
    ).toEqual([
      { role: 'architect', providerKey: 'deepseek', modelOrCommand: 'deepseek-chat' },
      { role: 'reviewer', providerKey: 'grok', modelOrCommand: 'grok-3' },
    ])
  })
})
