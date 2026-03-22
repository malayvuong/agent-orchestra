import { describe, it, expect } from 'vitest'
import { parseFindingsFromMarkdown } from '../finding-parser.js'

describe('parseFindingsFromMarkdown', () => {
  describe('valid markdown parsing', () => {
    it('should parse a single finding with all fields', () => {
      const text = `
## Findings

### Finding 1
- **Title:** SQL Injection Vulnerability
- **Scope:** primary
- **Actionability:** must_fix_now
- **Confidence:** high
- **Evidence:** User input is passed directly to SQL query on line 42
- **Description:** The login endpoint concatenates user input into a SQL query without parameterization.
`

      const findings = parseFindingsFromMarkdown(text)

      expect(findings).toHaveLength(1)
      expect(findings[0].id).toBe('finding-1')
      expect(findings[0].title).toBe('SQL Injection Vulnerability')
      expect(findings[0].scopeType).toBe('primary')
      expect(findings[0].actionability).toBe('must_fix_now')
      expect(findings[0].confidence).toBe('high')
      expect(findings[0].evidence?.summary).toBe(
        'User input is passed directly to SQL query on line 42',
      )
      expect(findings[0].description).toBe(
        'The login endpoint concatenates user input into a SQL query without parameterization.',
      )
    })

    it('should parse multiple findings', () => {
      const text = `
## Findings

### Finding 1
- **Title:** Missing Error Handling
- **Scope:** primary
- **Actionability:** must_fix_now
- **Confidence:** high
- **Description:** No try-catch around database calls.

### Finding 2
- **Title:** Unused Import
- **Scope:** reference
- **Actionability:** note_only
- **Confidence:** medium
- **Description:** The lodash import on line 3 is never used.

### Finding 3
- **Title:** Performance Concern
- **Scope:** out_of_scope
- **Actionability:** follow_up_candidate
- **Confidence:** low
- **Description:** The nested loop may cause O(n^2) behavior for large datasets.
`

      const findings = parseFindingsFromMarkdown(text)

      expect(findings).toHaveLength(3)

      expect(findings[0].title).toBe('Missing Error Handling')
      expect(findings[0].scopeType).toBe('primary')
      expect(findings[0].actionability).toBe('must_fix_now')
      expect(findings[0].confidence).toBe('high')

      expect(findings[1].title).toBe('Unused Import')
      expect(findings[1].scopeType).toBe('reference')
      expect(findings[1].actionability).toBe('note_only')
      expect(findings[1].confidence).toBe('medium')

      expect(findings[2].title).toBe('Performance Concern')
      expect(findings[2].scopeType).toBe('out_of_scope')
      expect(findings[2].actionability).toBe('follow_up_candidate')
      expect(findings[2].confidence).toBe('low')
    })

    it('should handle findings with extra text before and after', () => {
      const text = `
# Code Review Report

Here is my analysis of the code.

## Summary

The code has some issues.

## Findings

### Finding 1
- **Title:** Bug Found
- **Scope:** primary
- **Actionability:** must_fix_now
- **Confidence:** high
- **Description:** Found a bug.

## Recommendations

Fix the bugs.
`

      const findings = parseFindingsFromMarkdown(text)

      expect(findings).toHaveLength(1)
      expect(findings[0].title).toBe('Bug Found')
    })
  })

  describe('missing fields — defaults', () => {
    it('should default scope to primary when missing', () => {
      const text = `
## Findings

### Finding 1
- **Title:** Missing Scope
- **Actionability:** note_only
- **Confidence:** high
- **Description:** Test finding.
`

      const findings = parseFindingsFromMarkdown(text)

      expect(findings).toHaveLength(1)
      expect(findings[0].scopeType).toBe('primary')
    })

    it('should default actionability to note_only when missing', () => {
      const text = `
## Findings

### Finding 1
- **Title:** Missing Actionability
- **Scope:** primary
- **Confidence:** high
- **Description:** Test finding.
`

      const findings = parseFindingsFromMarkdown(text)

      expect(findings).toHaveLength(1)
      expect(findings[0].actionability).toBe('note_only')
    })

    it('should default confidence to medium when missing', () => {
      const text = `
## Findings

### Finding 1
- **Title:** Missing Confidence
- **Scope:** primary
- **Actionability:** must_fix_now
- **Description:** Test finding.
`

      const findings = parseFindingsFromMarkdown(text)

      expect(findings).toHaveLength(1)
      expect(findings[0].confidence).toBe('medium')
    })

    it('should default title to Finding N when missing', () => {
      const text = `
## Findings

### Finding 1
- **Scope:** primary
- **Actionability:** must_fix_now
- **Confidence:** high
- **Description:** A finding without an explicit title.
`

      const findings = parseFindingsFromMarkdown(text)

      expect(findings).toHaveLength(1)
      expect(findings[0].title).toBe('Finding 1')
    })

    it('should handle all fields missing except title', () => {
      const text = `
## Findings

### Finding 1
- **Title:** Only Title Provided
`

      const findings = parseFindingsFromMarkdown(text)

      expect(findings).toHaveLength(1)
      expect(findings[0].title).toBe('Only Title Provided')
      expect(findings[0].scopeType).toBe('primary')
      expect(findings[0].actionability).toBe('note_only')
      expect(findings[0].confidence).toBe('medium')
      expect(findings[0].description).toBe('')
    })

    it('should handle invalid enum values with defaults', () => {
      const text = `
## Findings

### Finding 1
- **Title:** Invalid Enums
- **Scope:** invalid_scope
- **Actionability:** invalid_action
- **Confidence:** invalid_confidence
- **Description:** Test.
`

      const findings = parseFindingsFromMarkdown(text)

      expect(findings).toHaveLength(1)
      expect(findings[0].scopeType).toBe('primary')
      expect(findings[0].actionability).toBe('note_only')
      expect(findings[0].confidence).toBe('medium')
    })
  })

  describe('no findings section', () => {
    it('should return empty array when no ## Findings section', () => {
      const text = `
# Code Review

This code looks good. No issues found.

## Summary

Everything is fine.
`

      const findings = parseFindingsFromMarkdown(text)
      expect(findings).toHaveLength(0)
    })

    it('should return empty array for empty string', () => {
      const findings = parseFindingsFromMarkdown('')
      expect(findings).toHaveLength(0)
    })

    it('should return empty array when ## Findings exists but has no ### blocks', () => {
      const text = `
## Findings

No findings to report.
`

      const findings = parseFindingsFromMarkdown(text)
      expect(findings).toHaveLength(0)
    })
  })

  describe('edge cases', () => {
    it('should handle case-insensitive section headers', () => {
      const text = `
## findings

### Finding 1
- **Title:** Case Test
- **Scope:** primary
- **Description:** Test.
`

      const findings = parseFindingsFromMarkdown(text)

      expect(findings).toHaveLength(1)
      expect(findings[0].title).toBe('Case Test')
    })

    it('should not include evidence field when not present', () => {
      const text = `
## Findings

### Finding 1
- **Title:** No Evidence
- **Scope:** primary
- **Description:** Test.
`

      const findings = parseFindingsFromMarkdown(text)

      expect(findings).toHaveLength(1)
      expect(findings[0].evidence).toBeUndefined()
    })

    it('should generate sequential IDs', () => {
      const text = `
## Findings

### Finding 1
- **Title:** First
- **Scope:** primary
- **Description:** One.

### Finding 2
- **Title:** Second
- **Scope:** primary
- **Description:** Two.
`

      const findings = parseFindingsFromMarkdown(text)

      expect(findings[0].id).toBe('finding-1')
      expect(findings[1].id).toBe('finding-2')
    })

    it('should handle titled headings (not "Finding N" format)', () => {
      const text = `
## Findings

### SQL Injection Risk
- **Scope:** primary
- **Actionability:** must_fix_now
- **Confidence:** high
- **Description:** Direct string concatenation in queries.
`

      const findings = parseFindingsFromMarkdown(text)

      expect(findings).toHaveLength(1)
      expect(findings[0].title).toBe('SQL Injection Risk')
    })
  })
})
