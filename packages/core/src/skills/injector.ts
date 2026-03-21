import type { TokenEstimator } from '../interfaces/token-estimator.js'
import type { SkillDefinition, SkillMatchResult } from './types.js'

/**
 * SkillInjector encapsulates the logic for injecting matched skill content into
 * a context string, respecting token budget limits and applying progressive disclosure.
 *
 * Spec Task 1.5 — ContextBuilder Integration
 */
export class SkillInjector {
  constructor(private tokenEstimator: TokenEstimator) {}

  /**
   * Inject matched skill content into a context string, respecting the token budget.
   * Uses progressive disclosure: full content if budget allows, summary if not.
   * Returns the skill context string and metadata about what was injected.
   */
  inject(
    matched: SkillMatchResult,
    skillBudgetTokens: number,
  ): { skillContext: string; injectedIds: string[]; usedTokens: number } {
    if (matched.matched.length === 0) {
      return { skillContext: '', injectedIds: [], usedTokens: 0 }
    }

    const parts: string[] = []
    const injectedIds: string[] = []
    let remainingBudget = skillBudgetTokens
    let usedTokens = 0

    for (const skill of matched.matched) {
      const content = this.selectContent(skill, remainingBudget)
      if (content === null) {
        continue
      }

      const contentTokens = this.tokenEstimator.estimate(content)
      parts.push(content)
      injectedIds.push(skill.id)
      usedTokens += contentTokens
      remainingBudget -= contentTokens
    }

    return {
      skillContext: parts.join('\n\n---\n\n'),
      injectedIds,
      usedTokens,
    }
  }

  /**
   * Select content for a single skill based on remaining budget.
   * Returns full content, summary, or null (if even summary doesn't fit).
   *
   * Progressive disclosure:
   * - Full content if it fits in the remaining budget
   * - Summary with a note if only that fits
   * - null if even the summary doesn't fit
   */
  private selectContent(skill: SkillDefinition, remainingBudget: number): string | null {
    const fullContent = `## Skill: ${skill.name}\n\n${skill.promptContent}`
    const fullTokens = this.tokenEstimator.estimate(fullContent)

    if (fullTokens <= remainingBudget) {
      return fullContent
    }

    const summaryContent = `## Skill: ${skill.name} (summary)\n\n${skill.promptSummary}\n\n_[Full skill content available — ${fullTokens} tokens — request if needed]_`
    const summaryTokens = this.tokenEstimator.estimate(summaryContent)

    if (summaryTokens <= remainingBudget) {
      return summaryContent
    }

    return null
  }
}
