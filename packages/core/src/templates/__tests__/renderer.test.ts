import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../renderer.js'
import type { PromptTemplate } from '../types.js'

describe('renderTemplate', () => {
  const template: PromptTemplate = {
    id: 'test-template',
    role: 'architect',
    systemPrompt: 'You are analyzing {{scope}} for {{brief}}.',
    userPromptTemplate: 'Brief: {{brief}}\nScope: {{scope}}\nSkill: {{skill_context}}',
    outputFormatInstructions: 'Output findings in markdown.',
  }

  it('should substitute all provided variables', () => {
    const result = renderTemplate(template, {
      brief: 'security review',
      scope: 'src/auth/',
      skill_context: 'TypeScript project',
    })

    expect(result.system).toBe('You are analyzing src/auth/ for security review.')
    expect(result.user).toContain('Brief: security review')
    expect(result.user).toContain('Scope: src/auth/')
    expect(result.user).toContain('Skill: TypeScript project')
    expect(result.user).toContain('Output findings in markdown.')
  })

  it('should leave unmatched placeholders as-is', () => {
    const result = renderTemplate(template, {
      brief: 'code review',
    })

    expect(result.system).toBe('You are analyzing {{scope}} for code review.')
    expect(result.user).toContain('Brief: code review')
    expect(result.user).toContain('Scope: {{scope}}')
    expect(result.user).toContain('Skill: {{skill_context}}')
  })

  it('should handle empty variables map', () => {
    const result = renderTemplate(template, {})

    expect(result.system).toBe('You are analyzing {{scope}} for {{brief}}.')
    expect(result.user).toContain('Brief: {{brief}}')
  })

  it('should combine user prompt template and output format instructions', () => {
    const result = renderTemplate(template, { brief: 'test', scope: 'all', skill_context: 'none' })

    // User prompt should contain both template content and output format
    expect(result.user).toContain('Brief: test')
    expect(result.user).toContain('Output findings in markdown.')
    // They should be separated by a double newline
    expect(result.user).toBe('Brief: test\nScope: all\nSkill: none\n\nOutput findings in markdown.')
  })

  it('should substitute variables in system prompt', () => {
    const lensTemplate: PromptTemplate = {
      id: 'lens-test',
      role: 'reviewer',
      systemPrompt: 'Focus on {{lens}} concerns.',
      userPromptTemplate: 'Review with {{lens}} lens.',
      outputFormatInstructions: 'Format as findings.',
    }

    const result = renderTemplate(lensTemplate, { lens: 'security' })
    expect(result.system).toBe('Focus on security concerns.')
    expect(result.user).toContain('Review with security lens.')
  })

  it('should not substitute partial matches like {single_brace}', () => {
    const weirdTemplate: PromptTemplate = {
      id: 'weird',
      role: 'architect',
      systemPrompt: '{single} and {{double}}',
      userPromptTemplate: '{not_this} but {{this}}',
      outputFormatInstructions: '',
    }

    const result = renderTemplate(weirdTemplate, { double: 'YES', this: 'REPLACED' })
    expect(result.system).toBe('{single} and YES')
    expect(result.user).toContain('{not_this} but REPLACED')
  })
})
