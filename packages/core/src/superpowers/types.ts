import type { AgentLens, AgentAssignment } from '../types/agent.js'

/** Categories of superpowers that define their primary purpose */
export type SuperpowerCategory = 'review' | 'analysis' | 'fix' | 'testing'

/** Maturity levels indicating risk and required approval */
export type SuperpowerMaturity = 'safe' | 'controlled' | 'advanced'

/** Agent preset for the architect role within a superpower */
export type SuperpowerArchitectPreset = {
  enabled: boolean
  provider?: string
  model?: string
}

/** Agent preset for the reviewer role within a superpower */
export type SuperpowerReviewerPreset = {
  role: 'reviewer'
  lens?: AgentLens
  count?: number
  provider?: string
  model?: string
}

/** Combined agent presets for a superpower */
export type SuperpowerAgentPreset = {
  architect?: SuperpowerArchitectPreset
  reviewer: SuperpowerReviewerPreset
}

/**
 * A Superpower is a high-level, opinionated workflow preset that bundles
 * skill sets, agent configuration, and runtime defaults into a single
 * activatable unit.
 */
export type Superpower = {
  id: string
  name: string
  description: string
  category: SuperpowerCategory
  skillSetIds?: string[]
  skillIds?: string[]
  protocol?: 'single_challenger'
  runtimeDefaults?: {
    skillBudgetPercent?: number
    autoApprove?: string[]
    denyAll?: boolean
  }
  agentPreset: SuperpowerAgentPreset
  capabilityExpectation?: Array<'fs.read' | 'fs.write' | 'net.http' | 'proc.spawn' | 'secrets.read'>
  maturity: SuperpowerMaturity
  requiresApproval?: boolean
}

/**
 * The fully resolved form of a Superpower, with validated skill references,
 * built agent assignments, and any warnings generated during resolution.
 */
export type ResolvedSuperpower = {
  superpower: Superpower
  resolvedSkillSetIds: string[]
  resolvedSkillIds: string[]
  protocol: 'single_challenger'
  runtimeConfigPatch: {
    skillBudgetPercent?: number
  }
  agentAssignments: AgentAssignment[]
  warnings: string[]
}
