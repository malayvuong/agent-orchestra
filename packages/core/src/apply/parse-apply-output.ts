import { resolve } from 'node:path'

export type FileBlock = {
  relativePath: string
  absolutePath: string
  content: string
}

export type ParseApplyResult = {
  fileBlocks: FileBlock[]
  skippedFiles: Array<{ path: string; reason: string }>
  errors: string[]
}

/**
 * Parse the architect's multi-file apply output into validated file blocks.
 */
export function parseApplyOutput(
  rawText: string,
  scopeFiles: string[],
  workspaceRoot: string,
): ParseApplyResult {
  const fileBlocks: FileBlock[] = []
  const skippedFiles: Array<{ path: string; reason: string }> = []
  const errors: string[] = []
  const seenPaths = new Set<string>()
  const scopeSet = new Set(scopeFiles.map((file) => resolve(file)))

  const blockPattern = /^=== FILE: (.+?) ===$\n([\s\S]*?)^=== END FILE ===$\n?/gm
  let match: RegExpExecArray | null
  let foundAny = false

  while ((match = blockPattern.exec(rawText)) !== null) {
    foundAny = true
    const relativePath = match[1].trim()
    const content = match[2].replace(/\n$/, '')
    const absolutePath = resolve(workspaceRoot, relativePath)

    if (seenPaths.has(absolutePath)) {
      skippedFiles.push({ path: relativePath, reason: 'duplicate file block' })
      continue
    }
    seenPaths.add(absolutePath)

    if (!scopeSet.has(absolutePath)) {
      skippedFiles.push({ path: relativePath, reason: 'out of scope' })
      continue
    }

    fileBlocks.push({
      relativePath,
      absolutePath,
      content,
    })
  }

  if (!foundAny) {
    errors.push(
      'Apply output contains no valid file blocks — expected === FILE: <path> === ... === END FILE === framing',
    )
  }

  return { fileBlocks, skippedFiles, errors }
}
