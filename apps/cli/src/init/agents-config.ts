import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'

/**
 * Per-agent provider configuration from .agent-orchestra/agents.yaml
 */
export type AgentProviderConfig = {
  provider: string
  model?: string
}

export type ReviewerConfig = AgentProviderConfig & {
  lens?: string
}

export type AgentsConfig = {
  architect?: AgentProviderConfig
  reviewers?: ReviewerConfig[]
}

/**
 * Load per-agent provider configuration from .agent-orchestra/agents.yaml.
 * Returns null if the file doesn't exist (not an error).
 */
export async function loadAgentsConfig(workspacePath: string): Promise<AgentsConfig | null> {
  const configPath = join(workspacePath, '.agent-orchestra', 'agents.yaml')

  let rawContent: string
  try {
    rawContent = await readFile(configPath, 'utf-8')
  } catch {
    return null // File doesn't exist — not an error
  }

  let parsed: Record<string, unknown>
  try {
    parsed = parseYaml(rawContent) as Record<string, unknown>
  } catch {
    return null
  }

  if (!parsed || typeof parsed !== 'object') {
    return null
  }

  const config: AgentsConfig = {}

  // Parse architect
  if (parsed.architect && typeof parsed.architect === 'object') {
    const arch = parsed.architect as Record<string, unknown>
    if (typeof arch.provider === 'string') {
      config.architect = {
        provider: arch.provider,
        model: typeof arch.model === 'string' ? arch.model : undefined,
      }
    }
  }

  // Parse reviewers
  if (parsed.reviewer && typeof parsed.reviewer === 'object' && !Array.isArray(parsed.reviewer)) {
    // Single reviewer shorthand
    const rev = parsed.reviewer as Record<string, unknown>
    if (typeof rev.provider === 'string') {
      config.reviewers = [
        {
          provider: rev.provider,
          model: typeof rev.model === 'string' ? rev.model : undefined,
          lens: typeof rev.lens === 'string' ? rev.lens : undefined,
        },
      ]
    }
  }

  if (Array.isArray(parsed.reviewers)) {
    config.reviewers = []
    for (const rev of parsed.reviewers as Array<Record<string, unknown>>) {
      if (typeof rev?.provider === 'string') {
        config.reviewers.push({
          provider: rev.provider,
          model: typeof rev.model === 'string' ? rev.model : undefined,
          lens: typeof rev.lens === 'string' ? rev.lens : undefined,
        })
      }
    }
  }

  return config
}
