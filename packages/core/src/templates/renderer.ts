import type { PromptTemplate, RenderedPrompt } from './types.js'

/**
 * Render a prompt template by substituting {{variable}} placeholders.
 *
 * Variables are provided as a Record<string, string>. Any placeholder
 * not present in the variables map is left as-is in the output.
 */
export function renderTemplate(
  template: PromptTemplate,
  variables: Record<string, string>,
): RenderedPrompt {
  const system = substituteVariables(template.systemPrompt, variables)

  // Build the full user prompt: template + output format instructions
  const userBody = substituteVariables(template.userPromptTemplate, variables)
  const outputFormat = substituteVariables(template.outputFormatInstructions, variables)
  const user = userBody + '\n\n' + outputFormat

  return { system, user }
}

/**
 * Replace all {{key}} placeholders in a string with values from the variables map.
 * Unmatched placeholders are left unchanged.
 */
function substituteVariables(text: string, variables: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    return key in variables ? variables[key] : match
  })
}
