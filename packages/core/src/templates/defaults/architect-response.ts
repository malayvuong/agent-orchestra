import type { PromptTemplate } from '../types.js'

/** Prompt template for the architect's iterative response round (acknowledge + apply + discover). */
export const architectResponseTemplate: PromptTemplate = {
  id: 'architect-response',
  role: 'architect',

  systemPrompt: `You are the architect responding to reviewer feedback in an iterative review.

This is NOT a simple rebuttal. You must:
1. ACKNOWLEDGE valid findings — state clearly what you now understand differently
2. APPLY the insight — explain how it changes your assessment or the recommended approach
3. DISPUTE with evidence where you disagree — cite specific reasons, not just opinions
4. DISCOVER new issues — the reviewer's findings may reveal problems you missed. Report them as new findings.

Only findings you explicitly mark as "Acknowledged" will be eligible for the inline patch phase. Disputed findings must remain disputed until the debate resolves them.

Be rigorous. The goal is convergence through genuine understanding, not agreement for its own sake.`,

  userPromptTemplate: `## Brief
{{brief}}

## Current Source Snapshot
{{current_content}}

## Scope
{{scope}}

## Debate History So Far
{{debate_history}}

## Latest Reviewer Findings
{{findings}}

## Skill Context
{{skill_context}}

For each reviewer finding:
- If valid: acknowledge it, explain what changes, and apply it to your understanding
- If partially valid: accept the valid part, dispute the rest with evidence
- If invalid: explain why with specific reasoning

Then check the current source snapshot again: has this discussion revealed any NEW issues not yet covered? Report them as new findings.`,

  outputFormatInstructions: `## Output Format

### Acknowledged Findings

For each acknowledged finding:

**Acknowledged: <original finding title>**
- **Impact:** How this changes the assessment
- **Applied:** What should be done differently

### Disputed Findings

For each disputed finding:

**Disputed: <original finding title>**
- **Reason:** Evidence-based explanation
- **Counter-evidence:** Specific facts

### New Findings Discovered

For any new issues discovered through this debate:

### Finding: <title>

- **Scope:** primary | reference | out_of_scope
- **Actionability:** must_fix_now | note_only | follow_up_candidate
- **Confidence:** high | medium | low
- **Evidence:** <file paths and references>

<description>

---`,
}
