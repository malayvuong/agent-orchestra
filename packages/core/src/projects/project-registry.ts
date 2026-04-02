/**
 * Central project registry.
 *
 * Tracks all workspaces where agent-orchestra has been initialized.
 * Stored at ~/.agent-orchestra/projects.json (user-level, not per-project).
 *
 * This enables:
 * - `ao project list` — see all managed projects
 * - Dashboard multi-project view
 * - Daemon management across workspaces
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

const GLOBAL_DIR = join(homedir(), '.agent-orchestra')
const REGISTRY_FILE = join(GLOBAL_DIR, 'projects.json')

export type ProjectStatus = 'active' | 'inactive' | 'unknown'

export type ProjectEntry = {
  /** Absolute path to the project root */
  path: string
  /** Display name (defaults to directory name) */
  name: string
  /** Project type detected at init */
  kind?: string
  /** Daemon port if configured */
  daemonPort?: number
  /** When the project was registered */
  registeredAt: number
  /** Last time any ao command ran in this project */
  lastActiveAt: number
  /** Tags for grouping/filtering */
  tags?: string[]
  /** Notes */
  notes?: string
}

export type ProjectRegistry = {
  version: 1
  projects: ProjectEntry[]
}

function emptyRegistry(): ProjectRegistry {
  return { version: 1, projects: [] }
}

export async function loadRegistry(): Promise<ProjectRegistry> {
  try {
    const raw = await readFile(REGISTRY_FILE, 'utf-8')
    return JSON.parse(raw) as ProjectRegistry
  } catch {
    return emptyRegistry()
  }
}

export async function saveRegistry(registry: ProjectRegistry): Promise<void> {
  await mkdir(GLOBAL_DIR, { recursive: true })
  await writeFile(REGISTRY_FILE, JSON.stringify(registry, null, 2) + '\n')
}

export async function registerProject(
  path: string,
  options?: {
    name?: string
    kind?: string
    daemonPort?: number
    tags?: string[]
  },
): Promise<ProjectEntry> {
  const registry = await loadRegistry()
  const existing = registry.projects.find((p) => p.path === path)

  if (existing) {
    // Update existing entry
    if (options?.name) existing.name = options.name
    if (options?.kind) existing.kind = options.kind
    if (options?.daemonPort) existing.daemonPort = options.daemonPort
    if (options?.tags) existing.tags = options.tags
    existing.lastActiveAt = Date.now()
    await saveRegistry(registry)
    return existing
  }

  // Add new entry
  const dirName = path.split('/').pop() || path
  const entry: ProjectEntry = {
    path,
    name: options?.name || dirName,
    kind: options?.kind,
    daemonPort: options?.daemonPort,
    registeredAt: Date.now(),
    lastActiveAt: Date.now(),
    tags: options?.tags,
  }
  registry.projects.push(entry)
  await saveRegistry(registry)
  return entry
}

export async function unregisterProject(path: string): Promise<boolean> {
  const registry = await loadRegistry()
  const before = registry.projects.length
  registry.projects = registry.projects.filter((p) => p.path !== path)
  if (registry.projects.length < before) {
    await saveRegistry(registry)
    return true
  }
  return false
}

export async function touchProject(path: string): Promise<void> {
  const registry = await loadRegistry()
  const entry = registry.projects.find((p) => p.path === path)
  if (entry) {
    entry.lastActiveAt = Date.now()
    await saveRegistry(registry)
  }
}

export async function getProject(path: string): Promise<ProjectEntry | undefined> {
  const registry = await loadRegistry()
  return registry.projects.find((p) => p.path === path)
}

export async function listProjects(): Promise<ProjectEntry[]> {
  const registry = await loadRegistry()
  return registry.projects.sort((a, b) => b.lastActiveAt - a.lastActiveAt)
}

export function getGlobalDir(): string {
  return GLOBAL_DIR
}
