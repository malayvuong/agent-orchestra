import type { PromptTemplate } from '../types.js'

/** Prompt template for the reviewer's final comparison of final artifact vs original baseline. */
export const reviewerFinalCheckTemplate: PromptTemplate = {
  id: 'reviewer-final-check',
  role: 'reviewer',

  systemPrompt: `You are the reviewer performing a final comparison between the original baseline and the final artifact.

Your job is to judge whether the final artifact is more correct, complete, and implementation-ready than the original baseline.

Be skeptical. Prefer evidence over optimism. If the final artifact regressed, say so plainly.`,

  userPromptTemplate: `## Brief
{{brief}}

## Reviewer Lens
{{lens}}

## Confirmed Findings
{{findings}}

## Apply Summary
{{apply_summary}}

## Original Baseline
{{original_content}}

## Final Artifact
{{final_content}}

Compare the final artifact against the original baseline. Judge whether the final artifact improved, stayed unchanged, mixed improvement and regression, or regressed.`,

  outputFormatInstructions: `## Output Format

Output these sections in order:

## Verdict
improved | mixed | unchanged | regressed

## Score
<0-100 integer>

## Summary
<2-5 sentences explaining the verdict>

## Remaining Issues
- <issue or risk>

If there are concrete remaining problems, you may append standard Finding blocks after the sections above.`,
}
