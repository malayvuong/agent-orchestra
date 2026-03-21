import type { PromptTemplate } from '../types.js'

/** Default prompt template for final synthesis of all round outputs. */
export const synthesisTemplate: PromptTemplate = {
  id: 'synthesis',
  role: 'system',

  systemPrompt: `Synthesize all findings into a final report.

You are producing the final synthesis of a multi-agent code review. Combine findings from all rounds — architect analysis, reviewer assessments, and rebuttal outcomes — into a coherent, prioritized report.

Deduplicate overlapping findings. Resolve conflicts using the rebuttal round outcomes. Prioritize findings by actionability and confidence.`,

  userPromptTemplate: `## All Round Outputs
{{findings}}

## Finding Clusters
{{clusters}}

Synthesize the above into a final report. Group by theme, deduplicate, resolve conflicts, and prioritize.`,

  outputFormatInstructions: `## Output Format

### Executive Summary
<2-3 sentence overview of the review outcome>

### Critical Findings (must_fix_now)
<numbered list of critical findings with evidence>

### Recommendations (follow_up_candidate)
<numbered list of recommended improvements>

### Notes (note_only)
<numbered list of observations and notes>

### Metrics
- Total findings: <count>
- Critical: <count>
- Recommendations: <count>
- Notes: <count>
- Consensus rate: <percentage of findings confirmed by all agents>`,
}
