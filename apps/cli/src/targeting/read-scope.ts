import { readFile, realpath } from 'node:fs/promises'
import type { ResolvedTarget } from './resolve-target.js'
import { toWorkspaceRelativePath } from './resolve-target.js'

type ReadScopeOptions = {
  workspacePath: string
  resolvedTarget: ResolvedTarget
}

export async function readScope(options: ReadScopeOptions): Promise<{
  content: string
  files: string[]
}> {
  const workspacePath = await realpath(options.workspacePath)
  const parts: string[] = []

  for (const filePath of options.resolvedTarget.resolvedFiles) {
    const content = await readFile(filePath, 'utf-8')
    const relativePath = toWorkspaceRelativePath(workspacePath, filePath)
    parts.push(`--- ${relativePath} ---\n${content}`)
  }

  return {
    content: parts.join('\n\n'),
    files: [...options.resolvedTarget.resolvedFiles],
  }
}
