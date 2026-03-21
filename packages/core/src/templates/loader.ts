import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PromptTemplate } from './types.js'
import { architectAnalysisTemplate } from './defaults/architect-analysis.js'
import { reviewerByLensTemplate } from './defaults/reviewer-by-lens.js'
import { architectRebuttalTemplate } from './defaults/architect-rebuttal.js'
import { synthesisTemplate } from './defaults/synthesis.js'

/** All built-in default templates. */
const DEFAULT_TEMPLATES: PromptTemplate[] = [
  architectAnalysisTemplate,
  reviewerByLensTemplate,
  architectRebuttalTemplate,
  synthesisTemplate,
]

/**
 * Loads and manages prompt templates.
 * Supports built-in defaults and custom templates from disk.
 */
export class TemplateLoader {
  private readonly templates = new Map<string, PromptTemplate>()

  constructor() {
    // Pre-load built-in defaults
    for (const template of DEFAULT_TEMPLATES) {
      this.templates.set(template.id, template)
    }
  }

  /** Return the 4 built-in default templates. */
  loadDefaults(): PromptTemplate[] {
    return [...DEFAULT_TEMPLATES]
  }

  /**
   * Load custom templates from a config directory on disk.
   * Reads JSON files from: {configDir}/prompts/
   * Custom templates override defaults with the same ID.
   */
  async loadFromDisk(configDir: string): Promise<PromptTemplate[]> {
    const promptsDir = join(configDir, 'prompts')
    const loaded: PromptTemplate[] = []

    try {
      const entries = await readdir(promptsDir)

      for (const entry of entries) {
        if (entry.endsWith('.json')) {
          const filePath = join(promptsDir, entry)
          const raw = await readFile(filePath, 'utf-8')
          const template = JSON.parse(raw) as PromptTemplate
          this.templates.set(template.id, template)
          loaded.push(template)
        }
      }
    } catch {
      // Config directory or prompts subdirectory does not exist — ignore
    }

    return loaded
  }

  /** Get a template by ID. Returns undefined if not found. */
  get(templateId: string): PromptTemplate | undefined {
    return this.templates.get(templateId)
  }

  /** List all loaded template IDs. */
  listIds(): string[] {
    return [...this.templates.keys()]
  }
}
