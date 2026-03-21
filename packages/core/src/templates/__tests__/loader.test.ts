import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { TemplateLoader } from '../loader.js'
import type { PromptTemplate } from '../types.js'

describe('TemplateLoader', () => {
  let loader: TemplateLoader

  beforeEach(() => {
    loader = new TemplateLoader()
  })

  it('should load 4 default templates', () => {
    const defaults = loader.loadDefaults()
    expect(defaults).toHaveLength(4)

    const ids = defaults.map((t) => t.id).sort()
    expect(ids).toEqual([
      'architect-analysis',
      'architect-rebuttal',
      'reviewer-by-lens',
      'synthesis',
    ])
  })

  it('should get a default template by ID', () => {
    const template = loader.get('architect-analysis')
    expect(template).toBeDefined()
    expect(template!.id).toBe('architect-analysis')
    expect(template!.role).toBe('architect')
  })

  it('should return undefined for non-existent template ID', () => {
    const template = loader.get('does-not-exist')
    expect(template).toBeUndefined()
  })

  it('should have system prompts on all default templates', () => {
    const defaults = loader.loadDefaults()
    for (const template of defaults) {
      expect(template.systemPrompt.length).toBeGreaterThan(0)
      expect(template.userPromptTemplate.length).toBeGreaterThan(0)
      expect(template.outputFormatInstructions.length).toBeGreaterThan(0)
    }
  })

  it('should list all loaded template IDs', () => {
    const ids = loader.listIds()
    expect(ids).toContain('architect-analysis')
    expect(ids).toContain('reviewer-by-lens')
    expect(ids).toContain('architect-rebuttal')
    expect(ids).toContain('synthesis')
  })

  describe('loadFromDisk', () => {
    let configDir: string

    beforeEach(async () => {
      configDir = await mkdtemp(join(tmpdir(), 'ao-test-templates-'))
    })

    afterEach(async () => {
      await rm(configDir, { recursive: true, force: true })
    })

    it('should load custom templates from disk', async () => {
      const promptsDir = join(configDir, 'prompts')
      await mkdir(promptsDir, { recursive: true })

      const customTemplate: PromptTemplate = {
        id: 'custom-template',
        role: 'reviewer',
        systemPrompt: 'Custom system prompt.',
        userPromptTemplate: 'Custom user prompt with {{brief}}.',
        outputFormatInstructions: 'Custom format.',
      }

      await writeFile(
        join(promptsDir, 'custom-template.json'),
        JSON.stringify(customTemplate),
        'utf-8',
      )

      const loaded = await loader.loadFromDisk(configDir)
      expect(loaded).toHaveLength(1)
      expect(loaded[0].id).toBe('custom-template')

      // Should be accessible via get()
      const retrieved = loader.get('custom-template')
      expect(retrieved).toBeDefined()
      expect(retrieved!.systemPrompt).toBe('Custom system prompt.')
    })

    it('should override defaults when custom template has the same ID', async () => {
      const promptsDir = join(configDir, 'prompts')
      await mkdir(promptsDir, { recursive: true })

      const override: PromptTemplate = {
        id: 'architect-analysis',
        role: 'architect',
        systemPrompt: 'Overridden system prompt.',
        userPromptTemplate: 'Overridden user prompt.',
        outputFormatInstructions: 'Overridden format.',
      }

      await writeFile(
        join(promptsDir, 'architect-analysis.json'),
        JSON.stringify(override),
        'utf-8',
      )

      await loader.loadFromDisk(configDir)

      const template = loader.get('architect-analysis')
      expect(template!.systemPrompt).toBe('Overridden system prompt.')
    })

    it('should return empty array when config directory does not exist', async () => {
      const loaded = await loader.loadFromDisk('/non/existent/path')
      expect(loaded).toEqual([])
    })
  })
})
