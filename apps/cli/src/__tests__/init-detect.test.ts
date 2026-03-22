import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { detectProject } from '../init/detect.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'ao-detect-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Project type detection
// ---------------------------------------------------------------------------

describe('detectProject — project type', () => {
  it('detects node-ts from package.json + tsconfig.json', async () => {
    await writeFile(join(tempDir, 'package.json'), '{}')
    await writeFile(join(tempDir, 'tsconfig.json'), '{}')

    const profile = await detectProject(tempDir)
    expect(profile.kind).toBe('node-ts')
  })

  it('detects node-ts from package.json alone', async () => {
    await writeFile(join(tempDir, 'package.json'), '{}')

    const profile = await detectProject(tempDir)
    expect(profile.kind).toBe('node-ts')
  })

  it('detects node-ts from tsconfig.json alone', async () => {
    await writeFile(join(tempDir, 'tsconfig.json'), '{}')

    const profile = await detectProject(tempDir)
    expect(profile.kind).toBe('node-ts')
  })

  it('detects python from pyproject.toml', async () => {
    await writeFile(join(tempDir, 'pyproject.toml'), '')

    const profile = await detectProject(tempDir)
    expect(profile.kind).toBe('python')
  })

  it('detects python from requirements.txt', async () => {
    await writeFile(join(tempDir, 'requirements.txt'), '')

    const profile = await detectProject(tempDir)
    expect(profile.kind).toBe('python')
  })

  it('detects rust from Cargo.toml', async () => {
    await writeFile(join(tempDir, 'Cargo.toml'), '')

    const profile = await detectProject(tempDir)
    expect(profile.kind).toBe('rust')
  })

  it('detects generic when no project markers found', async () => {
    const profile = await detectProject(tempDir)
    expect(profile.kind).toBe('generic')
  })

  it('node-ts takes priority over python when both signals exist', async () => {
    await writeFile(join(tempDir, 'package.json'), '{}')
    await writeFile(join(tempDir, 'requirements.txt'), '')

    const profile = await detectProject(tempDir)
    expect(profile.kind).toBe('node-ts')
  })
})

// ---------------------------------------------------------------------------
// Tests and docs detection
// ---------------------------------------------------------------------------

describe('detectProject — tests and docs', () => {
  it('detects tests/ directory', async () => {
    await mkdir(join(tempDir, 'tests'))

    const profile = await detectProject(tempDir)
    expect(profile.hasTests).toBe(true)
  })

  it('detects test/ directory', async () => {
    await mkdir(join(tempDir, 'test'))

    const profile = await detectProject(tempDir)
    expect(profile.hasTests).toBe(true)
  })

  it('hasTests is false when no test directory exists', async () => {
    const profile = await detectProject(tempDir)
    expect(profile.hasTests).toBe(false)
  })

  it('detects docs/ directory', async () => {
    await mkdir(join(tempDir, 'docs'))

    const profile = await detectProject(tempDir)
    expect(profile.hasDocs).toBe(true)
  })

  it('hasDocs is false when no docs directory exists', async () => {
    const profile = await detectProject(tempDir)
    expect(profile.hasDocs).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Superpower recommendations
// ---------------------------------------------------------------------------

describe('detectProject — recommendations', () => {
  it('node-ts recommends security-review, test-generation, auto-fix-lint', async () => {
    await writeFile(join(tempDir, 'package.json'), '{}')

    const profile = await detectProject(tempDir)
    expect(profile.recommendedSuperpowers).toContain('security-review')
    expect(profile.recommendedSuperpowers).toContain('test-generation')
    expect(profile.recommendedSuperpowers).toContain('auto-fix-lint')
  })

  it('python recommends security-review and test-generation', async () => {
    await writeFile(join(tempDir, 'pyproject.toml'), '')

    const profile = await detectProject(tempDir)
    expect(profile.recommendedSuperpowers).toContain('security-review')
    expect(profile.recommendedSuperpowers).toContain('test-generation')
  })

  it('rust recommends security-review and test-generation', async () => {
    await writeFile(join(tempDir, 'Cargo.toml'), '')

    const profile = await detectProject(tempDir)
    expect(profile.recommendedSuperpowers).toContain('security-review')
    expect(profile.recommendedSuperpowers).toContain('test-generation')
  })

  it('generic recommends security-review and plan-review', async () => {
    const profile = await detectProject(tempDir)
    expect(profile.recommendedSuperpowers).toContain('security-review')
    expect(profile.recommendedSuperpowers).toContain('plan-review')
  })

  it('docs-heavy repo adds plan-review to recommendations', async () => {
    await writeFile(join(tempDir, 'package.json'), '{}')
    await mkdir(join(tempDir, 'docs'))

    const profile = await detectProject(tempDir)
    expect(profile.recommendedSuperpowers).toContain('plan-review')
  })

  it('test directory adds test-generation to generic recommendations', async () => {
    await mkdir(join(tempDir, 'tests'))

    const profile = await detectProject(tempDir)
    expect(profile.recommendedSuperpowers).toContain('test-generation')
  })

  it('recommendations are not duplicated', async () => {
    await writeFile(join(tempDir, 'package.json'), '{}')
    await mkdir(join(tempDir, 'docs'))
    await mkdir(join(tempDir, 'tests'))

    const profile = await detectProject(tempDir)
    const unique = new Set(profile.recommendedSuperpowers)
    expect(unique.size).toBe(profile.recommendedSuperpowers.length)
  })
})
