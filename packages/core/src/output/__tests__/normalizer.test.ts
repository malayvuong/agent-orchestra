import { describe, it, expect } from 'vitest'
import { DefaultOutputNormalizer } from '../normalizer.js'
import type { ProviderOutput } from '../../types/output.js'

describe('DefaultOutputNormalizer', () => {
  const normalizer = new DefaultOutputNormalizer()

  const defaultMeta = {
    agentId: 'agent-1',
    role: 'reviewer' as const,
    templateVersion: 1,
  }

  describe('Strategy 1: structured sections with findings', () => {
    it('should parse findings from structured sections array', () => {
      const providerOutput: ProviderOutput = {
        rawText: 'Raw output text',
        structuredSections: {
          findings: [
            {
              id: 'f-1',
              title: 'Security Issue',
              description: 'XSS vulnerability found',
              scopeType: 'primary',
              actionability: 'must_fix_now',
              confidence: 'high',
            },
            {
              id: 'f-2',
              title: 'Code Style',
              description: 'Inconsistent naming',
              scopeType: 'reference',
              actionability: 'note_only',
              confidence: 'low',
            },
          ],
          summary: 'Two issues found.',
        },
        usage: { inputTokens: 100, outputTokens: 50 },
      }

      const result = normalizer.normalize(providerOutput, defaultMeta)

      expect(result.malformed).toBe(false)
      expect(result.output.findings).toHaveLength(2)
      expect(result.output.findings[0].title).toBe('Security Issue')
      expect(result.output.findings[0].scopeType).toBe('primary')
      expect(result.output.findings[1].title).toBe('Code Style')
      expect(result.output.findings[1].actionability).toBe('note_only')
      expect(result.output.structuredSections['summary']).toBe('Two issues found.')
      expect(result.output.usage?.inputTokens).toBe(100)
    })

    it('should parse findings from JSON string in structured sections', () => {
      const providerOutput: ProviderOutput = {
        rawText: 'Raw output',
        structuredSections: {
          findings: JSON.stringify([
            {
              title: 'Bug',
              description: 'Off-by-one error',
              scope: 'primary',
              actionability: 'must_fix_now',
              confidence: 'high',
            },
          ]),
        },
      }

      const result = normalizer.normalize(providerOutput, defaultMeta)

      expect(result.malformed).toBe(false)
      expect(result.output.findings).toHaveLength(1)
      expect(result.output.findings[0].title).toBe('Bug')
      expect(result.output.findings[0].scopeType).toBe('primary')
    })

    it('should apply defaults for missing finding fields', () => {
      const providerOutput: ProviderOutput = {
        rawText: 'Raw output',
        structuredSections: {
          findings: [
            {
              title: 'Minimal Finding',
            },
          ],
        },
      }

      const result = normalizer.normalize(providerOutput, defaultMeta)

      expect(result.malformed).toBe(false)
      expect(result.output.findings).toHaveLength(1)
      expect(result.output.findings[0].title).toBe('Minimal Finding')
      expect(result.output.findings[0].scopeType).toBe('primary')
      expect(result.output.findings[0].actionability).toBe('note_only')
      expect(result.output.findings[0].confidence).toBe('medium')
      expect(result.output.findings[0].description).toBe('')
    })

    it('should fall through to markdown when structured sections have no findings key', () => {
      const providerOutput: ProviderOutput = {
        rawText:
          '## Findings\n\n### Finding 1\n- **Title:** Fallback\n- **Scope:** primary\n- **Description:** Parsed via markdown.',
        structuredSections: {
          summary: 'A summary without findings key',
        },
      }

      const result = normalizer.normalize(providerOutput, defaultMeta)

      expect(result.malformed).toBe(false)
      expect(result.output.findings).toHaveLength(1)
      expect(result.output.findings[0].title).toBe('Fallback')
    })
  })

  describe('Strategy 2: markdown-formatted rawText', () => {
    it('should parse findings from markdown', () => {
      const providerOutput: ProviderOutput = {
        rawText: `
## Summary
The code has issues.

## Findings

### Finding 1
- **Title:** Memory Leak
- **Scope:** primary
- **Actionability:** must_fix_now
- **Confidence:** high
- **Evidence:** Event listener on line 15 is never removed
- **Description:** The component registers a global event listener but never cleans it up.

### Finding 2
- **Title:** Missing Test
- **Scope:** reference
- **Actionability:** follow_up_candidate
- **Confidence:** medium
- **Description:** No unit test for the error handling path.
`,
      }

      const result = normalizer.normalize(providerOutput, defaultMeta)

      expect(result.malformed).toBe(false)
      expect(result.output.findings).toHaveLength(2)
      expect(result.output.findings[0].title).toBe('Memory Leak')
      expect(result.output.findings[0].scopeType).toBe('primary')
      expect(result.output.findings[0].confidence).toBe('high')
      expect(result.output.findings[0].evidence?.summary).toBe(
        'Event listener on line 15 is never removed',
      )
      expect(result.output.findings[1].title).toBe('Missing Test')
      expect(result.output.findings[1].actionability).toBe('follow_up_candidate')
    })
  })

  describe('Strategy 3: malformed detection', () => {
    it('should mark as malformed when no structured sections and no markdown findings', () => {
      const providerOutput: ProviderOutput = {
        rawText: 'This is just some unstructured text without any findings section.',
      }

      const result = normalizer.normalize(providerOutput, defaultMeta)

      expect(result.malformed).toBe(true)
      expect(result.malformedReason).toContain('agent-1')
      expect(result.malformedReason).toContain('reviewer')
      expect(result.malformedReason).toContain('v1')
      expect(result.output.findings).toHaveLength(0)
    })

    it('should mark as malformed when rawText is empty', () => {
      const providerOutput: ProviderOutput = {
        rawText: '',
      }

      const result = normalizer.normalize(providerOutput, defaultMeta)

      expect(result.malformed).toBe(true)
    })
  })

  describe('warning extraction', () => {
    it('should extract WARNING: lines from raw text', () => {
      const providerOutput: ProviderOutput = {
        rawText: `
## Findings

### Finding 1
- **Title:** Test
- **Scope:** primary
- **Description:** Desc.

WARNING: This finding may not apply to all configurations.
WARNING: The evidence is based on static analysis only.
`,
      }

      const result = normalizer.normalize(providerOutput, defaultMeta)

      expect(result.warnings).toContain(
        'WARNING: This finding may not apply to all configurations.',
      )
      expect(result.warnings).toContain('WARNING: The evidence is based on static analysis only.')
    })

    it('should extract Note: lines from raw text', () => {
      const providerOutput: ProviderOutput = {
        rawText: `
## Findings

### Finding 1
- **Title:** Test
- **Scope:** primary
- **Description:** Desc.

Note: Consider reviewing the deployment configuration as well.
`,
      }

      const result = normalizer.normalize(providerOutput, defaultMeta)

      expect(result.warnings).toContain(
        'Note: Consider reviewing the deployment configuration as well.',
      )
    })

    it('should include provider-level warnings', () => {
      const providerOutput: ProviderOutput = {
        rawText: '## Findings\n\n### Finding 1\n- **Title:** T\n- **Description:** D.',
        warnings: ['Response was truncated due to max_tokens limit'],
      }

      const result = normalizer.normalize(providerOutput, defaultMeta)

      expect(result.warnings).toContain('Response was truncated due to max_tokens limit')
    })
  })

  describe('usage data passthrough', () => {
    it('should pass through usage data from provider output', () => {
      const providerOutput: ProviderOutput = {
        rawText: '## Findings\n\n### Finding 1\n- **Title:** T\n- **Description:** D.',
        usage: {
          inputTokens: 500,
          outputTokens: 250,
          cost: 0.01,
          latencyMs: 1500,
        },
      }

      const result = normalizer.normalize(providerOutput, defaultMeta)

      expect(result.output.usage?.inputTokens).toBe(500)
      expect(result.output.usage?.outputTokens).toBe(250)
      expect(result.output.usage?.cost).toBe(0.01)
      expect(result.output.usage?.latencyMs).toBe(1500)
    })

    it('should handle missing usage data', () => {
      const providerOutput: ProviderOutput = {
        rawText: '## Findings\n\n### Finding 1\n- **Title:** T\n- **Description:** D.',
      }

      const result = normalizer.normalize(providerOutput, defaultMeta)

      expect(result.output.usage).toBeUndefined()
    })
  })

  describe('structured sections normalization', () => {
    it('should convert non-string values to JSON strings in structuredSections', () => {
      const providerOutput: ProviderOutput = {
        rawText: 'text',
        structuredSections: {
          findings: [{ title: 'T', description: 'D' }],
          count: 1,
          metadata: { nested: true },
          summary: 'A plain string',
        },
      }

      const result = normalizer.normalize(providerOutput, defaultMeta)

      expect(result.output.structuredSections['summary']).toBe('A plain string')
      expect(result.output.structuredSections['count']).toBe('1')
      expect(result.output.structuredSections['metadata']).toBe('{"nested":true}')
    })
  })

  describe('finding evidence mapping from structured data', () => {
    it('should map evidence object with files and summary', () => {
      const providerOutput: ProviderOutput = {
        rawText: 'text',
        structuredSections: {
          findings: [
            {
              title: 'Finding with Evidence',
              description: 'Has evidence',
              evidence: {
                files: ['src/auth.ts', 'src/middleware.ts'],
                summary: 'SQL injection in auth module',
              },
            },
          ],
        },
      }

      const result = normalizer.normalize(providerOutput, defaultMeta)

      expect(result.output.findings[0].evidence?.files).toEqual([
        'src/auth.ts',
        'src/middleware.ts',
      ])
      expect(result.output.findings[0].evidence?.summary).toBe('SQL injection in auth module')
    })

    it('should handle tags array in structured findings', () => {
      const providerOutput: ProviderOutput = {
        rawText: 'text',
        structuredSections: {
          findings: [
            {
              title: 'Tagged Finding',
              description: 'Has tags',
              tags: ['security', 'auth'],
            },
          ],
        },
      }

      const result = normalizer.normalize(providerOutput, defaultMeta)

      expect(result.output.findings[0].tags).toEqual(['security', 'auth'])
    })
  })
})
