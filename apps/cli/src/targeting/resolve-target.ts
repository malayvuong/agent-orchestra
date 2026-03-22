import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { dirname, relative, resolve, extname } from 'node:path'
import { extractMarkdownReferences } from './markdown-links.js'

export type ResolutionReason = 'entry' | 'directory_walk' | 'markdown_link'

export type ResolvedTarget = {
  entryTarget: string
  entryKind: 'file' | 'directory'
  workspaceRoot: string
  resolvedFiles: string[]
  discovery: Array<{
    path: string
    reason: ResolutionReason
    discoveredFrom?: string
  }>
}

type ResolveTargetOptions = {
  workspacePath: string
  targetPath: string
  maxMarkdownDepth?: number
  maxResolvedFiles?: number
  maxAggregatedBytes?: number
}

const DEFAULT_MAX_MARKDOWN_DEPTH = 5
const DEFAULT_MAX_RESOLVED_FILES = 200
const DEFAULT_MAX_AGGREGATED_BYTES = 1_000_000

export async function resolveTarget(options: ResolveTargetOptions): Promise<ResolvedTarget> {
  const workspacePath = await realpath(options.workspacePath)
  const workspaceRoot = workspacePath
  const targetPath = await realpath(resolve(workspacePath, options.targetPath))
  ensureWithinWorkspace(workspacePath, targetPath)

  const targetStats = await stat(targetPath)
  const maxMarkdownDepth = options.maxMarkdownDepth ?? DEFAULT_MAX_MARKDOWN_DEPTH
  const maxResolvedFiles = options.maxResolvedFiles ?? DEFAULT_MAX_RESOLVED_FILES
  const maxAggregatedBytes = options.maxAggregatedBytes ?? DEFAULT_MAX_AGGREGATED_BYTES

  if (targetStats.isDirectory()) {
    const files = await collectDirectoryFiles(targetPath, workspacePath)
    await enforceResolutionCaps(files, maxResolvedFiles, maxAggregatedBytes)
    return {
      entryTarget: targetPath,
      entryKind: 'directory',
      workspaceRoot,
      resolvedFiles: files,
      discovery: files.map((path) => ({ path, reason: 'directory_walk' as const })),
    }
  }

  if (!targetStats.isFile()) {
    throw new Error(`Target is neither a file nor directory: ${targetPath}`)
  }

  if (!isMarkdownFile(targetPath)) {
    await enforceResolutionCaps([targetPath], maxResolvedFiles, maxAggregatedBytes)
    return {
      entryTarget: targetPath,
      entryKind: 'file',
      workspaceRoot,
      resolvedFiles: [targetPath],
      discovery: [{ path: targetPath, reason: 'entry' }],
    }
  }

  const discovered = new Map<string, { reason: ResolutionReason; discoveredFrom?: string }>()
  const queue: Array<{ path: string; depth: number }> = [{ path: targetPath, depth: 0 }]

  discovered.set(targetPath, { reason: 'entry' })

  while (queue.length > 0) {
    const current = queue.shift()!
    if (current.depth >= maxMarkdownDepth) continue

    const markdown = await readFile(current.path, 'utf-8')
    for (const link of extractMarkdownReferences(markdown)) {
      const candidatePath = await resolveLinkedPath(workspacePath, current.path, link)
      if (!candidatePath) continue
      if (discovered.has(candidatePath)) continue
      if (await isBinaryFile(candidatePath)) continue

      discovered.set(candidatePath, {
        reason: 'markdown_link',
        discoveredFrom: current.path,
      })

      if (isMarkdownFile(candidatePath)) {
        queue.push({ path: candidatePath, depth: current.depth + 1 })
      }
    }
  }

  const resolvedFiles = [...discovered.keys()].sort((left, right) =>
    compareWorkspacePaths(
      toWorkspaceRelativePath(workspacePath, left),
      toWorkspaceRelativePath(workspacePath, right),
    ),
  )
  await enforceResolutionCaps(resolvedFiles, maxResolvedFiles, maxAggregatedBytes)

  const discovery = resolvedFiles.map((path) => ({
    path,
    reason: discovered.get(path)!.reason,
    discoveredFrom: discovered.get(path)!.discoveredFrom,
  }))

  return {
    entryTarget: targetPath,
    entryKind: 'file',
    workspaceRoot,
    resolvedFiles,
    discovery,
  }
}

export function toWorkspaceRelativePath(workspacePath: string, absolutePath: string): string {
  ensureWithinWorkspace(workspacePath, absolutePath)
  const relativePath = relative(workspacePath, absolutePath)
  return relativePath === '' ? '.' : relativePath
}

function ensureWithinWorkspace(workspacePath: string, absolutePath: string): void {
  if (absolutePath === workspacePath) return
  const relativePath = relative(workspacePath, absolutePath)
  if (relativePath.startsWith('..')) {
    throw new Error(`Resolved path escapes workspace: ${absolutePath}`)
  }
}

async function collectDirectoryFiles(
  directoryPath: string,
  workspacePath: string,
): Promise<string[]> {
  const entries = await readdir(directoryPath, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue

    const entryPath = resolve(directoryPath, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectDirectoryFiles(entryPath, workspacePath)))
      continue
    }

    if (!entry.isFile()) continue
    const canonicalPath = await realpath(entryPath)
    ensureWithinWorkspace(workspacePath, canonicalPath)
    if (await isBinaryFile(canonicalPath)) continue
    files.push(canonicalPath)
  }

  return files.sort((left, right) =>
    compareWorkspacePaths(
      toWorkspaceRelativePath(workspacePath, left),
      toWorkspaceRelativePath(workspacePath, right),
    ),
  )
}

async function resolveLinkedPath(
  workspacePath: string,
  sourcePath: string,
  linkTarget: string,
): Promise<string | null> {
  const candidate = linkTarget.startsWith('/')
    ? resolve(workspacePath, `.${linkTarget}`)
    : resolve(dirname(sourcePath), linkTarget)

  try {
    const canonical = await realpath(candidate)
    ensureWithinWorkspace(workspacePath, canonical)
    const info = await stat(canonical)
    if (!info.isFile()) return null
    return canonical
  } catch {
    return null
  }
}

async function enforceResolutionCaps(
  files: string[],
  maxResolvedFiles: number,
  maxAggregatedBytes: number,
): Promise<void> {
  if (files.length > maxResolvedFiles) {
    throw new Error(`Resolved scope exceeds file cap (${files.length}/${maxResolvedFiles})`)
  }

  let totalBytes = 0
  for (const file of files) {
    const info = await stat(file)
    totalBytes += info.size
    if (totalBytes > maxAggregatedBytes) {
      throw new Error(
        `Resolved scope exceeds aggregated byte cap (${totalBytes}/${maxAggregatedBytes})`,
      )
    }
  }
}

async function isBinaryFile(filePath: string): Promise<boolean> {
  const extension = extname(filePath).toLowerCase()
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf', '.zip'].includes(extension)) {
    return true
  }

  const buffer = await readFile(filePath)
  return buffer.includes(0)
}

function isMarkdownFile(filePath: string): boolean {
  const extension = extname(filePath).toLowerCase()
  return extension === '.md' || extension === '.markdown'
}

function compareWorkspacePaths(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}
