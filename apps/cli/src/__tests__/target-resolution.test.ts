import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readScope } from '../targeting/read-scope.js'
import { resolveTarget } from '../targeting/resolve-target.js'

let workspacePath: string

async function writeWorkspaceFile(relativePath: string, content: string): Promise<string> {
  const absolutePath = join(workspacePath, relativePath)
  await mkdir(join(absolutePath, '..'), { recursive: true })
  await writeFile(absolutePath, content, 'utf-8')
  return realpath(absolutePath)
}

beforeEach(async () => {
  workspacePath = await mkdtemp(join(tmpdir(), 'ao-targeting-'))
  workspacePath = await realpath(workspacePath)
})

afterEach(async () => {
  await rm(workspacePath, { recursive: true, force: true })
})

describe('resolveTarget', () => {
  it('recursively includes nested files for directory targets', async () => {
    const rootFile = await writeWorkspaceFile('src/index.ts', 'export const root = true\n')
    const nestedFile = await writeWorkspaceFile('src/lib/util.ts', 'export const nested = true\n')

    const resolved = await resolveTarget({
      workspacePath,
      targetPath: join(workspacePath, 'src'),
    })

    expect(resolved.entryKind).toBe('directory')
    expect(resolved.entryTarget).toBe(join(workspacePath, 'src'))
    expect(resolved.resolvedFiles).toEqual([rootFile, nestedFile])
    expect(resolved.discovery).toEqual([
      { path: rootFile, reason: 'directory_walk' },
      { path: nestedFile, reason: 'directory_walk' },
    ])
  })

  it('expands repo-local Markdown links recursively and deduplicates cycles', async () => {
    const readme = await writeWorkspaceFile(
      'README.md',
      ['# Plan', '', '- [Spec](docs/spec.md)'].join('\n'),
    )
    const spec = await writeWorkspaceFile(
      'docs/spec.md',
      ['# Spec', '', '- [Nested](docs/nested.md)', '- [Back](../README.md)'].join('\n'),
    )
    const nested = await writeWorkspaceFile('docs/docs/nested.md', '# Nested\n')

    const resolved = await resolveTarget({
      workspacePath,
      targetPath: readme,
    })

    expect(resolved.entryKind).toBe('file')
    expect(resolved.resolvedFiles).toEqual([readme, nested, spec])
    expect(resolved.discovery).toEqual([
      { path: readme, reason: 'entry' },
      { path: nested, reason: 'markdown_link', discoveredFrom: spec },
      { path: spec, reason: 'markdown_link', discoveredFrom: readme },
    ])
  })

  it('ignores external and missing Markdown links while keeping the readable subset', async () => {
    const readme = await writeWorkspaceFile(
      'README.md',
      [
        '# Hub',
        '',
        '- [Doc](docs/spec.md)',
        '- [Missing](docs/missing.md)',
        '- [External](https://example.com/spec.md)',
      ].join('\n'),
    )
    const spec = await writeWorkspaceFile('docs/spec.md', '# Spec\n')

    const resolved = await resolveTarget({
      workspacePath,
      targetPath: readme,
    })

    expect(resolved.resolvedFiles).toEqual([readme, spec])
    expect(resolved.discovery).toEqual([
      { path: readme, reason: 'entry' },
      { path: spec, reason: 'markdown_link', discoveredFrom: readme },
    ])
  })

  it('expands repo-local plain-text file paths mentioned in Markdown prose and code fences', async () => {
    const readme = await writeWorkspaceFile(
      'README.md',
      [
        '# Plan',
        '',
        'Implementation notes live in docs/spec.md and docs/tasks/checklist.md.',
        '',
        '```text',
        'See docs/appendix.md for follow-up.',
        '```',
      ].join('\n'),
    )
    const spec = await writeWorkspaceFile('docs/spec.md', '# Spec\n')
    const checklist = await writeWorkspaceFile('docs/tasks/checklist.md', '# Checklist\n')
    const appendix = await writeWorkspaceFile('docs/appendix.md', '# Appendix\n')

    const resolved = await resolveTarget({
      workspacePath,
      targetPath: readme,
    })

    expect(resolved.resolvedFiles).toEqual([readme, appendix, spec, checklist])
    expect(resolved.discovery).toEqual([
      { path: readme, reason: 'entry' },
      { path: appendix, reason: 'markdown_link', discoveredFrom: readme },
      { path: spec, reason: 'markdown_link', discoveredFrom: readme },
      { path: checklist, reason: 'markdown_link', discoveredFrom: readme },
    ])
  })
})

describe('readScope', () => {
  it('renders workspace-relative file boundaries while preserving resolved absolute files', async () => {
    const rootFile = await writeWorkspaceFile('src/index.ts', 'export const answer = 42\n')
    const nestedFile = await writeWorkspaceFile('src/lib/util.ts', 'export const util = true\n')

    const resolved = await resolveTarget({
      workspacePath,
      targetPath: join(workspacePath, 'src'),
    })

    const scope = await readScope({
      workspacePath,
      resolvedTarget: resolved,
    })

    expect(resolved.resolvedFiles).toEqual([rootFile, nestedFile])
    expect(scope.files).toEqual([rootFile, nestedFile])
    expect(scope.content).toContain('--- src/index.ts ---')
    expect(scope.content).toContain('--- src/lib/util.ts ---')
    expect(scope.content).not.toContain(workspacePath)
  })
})
