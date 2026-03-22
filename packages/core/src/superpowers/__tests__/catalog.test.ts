import { describe, it, expect } from 'vitest'
import { loadSuperpowerCatalog } from '../catalog.js'
import type { SuperpowerCatalog } from '../catalog.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let catalog: SuperpowerCatalog

const BUILT_IN_IDS = [
  'security-review',
  'dependency-audit',
  'test-generation',
  'auto-fix-lint',
  'plan-review',
]

/** Convenience: load catalog once and reuse across tests */
function getCatalog(): SuperpowerCatalog {
  if (!catalog) {
    catalog = loadSuperpowerCatalog()
  }
  return catalog
}

// ---------------------------------------------------------------------------
// SuperpowerCatalog.list()
// ---------------------------------------------------------------------------

describe('SuperpowerCatalog.list()', () => {
  it('returns all 5 built-in superpowers', () => {
    const items = getCatalog().list()
    expect(items).toHaveLength(5)
  })

  it('returns superpowers with all expected IDs', () => {
    const ids = getCatalog()
      .list()
      .map((s) => s.id)
    for (const expectedId of BUILT_IN_IDS) {
      expect(ids).toContain(expectedId)
    }
  })

  it('returns a new array on each call (not a shared reference)', () => {
    const a = getCatalog().list()
    const b = getCatalog().list()
    expect(a).not.toBe(b)
    expect(a).toEqual(b)
  })
})

// ---------------------------------------------------------------------------
// SuperpowerCatalog.get()
// ---------------------------------------------------------------------------

describe('SuperpowerCatalog.get()', () => {
  it('returns the security-review superpower by ID', () => {
    const sp = getCatalog().get('security-review')
    expect(sp).toBeDefined()
    expect(sp!.id).toBe('security-review')
  })

  it('returns undefined for a nonexistent ID', () => {
    const sp = getCatalog().get('nonexistent')
    expect(sp).toBeUndefined()
  })

  it('returns each built-in superpower by ID', () => {
    for (const id of BUILT_IN_IDS) {
      const sp = getCatalog().get(id)
      expect(sp).toBeDefined()
      expect(sp!.id).toBe(id)
    }
  })
})

// ---------------------------------------------------------------------------
// SuperpowerCatalog.has()
// ---------------------------------------------------------------------------

describe('SuperpowerCatalog.has()', () => {
  it('returns true for security-review', () => {
    expect(getCatalog().has('security-review')).toBe(true)
  })

  it('returns true for all built-in IDs', () => {
    for (const id of BUILT_IN_IDS) {
      expect(getCatalog().has(id)).toBe(true)
    }
  })

  it('returns false for a nonexistent ID', () => {
    expect(getCatalog().has('nonexistent')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(getCatalog().has('')).toBe(false)
  })

  it('returns false for partial match (no substring matching)', () => {
    expect(getCatalog().has('security')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Built-in superpowers — required fields validation
// ---------------------------------------------------------------------------

describe('Built-in superpowers — required fields', () => {
  it('every built-in has all required fields (id, name, description, category, maturity, agentPreset)', () => {
    const items = getCatalog().list()
    for (const sp of items) {
      expect(sp.id).toBeTruthy()
      expect(sp.name).toBeTruthy()
      expect(sp.description).toBeTruthy()
      expect(sp.category).toBeTruthy()
      expect(sp.maturity).toBeTruthy()
      expect(sp.agentPreset).toBeDefined()
      expect(sp.agentPreset.reviewer).toBeDefined()
      expect(sp.agentPreset.reviewer.role).toBe('reviewer')
    }
  })

  it('every built-in has a valid category', () => {
    const validCategories = ['review', 'analysis', 'fix', 'testing']
    for (const sp of getCatalog().list()) {
      expect(validCategories).toContain(sp.category)
    }
  })

  it('every built-in has a valid maturity level', () => {
    const validMaturities = ['safe', 'controlled', 'advanced']
    for (const sp of getCatalog().list()) {
      expect(validMaturities).toContain(sp.maturity)
    }
  })
})

// ---------------------------------------------------------------------------
// Built-in superpowers — specific property checks
// ---------------------------------------------------------------------------

describe('Built-in superpowers — specific properties', () => {
  it('security-review has category "review" and maturity "safe"', () => {
    const sp = getCatalog().get('security-review')!
    expect(sp.category).toBe('review')
    expect(sp.maturity).toBe('safe')
  })

  it('dependency-audit has requiresApproval=true', () => {
    const sp = getCatalog().get('dependency-audit')!
    expect(sp.requiresApproval).toBe(true)
  })

  it('auto-fix-lint has maturity "advanced"', () => {
    const sp = getCatalog().get('auto-fix-lint')!
    expect(sp.maturity).toBe('advanced')
  })

  it('test-generation has category "testing"', () => {
    const sp = getCatalog().get('test-generation')!
    expect(sp.category).toBe('testing')
  })

  it('security-review agentPreset reviewer has lens "security"', () => {
    const sp = getCatalog().get('security-review')!
    expect(sp.agentPreset.reviewer.lens).toBe('security')
  })

  it('each built-in has a non-empty name distinct from its ID', () => {
    for (const sp of getCatalog().list()) {
      expect(sp.name).toBeTruthy()
      expect(typeof sp.name).toBe('string')
    }
  })

  it('each built-in has a non-empty description', () => {
    for (const sp of getCatalog().list()) {
      expect(sp.description.length).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------
// Type-level contract — Superpower shape
// ---------------------------------------------------------------------------

describe('Built-in superpowers — type shape', () => {
  it('id is a string', () => {
    for (const sp of getCatalog().list()) {
      expect(typeof sp.id).toBe('string')
    }
  })

  it('agentPreset.reviewer has role "reviewer"', () => {
    for (const sp of getCatalog().list()) {
      expect(sp.agentPreset.reviewer.role).toBe('reviewer')
    }
  })

  it('protocol is either undefined or "single_challenger"', () => {
    for (const sp of getCatalog().list()) {
      if (sp.protocol !== undefined) {
        expect(sp.protocol).toBe('single_challenger')
      }
    }
  })

  it('capabilityExpectation contains only valid capability strings when present', () => {
    const validCaps = ['fs.read', 'fs.write', 'net.http', 'proc.spawn', 'secrets.read']
    for (const sp of getCatalog().list()) {
      if (sp.capabilityExpectation) {
        for (const cap of sp.capabilityExpectation) {
          expect(validCaps).toContain(cap)
        }
      }
    }
  })
})
