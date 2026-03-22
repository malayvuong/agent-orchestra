import type {
  Finding,
  FindingScopeType,
  FindingActionability,
  FindingConfidence,
} from '../types/finding.js'

/** Valid scope type values for validation */
const VALID_SCOPE_TYPES: Set<string> = new Set(['primary', 'reference', 'out_of_scope'])

/** Valid actionability values for validation */
const VALID_ACTIONABILITIES: Set<string> = new Set([
  'must_fix_now',
  'note_only',
  'follow_up_candidate',
])

/** Valid confidence values for validation */
const VALID_CONFIDENCES: Set<string> = new Set(['high', 'medium', 'low'])

/**
 * Parse findings from markdown-formatted text following spec v1.3 §22.4 format.
 *
 * Expected format:
 * ```
 * ## Findings
 *
 * ### Finding 1
 * - **Title:** ...
 * - **Scope:** primary | reference | out_of_scope
 * - **Actionability:** must_fix_now | note_only | follow_up_candidate
 * - **Confidence:** high | medium | low
 * - **Evidence:** ...
 * - **Description:** ...
 * ```
 *
 * Tolerant parser: missing fields receive defaults.
 *
 * @param text - Raw markdown text from a provider response
 * @returns Array of parsed Finding objects
 */
export function parseFindingsFromMarkdown(text: string): Finding[] {
  const findings: Finding[] = []

  // Find the "## Findings" section, or fall back to the first "### Finding" block
  const findingsSectionMatch = text.match(/##\s+Findings\b/i)
  let sectionText: string

  if (findingsSectionMatch) {
    // Get text from "## Findings" onwards
    sectionText = text.slice(findingsSectionMatch.index!)
  } else {
    // No "## Findings" header — look for direct "### Finding" blocks
    const firstFindingMatch = text.match(/^###\s+Finding[\s:]/m)
    if (!firstFindingMatch) {
      return findings
    }
    sectionText = text.slice(firstFindingMatch.index!)
  }

  // Split into individual finding blocks using ### Finding N pattern
  const findingBlocks = splitFindingBlocks(sectionText)

  for (let i = 0; i < findingBlocks.length; i++) {
    const block = findingBlocks[i]
    const finding = parseSingleFinding(block, i + 1)
    if (finding) {
      findings.push(finding)
    }
  }

  return findings
}

/**
 * Split the findings section into individual finding blocks.
 * Each block starts with "### Finding N" or "### " followed by a title.
 */
function splitFindingBlocks(sectionText: string): string[] {
  const blocks: string[] = []

  // Match ### Finding N or ### <title> patterns
  const headerPattern = /^###\s+(?:Finding\s+\d+|[^\n]+)/gim
  const matches: Array<{ index: number; match: string }> = []

  let match: RegExpExecArray | null
  while ((match = headerPattern.exec(sectionText)) !== null) {
    matches.push({ index: match.index, match: match[0] })
  }

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index
    const end = i + 1 < matches.length ? matches[i + 1].index : sectionText.length

    // Stop if we hit a new ## section (not ###)
    const blockText = sectionText.slice(start, end)
    const nextH2 = blockText.search(/\n##\s+(?!#)/)
    const finalText = nextH2 >= 0 ? blockText.slice(0, nextH2) : blockText

    blocks.push(finalText)
  }

  return blocks
}

/**
 * Parse a single finding block into a Finding object.
 */
function parseSingleFinding(block: string, index: number): Finding | null {
  let title = extractField(block, 'Title') ?? `Finding ${index}`
  const description = extractField(block, 'Description') ?? ''

  // If the title is just the default "Finding N", check if the heading has a descriptive title
  if (title === `Finding ${index}`) {
    const headingMatch = block.match(/^###\s+(.+)/m)
    if (headingMatch) {
      let headingText = headingMatch[1].trim()
      const findingNumMatch = headingText.match(/^Finding\s+\d+$/i)
      // Handle "### Finding: <title>" format (strip "Finding:" prefix)
      const findingColonMatch = headingText.match(/^Finding\s*[:：]\s*(.+)/i)
      if (findingColonMatch) {
        headingText = findingColonMatch[1].trim()
        title = headingText
      } else if (!findingNumMatch && headingText.length > 0) {
        // The heading itself is a descriptive title
        title = headingText
      }
    }
  }

  // If we have no meaningful content at all, skip this block
  if (title === `Finding ${index}` && !description) {
    if (!extractField(block, 'Scope') && !extractField(block, 'Confidence')) {
      return null
    }
  }

  return buildFinding(title, description, block, index)
}

/**
 * Build a Finding object from parsed fields.
 */
function buildFinding(
  title: string,
  rawDescription: string,
  block: string,
  index: number,
): Finding {
  // If no explicit Description field, extract body text after metadata lines
  let description = rawDescription
  if (!description) {
    const lines = block.split('\n')
    const bodyLines: string[] = []
    let pastMetadata = false
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.startsWith('###')) continue // skip heading
      if (trimmed.startsWith('- **') || trimmed.startsWith('**')) {
        pastMetadata = true
        continue // skip metadata fields
      }
      if (pastMetadata && trimmed.length > 0) {
        bodyLines.push(trimmed)
      }
    }
    description = bodyLines.join(' ').trim()
  }
  const scopeRaw = extractField(block, 'Scope')
  const actionabilityRaw = extractField(block, 'Actionability')
  const confidenceRaw = extractField(block, 'Confidence')
  const evidenceRaw = extractField(block, 'Evidence')

  const scopeType: FindingScopeType = VALID_SCOPE_TYPES.has(scopeRaw ?? '')
    ? (scopeRaw as FindingScopeType)
    : 'primary'

  const actionability: FindingActionability = VALID_ACTIONABILITIES.has(actionabilityRaw ?? '')
    ? (actionabilityRaw as FindingActionability)
    : 'note_only'

  const confidence: FindingConfidence = VALID_CONFIDENCES.has(confidenceRaw ?? '')
    ? (confidenceRaw as FindingConfidence)
    : 'medium'

  return {
    id: `finding-${index}`,
    title,
    description,
    scopeType,
    actionability,
    confidence,
    ...(evidenceRaw && {
      evidence: {
        files: [],
        summary: evidenceRaw,
      },
    }),
  }
}

/**
 * Extract a field value from a markdown block.
 *
 * Matches patterns like:
 * - **Field:** value
 * - **Field**: value
 */
function extractField(block: string, fieldName: string): string | null {
  // Match "- **FieldName:** value" or "- **FieldName**: value"
  const pattern = new RegExp(`^\\s*-\\s*\\*\\*${fieldName}\\s*[:：]\\*\\*\\s*(.+)`, 'im')
  const match = block.match(pattern)
  if (match) {
    return match[1].trim()
  }

  // Also try without the dash prefix for flexibility
  const altPattern = new RegExp(`\\*\\*${fieldName}\\s*[:：]\\*\\*\\s*(.+)`, 'im')
  const altMatch = block.match(altPattern)
  return altMatch ? altMatch[1].trim() : null
}
