import { parse as parseYaml, YAMLParseError } from 'yaml'
import type { TokenEstimator } from '../interfaces/token-estimator.js'
import type { SkillDefinition, SkillParseError, SkillTrigger } from './types.js'
import type { AgentLens, AgentRole } from '../types/agent.js'
import { AGENT_ORCHESTRA_VERSION, isValidCalver } from '@malayvuong/agent-orchestra-shared'

/** Spec Task 1.2 — SKILL.md parser */

const VALID_LENSES: ReadonlySet<AgentLens> = new Set<AgentLens>([
  'logic',
  'consistency',
  'regression',
  'testing',
  'performance',
  'security',
  'cross_system_contract',
  'scope',
  'dependency',
  'sequencing',
  'simplification',
  'risk',
  'implementation_readiness',
])

const VALID_ROLES: ReadonlySet<AgentRole> = new Set<AgentRole>(['architect', 'reviewer', 'builder'])

/** Patterns that indicate potential prompt injection in skill content */
const INJECTION_PATTERNS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  {
    pattern: /IGNORE\s+PREVIOUS\s+INSTRUCTIONS/i,
    label: 'IGNORE PREVIOUS INSTRUCTIONS',
  },
  { pattern: /You\s+are\s+now\b/i, label: 'You are now...' },
  { pattern: /System\s+prompt\s*:/i, label: 'System prompt:' },
  { pattern: /<\/?system\s*>/i, label: '<system> tag' },
]

/** HTML tag stripping regex */
const HTML_TAG_RE = /<[^>]*>/g

export type SkillParseResult = {
  skill: SkillDefinition
  warnings: string[]
}

export class SkillParser {
  constructor(private tokenEstimator: TokenEstimator) {}

  /**
   * Parse a SKILL.md file's raw content into a SkillDefinition.
   * Returns SkillParseError (never throws) on malformed input.
   */
  parse(filePath: string, rawContent: string): SkillParseResult | SkillParseError {
    const frontmatterResult = this.parseFrontmatter(rawContent)
    if (
      frontmatterResult !== null &&
      typeof frontmatterResult === 'object' &&
      'type' in frontmatterResult &&
      frontmatterResult.type === 'parse_error'
    ) {
      // Enrich the error with the actual file path (parseFrontmatter doesn't know it)
      const err = frontmatterResult as SkillParseError
      return { ...err, path: filePath }
    }

    const fm = frontmatterResult as Record<string, unknown>
    const warnings: string[] = []

    // --- Required field validation ---
    if (typeof fm['name'] !== 'string' || fm['name'].trim() === '') {
      return {
        type: 'parse_error',
        path: filePath,
        message: 'Missing required frontmatter field: name',
      }
    }

    if (typeof fm['description'] !== 'string' || fm['description'].trim() === '') {
      return {
        type: 'parse_error',
        path: filePath,
        message: 'Missing required frontmatter field: description',
      }
    }

    const name = (fm['name'] as string).trim()
    const description = (fm['description'] as string).trim()

    // --- Optional field extraction ---
    const version = typeof fm['version'] === 'string' ? fm['version'] : AGENT_ORCHESTRA_VERSION
    if (!isValidCalver(version)) {
      return {
        type: 'parse_error',
        path: filePath,
        message: `Skill version must be a valid CalVer (YYYY.M.PATCH). Received: ${version}`,
      }
    }
    const license = typeof fm['license'] === 'string' ? fm['license'] : undefined

    // --- Compatibility ---
    let compatibility: SkillDefinition['compatibility'] | undefined
    if (fm['compatibility'] !== undefined && fm['compatibility'] !== null) {
      if (typeof fm['compatibility'] === 'object') {
        const compat = fm['compatibility'] as Record<string, unknown>
        compatibility = {}
        if (typeof compat['agentOrchestra'] === 'string') {
          compatibility.agentOrchestra = compat['agentOrchestra']
        }
        if (Array.isArray(compat['platforms'])) {
          compatibility.platforms = (compat['platforms'] as unknown[])
            .filter((p) => typeof p === 'string')
            .map((p) => p as string)
        }
      }
    }

    // --- Triggers ---
    let triggers: SkillTrigger | undefined
    if (fm['triggers'] !== undefined && fm['triggers'] !== null) {
      if (typeof fm['triggers'] === 'object') {
        const raw = fm['triggers'] as Record<string, unknown>
        triggers = {}

        if (Array.isArray(raw['keywords'])) {
          triggers.keywords = (raw['keywords'] as unknown[])
            .filter((k) => typeof k === 'string')
            .map((k) => k as string)
        }

        if (Array.isArray(raw['lenses'])) {
          const lenses: AgentLens[] = []
          for (const v of raw['lenses'] as unknown[]) {
            if (typeof v === 'string' && VALID_LENSES.has(v as AgentLens)) {
              lenses.push(v as AgentLens)
            } else {
              warnings.push(`Unknown lens value "${String(v)}" in triggers.lenses — ignoring`)
            }
          }
          if (lenses.length > 0) {
            triggers.lenses = lenses
          }
        }

        if (Array.isArray(raw['roles'])) {
          const roles: AgentRole[] = []
          for (const v of raw['roles'] as unknown[]) {
            if (typeof v === 'string' && VALID_ROLES.has(v as AgentRole)) {
              roles.push(v as AgentRole)
            } else {
              warnings.push(`Unknown role value "${String(v)}" in triggers.roles — ignoring`)
            }
          }
          if (roles.length > 0) {
            triggers.roles = roles
          }
        }

        if (Array.isArray(raw['lifecycle'])) {
          const validLifecycle = new Set([
            'pre_round',
            'post_round',
            'pre_synthesis',
            'post_synthesis',
          ])
          triggers.lifecycle = (raw['lifecycle'] as unknown[])
            .filter(
              (v): v is SkillTrigger['lifecycle'] extends (infer U)[] | undefined ? U : never =>
                typeof v === 'string' && validLifecycle.has(v),
            )
            .map((v) => v as NonNullable<SkillTrigger['lifecycle']>[number])
        }
      }
    }

    // --- Unknown fields: warn but do not reject ---
    const knownFields = new Set([
      'name',
      'description',
      'version',
      'license',
      'compatibility',
      'triggers',
      'allowed-tools',
    ])
    for (const key of Object.keys(fm)) {
      if (!knownFields.has(key)) {
        warnings.push(`Unknown frontmatter field "${key}" — ignored for forward compatibility`)
      }
    }

    // --- Body extraction and sanitization ---
    const rawBody = this.parseBody(rawContent)

    // --- Prompt injection detection (run on raw body before HTML stripping) ---
    for (const { pattern, label } of INJECTION_PATTERNS) {
      if (pattern.test(rawBody)) {
        const msg = `Potential prompt injection pattern detected in "${filePath}": "${label}"`
        console.warn(msg)
        warnings.push(msg)
      }
    }

    const sanitizedBody = rawBody.replace(HTML_TAG_RE, '')

    // --- Summary generation ---
    const promptSummary = this.generateSummary(sanitizedBody, 500)

    // --- Derive ID from name ---
    const id = name.toLowerCase().replace(/\s+/g, '-')

    const skill: SkillDefinition = {
      id,
      version,
      name,
      description,
      skillType: 'prompt',
      source: { type: 'local', path: filePath },
      promptContent: sanitizedBody,
      promptSummary,
    }

    if (license !== undefined) skill.license = license
    if (compatibility !== undefined) skill.compatibility = compatibility
    if (triggers !== undefined) skill.triggers = triggers

    return { skill, warnings }
  }

  /**
   * Parse YAML frontmatter from raw SKILL.md content.
   * Returns parsed Record or SkillParseError if malformed.
   */
  parseFrontmatter(raw: string): Record<string, unknown> | SkillParseError {
    const trimmed = raw.trimStart()

    if (!trimmed.startsWith('---')) {
      return {
        type: 'parse_error',
        path: '',
        message: 'Missing YAML frontmatter: file must begin with --- delimiter',
      }
    }

    // Find the closing ---
    const afterOpen = trimmed.slice(3)
    const closingIndex = afterOpen.indexOf('\n---')

    if (closingIndex === -1) {
      return {
        type: 'parse_error',
        path: '',
        message: 'Malformed frontmatter: missing closing --- delimiter',
      }
    }

    const yamlContent = afterOpen.slice(0, closingIndex)

    try {
      const parsed = parseYaml(yamlContent)
      if (parsed === null || typeof parsed !== 'object') {
        return {}
      }
      return parsed as Record<string, unknown>
    } catch (err) {
      if (err instanceof YAMLParseError) {
        return {
          type: 'parse_error',
          path: '',
          message: `Invalid YAML in frontmatter: ${err.message}`,
          line: err.linePos?.[0]?.line,
        }
      }
      return {
        type: 'parse_error',
        path: '',
        message: `Invalid YAML in frontmatter: ${String(err)}`,
      }
    }
  }

  /**
   * Extract the markdown body (everything after the second --- delimiter).
   */
  parseBody(raw: string): string {
    const trimmed = raw.trimStart()

    if (!trimmed.startsWith('---')) {
      // No frontmatter — entire content is body
      return raw
    }

    const afterOpen = trimmed.slice(3)
    const closingNewlineIndex = afterOpen.indexOf('\n---')

    if (closingNewlineIndex === -1) {
      // No closing delimiter — return empty body
      return ''
    }

    // Body starts after the closing --- line
    const afterClosingMarker = afterOpen.slice(closingNewlineIndex + 4) // +4 for '\n---'

    // Skip optional newline immediately after the closing ---
    return afterClosingMarker.startsWith('\n') ? afterClosingMarker.slice(1) : afterClosingMarker
  }

  /**
   * Generate a summary of the body content up to maxTokens tokens,
   * cutting at a paragraph boundary where possible.
   */
  generateSummary(body: string, maxTokens: number = 500): string {
    if (body.trim() === '') return ''

    const totalTokens = this.tokenEstimator.estimate(body)
    if (totalTokens <= maxTokens) {
      return body
    }

    // Split into paragraphs and accumulate whole paragraphs until we exceed the budget
    const paragraphs = body.split(/\n\n+/)
    const accumulated: string[] = []
    let usedTokens = 0

    for (const paragraph of paragraphs) {
      const paragraphTokens = this.tokenEstimator.estimate(paragraph)
      // Stop before adding a paragraph that would exceed the budget,
      // but only if we have already accumulated at least one paragraph.
      if (accumulated.length > 0 && usedTokens + paragraphTokens > maxTokens) {
        break
      }
      // If the very first paragraph already exceeds the budget, fall through
      // to word-level truncation below.
      if (accumulated.length === 0 && paragraphTokens > maxTokens) {
        break
      }
      accumulated.push(paragraph)
      usedTokens += paragraphTokens
      if (usedTokens >= maxTokens) {
        break
      }
    }

    // No whole paragraphs fit — truncate the first paragraph at word boundary
    if (accumulated.length === 0 && paragraphs.length > 0) {
      const firstParagraph = paragraphs[0]!
      const words = firstParagraph.split(/\s+/)
      const truncated: string[] = []
      let tokens = 0
      for (const word of words) {
        const wordTokens = this.tokenEstimator.estimate(word)
        if (tokens + wordTokens > maxTokens && truncated.length > 0) break
        truncated.push(word)
        tokens += wordTokens
      }
      return truncated.join(' ')
    }

    return accumulated.join('\n\n')
  }
}
