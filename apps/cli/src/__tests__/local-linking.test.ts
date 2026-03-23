import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = new URL('../../../../', import.meta.url)
const cliPackagePath = new URL('../../package.json', import.meta.url)
const rootPackagePath = new URL('../../../../package.json', import.meta.url)

async function readJson<T>(url: URL): Promise<T> {
  const raw = await readFile(url, 'utf8')
  return JSON.parse(raw) as T
}

describe('local CLI linking surface', () => {
  it('exposes both agent-orchestra and ao bins from the CLI package', async () => {
    const pkg = await readJson<{
      bin?: Record<string, string>
    }>(cliPackagePath)

    expect(pkg.bin).toEqual({
      'agent-orchestra': './dist/index.js',
      ao: './dist/index.js',
    })
  })

  it('provides root scripts to link and unlink the local ao command globally', async () => {
    const pkg = await readJson<{
      scripts?: Record<string, string>
    }>(rootPackagePath)

    expect(pkg.scripts?.['link:ao']).toBe(
      'pnpm --dir apps/cli run build && node scripts/link-local-cli.mjs',
    )
    expect(pkg.scripts?.['unlink:ao']).toBe('node scripts/unlink-local-cli.mjs')
  })

  it('documents the local-link workflow in the root README', async () => {
    const readmePath = join(repoRoot.pathname, 'README.md')
    const readme = await readFile(readmePath, 'utf8')

    expect(readme).toContain('npm install -g @malayvuong/agent-orchestra')
    expect(readme).toContain('pnpm link:ao')
    expect(readme).toContain('npm global bin')
    expect(readme).toContain('ao --help')
  })
})
