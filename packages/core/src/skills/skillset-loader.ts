import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { SkillSet, SkillDefinition } from './types.js'

/** Spec Task 1.6 — SkillSet Loader */

const SKILLSETS_FILE = '.agent-orchestra/skillsets.yaml'
const DEFAULT_CONTEXT_BUDGET_PERCENT = 20

/** Logger interface for warnings and errors */
interface Logger {
  warn: (msg: string) => void
  error: (msg: string) => void
}

/** Raw YAML shape for a single skillset entry */
interface RawSkillSet {
  id?: unknown
  name?: unknown
  description?: unknown
  skills?: unknown
  contextBudgetPercent?: unknown
}

/** Raw YAML shape for the top-level skillsets file */
interface RawSkillSetsFile {
  skillsets?: unknown
}

/**
 * SkillSetLoader loads and resolves named skill sets from a workspace.
 * Skill sets group skills with a shared context budget and are configured
 * in `.agent-orchestra/skillsets.yaml`.
 */
export class SkillSetLoader {
  constructor(private logger?: Logger) {}

  /**
   * Load skillset configurations from workspace.
   * Looks for: .agent-orchestra/skillsets.yaml
   *
   * Returns an empty array if the file does not exist (not an error).
   * Returns an empty array with a warning if the file is invalid YAML.
   */
  async load(workspacePath: string): Promise<SkillSet[]> {
    const filePath = join(workspacePath, SKILLSETS_FILE)

    let rawContent: string
    try {
      rawContent = await readFile(filePath, 'utf-8')
    } catch (err) {
      const isNodeError = (e: unknown): e is NodeJS.ErrnoException =>
        e instanceof Error && 'code' in e
      if (isNodeError(err) && err.code === 'ENOENT') {
        // File does not exist — not an error
        return []
      }
      // Other read errors — warn and return empty
      this.logger?.warn(`Failed to read skillsets file "${filePath}": ${String(err)}`)
      return []
    }

    let parsed: RawSkillSetsFile
    try {
      parsed = parseYaml(rawContent) as RawSkillSetsFile
    } catch (err) {
      this.logger?.warn(`Invalid YAML in skillsets file "${filePath}": ${String(err)}`)
      return []
    }

    // Handle null/undefined (e.g. empty file)
    if (parsed == null || typeof parsed !== 'object') {
      this.logger?.warn(`Skillsets file "${filePath}" is empty or not a valid object`)
      return []
    }

    const rawSkillsets = (parsed as RawSkillSetsFile).skillsets

    // Missing or empty skillsets array
    if (rawSkillsets === undefined || rawSkillsets === null) {
      return []
    }

    if (!Array.isArray(rawSkillsets)) {
      this.logger?.warn(`"skillsets" in "${filePath}" must be an array`)
      return []
    }

    if (rawSkillsets.length === 0) {
      return []
    }

    const skillSets: SkillSet[] = []

    for (const raw of rawSkillsets as RawSkillSet[]) {
      const skillSet = this.parseRawSkillSet(raw, filePath)
      if (skillSet !== null) {
        skillSets.push(skillSet)
      }
    }

    return skillSets
  }

  /**
   * Resolve a skillset by ID — returns the SkillSet with validated skill references.
   * All skill IDs must exist in loaded skills; missing references are warned and removed.
   *
   * Returns null if skillset ID is not found.
   */
  resolve(
    skillSetId: string,
    skillSets: SkillSet[],
    loadedSkills: SkillDefinition[],
  ): SkillSet | null {
    const skillSet = skillSets.find((s) => s.id === skillSetId)

    if (skillSet === undefined) {
      return null
    }

    const loadedSkillIds = new Set(loadedSkills.map((s) => s.id))
    const validSkillIds: string[] = []

    for (const skillId of skillSet.skillIds) {
      if (loadedSkillIds.has(skillId)) {
        validSkillIds.push(skillId)
      } else {
        this.logger?.warn(
          `SkillSet "${skillSetId}" references skill "${skillId}" which is not loaded — ignoring`,
        )
      }
    }

    return {
      ...skillSet,
      skillIds: validSkillIds,
    }
  }

  /**
   * Warn if the combined budget of all skillsets assigned to agents in a job
   * exceeds 50% of total context. Task 1.6.4.
   */
  warnIfBudgetExcessive(assignedSkillSetIds: string[], skillSets: SkillSet[]): void {
    let totalBudget = 0
    for (const id of assignedSkillSetIds) {
      const ss = skillSets.find((s) => s.id === id)
      if (ss) {
        totalBudget += ss.contextBudgetPercent
      }
    }
    if (totalBudget > 50) {
      this.logger?.warn(
        `Aggregate skill budget across assigned skillsets is ${totalBudget}% (> 50% of context). ` +
          `This may leave insufficient context for agent instructions, findings, and round data.`,
      )
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private parseRawSkillSet(raw: RawSkillSet, filePath: string): SkillSet | null {
    // Validate required fields
    if (typeof raw.id !== 'string' || raw.id.trim() === '') {
      this.logger?.warn(`Skillset in "${filePath}" is missing a valid "id" field — skipping`)
      return null
    }

    const id = raw.id.trim()

    const name = typeof raw.name === 'string' ? raw.name : id
    const description = typeof raw.description === 'string' ? raw.description : ''

    // Parse skills array
    const skillIds: string[] = []
    if (Array.isArray(raw.skills)) {
      for (const s of raw.skills as unknown[]) {
        if (typeof s === 'string' && s.trim() !== '') {
          skillIds.push(s.trim())
        } else {
          this.logger?.warn(
            `Skillset "${id}" in "${filePath}" has an invalid skill reference: ${JSON.stringify(s)} — skipping`,
          )
        }
      }
    } else if (raw.skills !== undefined && raw.skills !== null) {
      this.logger?.warn(
        `Skillset "${id}" in "${filePath}" "skills" must be an array — using empty list`,
      )
    }

    // Validate and parse contextBudgetPercent
    let contextBudgetPercent = DEFAULT_CONTEXT_BUDGET_PERCENT
    if (raw.contextBudgetPercent !== undefined && raw.contextBudgetPercent !== null) {
      const parsed = Number(raw.contextBudgetPercent)
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
        this.logger?.warn(
          `Skillset "${id}" in "${filePath}" has invalid contextBudgetPercent: ${raw.contextBudgetPercent} — must be 0-100, using default ${DEFAULT_CONTEXT_BUDGET_PERCENT}`,
        )
      } else {
        contextBudgetPercent = parsed
      }
    }

    return {
      id,
      name,
      description,
      skillIds,
      contextBudgetPercent,
    }
  }
}
