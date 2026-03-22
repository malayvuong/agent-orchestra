import type { AgentRole } from '../types/agent.js'
import type { Finding } from '../types/finding.js'
import type { AgentOutput, NormalizationResult, ProviderOutput } from '../types/output.js'
import type { OutputNormalizer } from '../interfaces/output-normalizer.js'
import { parseFindingsFromMarkdown } from './finding-parser.js'

/**
 * Metadata passed to the normalizer alongside the provider output.
 */
type NormalizationMeta = {
  agentId: string
  role: AgentRole
  templateVersion: number
}

/**
 * Default implementation of the OutputNormalizer interface.
 *
 * Spec v1.3 §23.2 — two-stage normalization (Stage 2):
 * Maps ProviderOutput → AgentOutput using three strategies:
 *
 * 1. If `structuredSections` present with 'findings' key → parse as JSON findings
 * 2. If `rawText` contains `## Findings` → parse with finding-parser (markdown)
 * 3. If neither → mark as malformed
 *
 * Phase 1 hard rule (§23.4): no LLM-assisted fallback.
 * Prompt templates with output format instructions are the primary mechanism.
 */
export class DefaultOutputNormalizer implements OutputNormalizer {
  /**
   * Normalize a ProviderOutput into a structured AgentOutput.
   *
   * @param providerOutput - Raw output from the provider adapter (Stage 1)
   * @param meta - Agent metadata (id, role, template version)
   * @returns NormalizationResult with the AgentOutput, warnings, and malformed flag
   */
  normalize(providerOutput: ProviderOutput, meta: NormalizationMeta): NormalizationResult {
    const warnings: string[] = []

    // Collect warnings from provider output
    if (providerOutput.warnings) {
      warnings.push(...providerOutput.warnings)
    }

    // Extract inline warnings from raw text
    const textWarnings = this.extractWarnings(providerOutput.rawText)
    warnings.push(...textWarnings)

    // Strategy 1: Structured sections with findings key
    if (providerOutput.structuredSections) {
      const structuredFindings = this.tryStructuredStrategy(providerOutput.structuredSections)
      if (structuredFindings !== null) {
        const output: AgentOutput = {
          rawText: providerOutput.rawText,
          structuredSections: this.normalizeStructuredSections(providerOutput.structuredSections),
          findings: structuredFindings,
          warnings,
          usage: providerOutput.usage,
        }

        return { output, warnings, malformed: false }
      }
    }

    // Strategy 2: Markdown-formatted rawText with finding blocks
    // Accept either "## Findings" section header or direct "### Finding:" blocks
    const hasFindingsSection = providerOutput.rawText.includes('## Findings')
    const hasDirectFindings = /^###\s+Finding[\s:]/m.test(providerOutput.rawText)
    if (hasFindingsSection || hasDirectFindings) {
      const markdownFindings = parseFindingsFromMarkdown(providerOutput.rawText)

      const output: AgentOutput = {
        rawText: providerOutput.rawText,
        structuredSections: {},
        findings: markdownFindings,
        warnings,
        usage: providerOutput.usage,
      }

      return { output, warnings, malformed: false }
    }

    // Strategy 3: Malformed — cannot parse findings
    const output: AgentOutput = {
      rawText: providerOutput.rawText,
      structuredSections: {},
      findings: [],
      warnings,
      usage: providerOutput.usage,
    }

    return {
      output,
      warnings,
      malformed: true,
      malformedReason: `Unable to extract findings from agent ${meta.agentId} (role: ${meta.role}, template v${meta.templateVersion}). Output contains neither structured sections with findings nor markdown-formatted findings section.`,
    }
  }

  /**
   * Attempt to extract findings from structured sections.
   *
   * Looks for a 'findings' key in structuredSections and parses it as
   * a JSON array of Finding objects.
   *
   * @returns Array of findings if successful, null if not applicable
   */
  private tryStructuredStrategy(sections: Record<string, unknown>): Finding[] | null {
    const findingsData = sections['findings'] ?? sections['Findings']
    if (!findingsData) {
      return null
    }

    // If it's already an array, try to map each item to a Finding
    if (Array.isArray(findingsData)) {
      return this.mapToFindings(findingsData)
    }

    // If it's a string, try to parse as JSON
    if (typeof findingsData === 'string') {
      try {
        const parsed = JSON.parse(findingsData)
        if (Array.isArray(parsed)) {
          return this.mapToFindings(parsed)
        }
      } catch {
        // Not valid JSON — fall through to markdown strategy
      }
    }

    return null
  }

  /**
   * Map raw data items to Finding objects with validation and defaults.
   */
  private mapToFindings(items: unknown[]): Finding[] {
    return items
      .filter((item): item is Record<string, unknown> => {
        return item !== null && typeof item === 'object' && !Array.isArray(item)
      })
      .map((item, index) => ({
        id: typeof item.id === 'string' ? item.id : `finding-${index + 1}`,
        title: typeof item.title === 'string' ? item.title : `Finding ${index + 1}`,
        description: typeof item.description === 'string' ? item.description : '',
        scopeType: this.validScope(item.scopeType ?? item.scope) ?? 'primary',
        actionability: this.validActionability(item.actionability) ?? 'note_only',
        confidence: this.validConfidence(item.confidence) ?? 'medium',
        ...(item.evidence && typeof item.evidence === 'object'
          ? {
              evidence: {
                files: Array.isArray((item.evidence as Record<string, unknown>).files)
                  ? ((item.evidence as Record<string, unknown>).files as string[])
                  : [],
                summary:
                  typeof (item.evidence as Record<string, unknown>).summary === 'string'
                    ? ((item.evidence as Record<string, unknown>).summary as string)
                    : '',
              },
            }
          : {}),
        ...(Array.isArray(item.tags) ? { tags: item.tags as string[] } : {}),
      }))
  }

  /**
   * Normalize structuredSections from Record<string, unknown> to Record<string, string>.
   */
  private normalizeStructuredSections(sections: Record<string, unknown>): Record<string, string> {
    const result: Record<string, string> = {}
    for (const [key, value] of Object.entries(sections)) {
      if (typeof value === 'string') {
        result[key] = value
      } else {
        result[key] = JSON.stringify(value)
      }
    }
    return result
  }

  /**
   * Extract warning lines from raw text.
   *
   * Matches lines starting with "WARNING:" or "Note:" (case-insensitive).
   */
  private extractWarnings(text: string): string[] {
    const warnings: string[] = []
    const lines = text.split('\n')

    for (const line of lines) {
      const trimmed = line.trim()
      if (/^WARNING\s*:/i.test(trimmed)) {
        warnings.push(trimmed)
      } else if (/^Note\s*:/i.test(trimmed)) {
        warnings.push(trimmed)
      }
    }

    return warnings
  }

  /**
   * Validate a scope type value.
   */
  private validScope(value: unknown): 'primary' | 'reference' | 'out_of_scope' | null {
    if (typeof value === 'string') {
      const v = value.toLowerCase().trim()
      if (v === 'primary' || v === 'reference' || v === 'out_of_scope') {
        return v
      }
    }
    return null
  }

  /**
   * Validate an actionability value.
   */
  private validActionability(
    value: unknown,
  ): 'must_fix_now' | 'note_only' | 'follow_up_candidate' | null {
    if (typeof value === 'string') {
      const v = value.toLowerCase().trim()
      if (v === 'must_fix_now' || v === 'note_only' || v === 'follow_up_candidate') {
        return v
      }
    }
    return null
  }

  /**
   * Validate a confidence value.
   */
  private validConfidence(value: unknown): 'high' | 'medium' | 'low' | null {
    if (typeof value === 'string') {
      const v = value.toLowerCase().trim()
      if (v === 'high' || v === 'medium' || v === 'low') {
        return v
      }
    }
    return null
  }
}
