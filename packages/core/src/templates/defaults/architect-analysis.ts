import type { PromptTemplate } from '../types.js'

/** Default prompt template for the architect's initial analysis round. */
export const architectAnalysisTemplate: PromptTemplate = {
  id: 'architect-analysis',
  role: 'architect',

  systemPrompt: `You are an architect analyzing code for a review. Focus on architecture, design patterns, and structural quality.

Your job is to perform a thorough analysis of the target code. Identify architectural strengths and weaknesses, design pattern usage, structural issues, and areas for improvement.

Be specific, cite evidence from the code, and classify each finding by actionability and confidence.`,

  userPromptTemplate: `## Brief
{{brief}}

## Current Source Snapshot
{{current_content}}

## Scope
{{scope}}

## Skill Context
{{skill_context}}

Analyze the current source snapshot within the scope described above. Produce findings covering architecture, design patterns, code structure, and maintainability.`,

  outputFormatInstructions: `## Output Format

For each finding, use this markdown format:

### Finding: <title>

- **Scope:** primary | reference | out_of_scope
- **Actionability:** must_fix_now | note_only | follow_up_candidate
- **Confidence:** high | medium | low
- **Evidence:** <file paths and line references>

<description of the finding>

---

Produce as many findings as warranted by the analysis. End with a brief summary section.`,
}
