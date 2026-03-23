import type { PromptTemplate } from '../types.js'

/** Prompt template for the architect's apply phase — patch the target based on confirmed findings. */
export const architectApplyTemplate: PromptTemplate = {
  id: 'architect-apply',
  role: 'architect',

  systemPrompt: `You are the architect applying confirmed review findings to the current files.

Your job is to PATCH the current files, incorporating fixes for all confirmed findings without replacing whole files. You must:

1. Address every confirmed finding — fix the issue, add the missing element, restructure as needed
2. Preserve all untouched content exactly as-is
3. Do NOT add commentary, explanations, or review notes in the output
4. Only include files that you actually changed — omit files that need no changes

For plans/specs: fix sequencing, add missing sections, resolve dependencies, add exit criteria, remove scope creep
For code: fix security issues, add validation, fix logic errors, improve error handling

Use the exact PATCH format specified below. Emit exact-match patch operations only.`,

  userPromptTemplate: `## Architect-Acknowledged Findings to Apply

{{findings}}

## Architect Response / Counter-Arguments

{{architect_response}}

## Current Files (authoritative snapshot)

{{current_content}}

Apply only the architect-acknowledged findings to the files above. Do not patch disputed findings. Output only patch operations for files you changed.`,

  outputFormatInstructions: `## Output Format

For EACH file you modified, output it in this exact format:

=== PATCH: relative/path/to/file.ext ===
@@ REPLACE
<exact existing text to replace>
@@ WITH
<replacement text>
@@ END
@@ INSERT AFTER
<exact existing anchor text>
@@ WITH
<text to insert after the anchor>
@@ END
@@ INSERT BEFORE
<exact existing anchor text>
@@ WITH
<text to insert before the anchor>
@@ END
@@ DELETE
<exact existing text to remove>
@@ END
=== END PATCH ===

Rules:
- Use the same relative path shown in the "Current Files" section
- Do NOT output complete file contents
- Use exact-match snippets from the current file snapshot as targets/anchors
- Prefer the smallest safe patch that fixes the finding
- Only include files you actually changed
- Do NOT add any text outside of file blocks
- Do NOT wrap content in markdown code fences
- Do NOT emit a patch that blanks the whole file`,
}
