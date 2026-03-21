import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Checksum } from './types.js'

/**
 * Compute a SHA-256 checksum for an entire skill directory.
 * Hashes all file contents in sorted order for deterministic results.
 */
export async function computeDirectoryChecksum(dirPath: string): Promise<Checksum> {
  const hash = createHash('sha256')
  const files = await collectFiles(dirPath)

  // Sort for deterministic ordering
  files.sort()

  for (const file of files) {
    // Include relative path in hash so renames are detected
    const relativePath = file.slice(dirPath.length)
    hash.update(relativePath)

    const content = await readFile(file)
    hash.update(content)
  }

  return {
    algorithm: 'sha256',
    digest: hash.digest('hex'),
  }
}

/**
 * Recursively collect all file paths in a directory.
 */
async function collectFiles(dirPath: string): Promise<string[]> {
  const results: string[] = []
  const entries = await readdir(dirPath)

  for (const entry of entries) {
    const fullPath = join(dirPath, entry)
    const entryStat = await stat(fullPath)

    if (entryStat.isDirectory()) {
      const nested = await collectFiles(fullPath)
      results.push(...nested)
    } else if (entryStat.isFile()) {
      results.push(fullPath)
    }
  }

  return results
}
