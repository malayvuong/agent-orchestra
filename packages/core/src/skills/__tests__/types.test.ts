import { describe, it, expect } from 'vitest'
import type {
  SkillType,
  SkillSource,
  SkillTrigger,
  SkillDefinition,
  SkillSet,
  SkillLoadResult,
  SkillMatchResult,
  SkillParseError,
} from '../types.js'

describe('Skill types', () => {
  it('should allow valid SkillType values', () => {
    const t1: SkillType = 'prompt'
    const t2: SkillType = 'tool'
    const t3: SkillType = 'plugin'
    expect(t1).toBe('prompt')
    expect(t2).toBe('tool')
    expect(t3).toBe('plugin')
  })

  it('should allow local SkillSource', () => {
    const source: SkillSource = { type: 'local', path: '/skills/owasp.md' }
    expect(source.type).toBe('local')
  })

  it('should allow registry SkillSource', () => {
    const source: SkillSource = {
      type: 'registry',
      registryUrl: 'https://skills.example.com',
      name: 'owasp-top10',
    }
    expect(source.type).toBe('registry')
  })

  it('should allow git SkillSource', () => {
    const source: SkillSource = {
      type: 'git',
      repoUrl: 'https://github.com/example/skills',
      ref: 'main',
      path: 'skills/owasp.md',
    }
    expect(source.type).toBe('git')
  })

  it('should allow valid SkillTrigger with all optional fields', () => {
    const trigger: SkillTrigger = {
      keywords: ['owasp', 'injection'],
      lenses: ['security', 'logic'],
      roles: ['reviewer'],
      lifecycle: ['pre_round', 'post_synthesis'],
    }
    expect(trigger.keywords).toHaveLength(2)
    expect(trigger.lenses).toContain('security')
  })

  it('should allow empty SkillTrigger', () => {
    const trigger: SkillTrigger = {}
    expect(trigger.keywords).toBeUndefined()
  })

  it('should allow valid SkillDefinition', () => {
    const skill: SkillDefinition = {
      id: 'skill-owasp-top10',
      version: '1.0.0',
      name: 'OWASP Top 10',
      description: 'OWASP Top 10 security review guidelines',
      skillType: 'prompt',
      source: { type: 'local', path: '/skills/owasp.md' },
      promptContent: '# OWASP Top 10\nCheck for injection vulnerabilities...',
      promptSummary: 'OWASP Top 10 security checklist',
    }
    expect(skill.id).toBe('skill-owasp-top10')
    expect(skill.skillType).toBe('prompt')
  })

  it('should allow SkillDefinition with optional fields', () => {
    const skill: SkillDefinition = {
      id: 'skill-owasp-top10',
      version: '1.0.0',
      name: 'OWASP Top 10',
      description: 'OWASP Top 10 security review guidelines',
      skillType: 'prompt',
      source: { type: 'local', path: '/skills/owasp.md' },
      license: 'MIT',
      compatibility: {
        agentOrchestra: '>=1.0.0',
        platforms: ['darwin', 'linux'],
      },
      triggers: {
        keywords: ['owasp'],
        lenses: ['security'],
      },
      promptContent: '# OWASP Top 10\n...',
      promptSummary: 'OWASP Top 10 security checklist',
    }
    expect(skill.license).toBe('MIT')
    expect(skill.compatibility?.platforms).toContain('darwin')
    expect(skill.triggers?.lenses).toContain('security')
  })

  it('should allow valid SkillSet', () => {
    const skillSet: SkillSet = {
      id: 'skillset-security',
      name: 'Security Review',
      description: 'Security-focused skill set',
      skillIds: ['skill-owasp-top10', 'skill-auth-patterns'],
      contextBudgetPercent: 20,
    }
    expect(skillSet.id).toBe('skillset-security')
    expect(skillSet.contextBudgetPercent).toBe(20)
    expect(skillSet.skillIds).toHaveLength(2)
  })

  it('should allow valid SkillLoadResult', () => {
    const result: SkillLoadResult = {
      skills: [],
      errors: [{ path: '/bad/skill.md', error: 'Missing required field: id' }],
    }
    expect(result.skills).toHaveLength(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].path).toBe('/bad/skill.md')
  })

  it('should allow valid SkillMatchResult', () => {
    const skill: SkillDefinition = {
      id: 'skill-owasp-top10',
      version: '1.0.0',
      name: 'OWASP Top 10',
      description: 'OWASP Top 10 security review guidelines',
      skillType: 'prompt',
      source: { type: 'local', path: '/skills/owasp.md' },
      promptContent: '...',
      promptSummary: 'OWASP Top 10',
    }
    const reason = new Map<string, string>([['skill-owasp-top10', 'lens:security']])
    const result: SkillMatchResult = {
      matched: [skill],
      reason,
    }
    expect(result.matched).toHaveLength(1)
    expect(result.reason.get('skill-owasp-top10')).toBe('lens:security')
  })

  it('should allow valid SkillParseError', () => {
    const err: SkillParseError = {
      type: 'parse_error',
      path: '/skills/bad.md',
      message: 'Missing frontmatter',
      line: 1,
    }
    expect(err.type).toBe('parse_error')
    expect(err.line).toBe(1)
  })

  it('should allow SkillParseError without optional line field', () => {
    const err: SkillParseError = {
      type: 'parse_error',
      path: '/skills/bad.md',
      message: 'Invalid YAML',
    }
    expect(err.line).toBeUndefined()
  })
})
