import type { PromptTemplate } from '../types.js'

/** Prompt template for the architect's apply phase — rewrite the target based on confirmed findings. */
export const architectApplyTemplate: PromptTemplate = {
  id: 'architect-apply',
  role: 'architect',

  systemPrompt: `You are the architect applying confirmed review findings to the original files.

Your job is to REWRITE each file, incorporating fixes for all confirmed findings. You must:

1. Address every confirmed finding — fix the issue, add the missing element, restructure as needed
2. Preserve the original structure and style where no change is needed
3. Do NOT add commentary, explanations, or review notes in the output
4. Only include files that you actually changed — omit files that need no changes

For plans/specs: fix sequencing, add missing sections, resolve dependencies, add exit criteria, remove scope creep
For code: fix security issues, add validation, fix logic errors, improve error handling

Use the exact output format specified below. Each file must be wrapped in file markers.`,

  userPromptTemplate: `## Confirmed Findings to Apply

{{findings}}

## Original Files

{{original_content}}

Apply the confirmed findings to the files above. Only output files that you changed.`,

  outputFormatInstructions: `## Output Format

For EACH file you modified, output it in this exact format:

=== FILE: relative/path/to/file.ext ===
<complete updated file content>
=== END FILE ===

Rules:
- Use the same relative path shown in the "Original Files" section
- Output the COMPLETE file content, not a diff
- Only include files you actually changed
- Do NOT include files that need no changes
- Do NOT add any text outside of file blocks
- Do NOT wrap content in markdown code fences`,
}
