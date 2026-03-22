import { describe, it, expect } from 'vitest'
import { loadSuperpowerCatalog } from '../catalog.js'

// ---------------------------------------------------------------------------
// loadSuperpowerCatalog() — factory function
// ---------------------------------------------------------------------------

const BUILT_IN_IDS = [
  'security-review',
  'dependency-audit',
  'test-generation',
  'auto-fix-lint',
  'plan-review',
]

describe('loadSuperpowerCatalog()', () => {
  it('returns a SuperpowerCatalog instance', () => {
    const catalog = loadSuperpowerCatalog()
    expect(catalog).toBeDefined()
    expect(typeof catalog.list).toBe('function')
    expect(typeof catalog.get).toBe('function')
    expect(typeof catalog.has).toBe('function')
  })

  it('catalog contains all 5 built-in superpowers', () => {
    const catalog = loadSuperpowerCatalog()
    const items = catalog.list()
    expect(items).toHaveLength(5)

    const ids = items.map((s) => s.id)
    for (const id of BUILT_IN_IDS) {
      expect(ids).toContain(id)
    }
  })

  it('catalog.get works for security-review', () => {
    const catalog = loadSuperpowerCatalog()
    const sp = catalog.get('security-review')
    expect(sp).toBeDefined()
    expect(sp!.id).toBe('security-review')
    expect(sp!.name).toBeTruthy()
  })

  it('catalog.get works for dependency-audit', () => {
    const catalog = loadSuperpowerCatalog()
    const sp = catalog.get('dependency-audit')
    expect(sp).toBeDefined()
    expect(sp!.id).toBe('dependency-audit')
  })

  it('catalog.get works for test-generation', () => {
    const catalog = loadSuperpowerCatalog()
    const sp = catalog.get('test-generation')
    expect(sp).toBeDefined()
    expect(sp!.id).toBe('test-generation')
  })

  it('catalog.get works for auto-fix-lint', () => {
    const catalog = loadSuperpowerCatalog()
    const sp = catalog.get('auto-fix-lint')
    expect(sp).toBeDefined()
    expect(sp!.id).toBe('auto-fix-lint')
  })

  it('each call to loadSuperpowerCatalog returns an independent catalog', () => {
    const catalog1 = loadSuperpowerCatalog()
    const catalog2 = loadSuperpowerCatalog()

    // Both should have the same contents
    expect(catalog1.list().length).toBe(catalog2.list().length)

    // But they are separate instances (mutating one should not affect the other)
    expect(catalog1).not.toBe(catalog2)
  })
})

// ---------------------------------------------------------------------------
// Catalog contract — methods exist and have correct signatures
// ---------------------------------------------------------------------------

describe('SuperpowerCatalog — method contract', () => {
  it('list() returns an array', () => {
    const catalog = loadSuperpowerCatalog()
    const items = catalog.list()
    expect(Array.isArray(items)).toBe(true)
  })

  it('get() accepts a string and returns Superpower | undefined', () => {
    const catalog = loadSuperpowerCatalog()
    // Valid ID returns a Superpower
    const found = catalog.get('security-review')
    expect(found).toBeDefined()
    expect(typeof found!.id).toBe('string')

    // Invalid ID returns undefined
    const notFound = catalog.get('does-not-exist')
    expect(notFound).toBeUndefined()
  })

  it('has() accepts a string and returns a boolean', () => {
    const catalog = loadSuperpowerCatalog()
    expect(typeof catalog.has('security-review')).toBe('boolean')
    expect(typeof catalog.has('nonexistent')).toBe('boolean')
  })
})
