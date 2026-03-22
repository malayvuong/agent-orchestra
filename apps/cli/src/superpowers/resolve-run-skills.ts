import { SkillLoader, SkillParser, SkillSetLoader } from '@agent-orchestra/core'
import type { SkillDefinition, SkillSet } from '@agent-orchestra/core'
import { simpleTokenEstimator } from '../utils/token-estimator.js'

type ResolveRunSkillsOptions = {
  workspacePath: string
  resolvedSkillIds: string[]
  resolvedSkillSetIds: string[]
}

export async function resolveRunSkills(
  options: ResolveRunSkillsOptions,
): Promise<SkillDefinition[]> {
  const { skills, skillSets } = await loadWorkspaceSkillCatalog(options.workspacePath)
  return materializeRunSkills({
    loadedSkills: skills,
    loadedSkillSets: skillSets,
    resolvedSkillIds: options.resolvedSkillIds,
    resolvedSkillSetIds: options.resolvedSkillSetIds,
  })
}

export async function loadWorkspaceSkillCatalog(workspacePath: string): Promise<{
  skills: SkillDefinition[]
  skillSets: SkillSet[]
}> {
  const parser = new SkillParser(simpleTokenEstimator)
  const skillLoader = new SkillLoader(parser)
  const skillSetLoader = new SkillSetLoader()

  const [{ skills }, skillSets] = await Promise.all([
    skillLoader.loadFromWorkspace(workspacePath),
    skillSetLoader.load(workspacePath),
  ])

  return { skills, skillSets }
}

export function materializeRunSkills(options: {
  loadedSkills: SkillDefinition[]
  loadedSkillSets: SkillSet[]
  resolvedSkillIds: string[]
  resolvedSkillSetIds: string[]
}): SkillDefinition[] {
  const skillSetLoader = new SkillSetLoader()
  const byId = new Map(options.loadedSkills.map((skill) => [skill.id, skill]))
  const resolved = new Map<string, SkillDefinition>()

  for (const skillId of options.resolvedSkillIds) {
    const skill = byId.get(skillId)
    if (skill) {
      resolved.set(skill.id, skill)
    }
  }

  for (const skillSetId of options.resolvedSkillSetIds) {
    const skillSet = skillSetLoader.resolve(
      skillSetId,
      options.loadedSkillSets,
      options.loadedSkills,
    )
    if (!skillSet) continue

    for (const skillId of skillSet.skillIds) {
      const skill = byId.get(skillId)
      if (skill) {
        resolved.set(skill.id, skill)
      }
    }
  }

  return [...resolved.values()]
}
