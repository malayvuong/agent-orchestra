import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { BaselineSnapshotRecord } from '@agent-orchestra/core'
import type { ResolvedTarget } from './resolve-target.js'
import { toWorkspaceRelativePath } from './resolve-target.js'

export async function buildBaselineSnapshot(
  workspacePath: string,
  resolvedTarget: ResolvedTarget,
): Promise<BaselineSnapshotRecord> {
  const files = await Promise.all(
    resolvedTarget.resolvedFiles.map(async (filePath) => {
      const content = await readFile(filePath, 'utf-8')
      const relativePath = toWorkspaceRelativePath(workspacePath, filePath)
      return {
        path: filePath,
        relativePath,
        content,
        sha256: sha256(content),
      }
    }),
  )

  const fingerprint = sha256(files.map((file) => `${file.relativePath}:${file.sha256}`).join('\n'))

  return {
    fingerprint,
    capturedAt: new Date().toISOString(),
    files,
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
