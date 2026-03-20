import type { AgentLens, AgentRole } from '../types/agent.js'

/** Spec Task 1.1 — only 'prompt' is implemented in Phase A */
export type SkillType = 'prompt' | 'tool' | 'plugin'

/** Spec Task 1.1 — only 'local' is implemented in Phase A */
export type SkillSource =
  | { type: 'local'; path: string }
  | { type: 'registry'; registryUrl: string; name: string }
  | { type: 'git'; repoUrl: string; ref: string; path: string }

export type SkillTrigger = {
  keywords?: string[]
  lenses?: AgentLens[]
  roles?: AgentRole[]
  lifecycle?: ('pre_round' | 'post_round' | 'pre_synthesis' | 'post_synthesis')[]
}

export type SkillDefinition = {
  id: string
  version: string
  name: string
  description: string
  skillType: SkillType
  source: SkillSource
  license?: string
  compatibility?: {
    agentOrchestra?: string
    platforms?: string[]
  }
  triggers?: SkillTrigger
  promptContent: string
  promptSummary: string
}

export type SkillSet = {
  id: string
  name: string
  description: string
  skillIds: string[]
  contextBudgetPercent: number // 0-100, default: 20
}

export type SkillLoadResult = {
  skills: SkillDefinition[]
  errors: { path: string; error: string }[]
}

export type SkillMatchResult = {
  matched: SkillDefinition[]
  reason: Map<string, string> // skillId → "lens:security" | "keyword:owasp" | etc.
}

export type SkillParseError = {
  type: 'parse_error'
  path: string
  message: string
  line?: number
}
