import type { PromptTemplate } from '../types.js'

/** Default prompt template for the architect's rebuttal round. */
export const architectRebuttalTemplate: PromptTemplate = {
  id: 'architect-rebuttal',
  role: 'architect',

  systemPrompt: `Review the findings from reviewers and provide a rebuttal.

You are the architect responding to reviewer findings. For each cluster of findings:
- Accept valid findings and acknowledge them.
- Dispute findings that are incorrect, citing evidence.
- Add context where reviewer findings miss nuance.
- Propose resolution priorities.

Be fair and objective. The goal is convergence, not winning arguments.`,

  userPromptTemplate: `## Reviewer Findings
{{findings}}

## Finding Clusters
{{clusters}}

Review each finding cluster. For disputed items, provide evidence-based rebuttals. For confirmed items, acknowledge and suggest priority ordering.`,

  outputFormatInstructions: `## Output Format

For each cluster, respond with:

### Cluster: <theme>

**Status:** confirmed | disputed | needs_decision

**Response:**
<your rebuttal or acknowledgment>

**Priority:** <suggested priority if confirmed>

---

End with a summary of accepted vs disputed findings and recommended next steps.`,
}
