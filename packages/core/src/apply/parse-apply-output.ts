import { resolve } from 'node:path'

export type PatchOperation = {
  type: 'replace' | 'delete' | 'insert_after' | 'insert_before'
  target: string
  replacement?: string
}

export type FilePatch = {
  relativePath: string
  absolutePath: string
  operations: PatchOperation[]
}

export type ParseApplyResult = {
  filePatches: FilePatch[]
  skippedFiles: Array<{ path: string; reason: string }>
  errors: string[]
}

/**
 * Parse the architect's patch output into validated file patches.
 */
export function parseApplyOutput(
  rawText: string,
  scopeFiles: string[],
  workspaceRoot: string,
): ParseApplyResult {
  const filePatches: FilePatch[] = []
  const skippedFiles: Array<{ path: string; reason: string }> = []
  const errors: string[] = []
  const seenPaths = new Set<string>()
  const scopeSet = new Set(scopeFiles.map((file) => resolve(file)))

  const blockPattern = /^=== PATCH: (.+?) ===$\n([\s\S]*?)^=== END PATCH ===$\n?/gm
  let match: RegExpExecArray | null
  let foundAny = false

  while ((match = blockPattern.exec(rawText)) !== null) {
    foundAny = true
    const relativePath = match[1].trim()
    const operationsText = match[2].replace(/\n$/, '')
    const absolutePath = resolve(workspaceRoot, relativePath)

    if (seenPaths.has(absolutePath)) {
      skippedFiles.push({ path: relativePath, reason: 'duplicate patch block' })
      continue
    }
    seenPaths.add(absolutePath)

    if (!scopeSet.has(absolutePath)) {
      skippedFiles.push({ path: relativePath, reason: 'out of scope' })
      continue
    }

    const operations = parsePatchOperations(operationsText)
    if (operations.errors.length > 0) {
      errors.push(...operations.errors.map((error) => `${relativePath}: ${error}`))
      continue
    }

    if (operations.operations.length === 0) {
      errors.push(`${relativePath}: patch block contains no valid operations`)
      continue
    }

    filePatches.push({
      relativePath,
      absolutePath,
      operations: operations.operations,
    })
  }

  if (!foundAny) {
    errors.push(
      'Apply output contains no valid patch blocks — expected === PATCH: <path> === ... === END PATCH === framing',
    )
  }

  return { filePatches, skippedFiles, errors }
}

function parsePatchOperations(blockText: string): {
  operations: PatchOperation[]
  errors: string[]
} {
  const operations: PatchOperation[] = []
  const errors: string[] = []
  const lines = blockText.split('\n')
  let index = 0

  while (index < lines.length) {
    while (index < lines.length && lines[index] === '') {
      index++
    }

    if (index >= lines.length) {
      break
    }

    const header = lines[index]
    if (!header.startsWith('@@ ')) {
      errors.push(`unexpected line "${header}"`)
      break
    }

    const opType = header.slice(3).trim()
    index++

    const targetLines: string[] = []
    while (index < lines.length && lines[index] !== '@@ WITH' && lines[index] !== '@@ END') {
      targetLines.push(lines[index])
      index++
    }

    if (targetLines.length === 0) {
      errors.push(`operation ${opType} is missing a target section`)
      break
    }

    const target = targetLines.join('\n')

    if (opType === 'DELETE') {
      if (lines[index] !== '@@ END') {
        errors.push('DELETE operations must end with @@ END')
        break
      }
      operations.push({
        type: 'delete',
        target,
      })
      index++
      continue
    }

    if (!['REPLACE', 'INSERT AFTER', 'INSERT BEFORE'].includes(opType)) {
      errors.push(`unsupported operation ${opType}`)
      break
    }

    if (lines[index] !== '@@ WITH') {
      errors.push(`${opType} operations must include an @@ WITH section`)
      break
    }
    index++

    const replacementLines: string[] = []
    while (index < lines.length && lines[index] !== '@@ END') {
      replacementLines.push(lines[index])
      index++
    }

    if (lines[index] !== '@@ END') {
      errors.push(`${opType} operations must end with @@ END`)
      break
    }

    operations.push({
      type:
        opType === 'REPLACE'
          ? 'replace'
          : opType === 'INSERT AFTER'
            ? 'insert_after'
            : 'insert_before',
      target,
      replacement: replacementLines.join('\n'),
    })
    index++
  }

  return { operations, errors }
}
