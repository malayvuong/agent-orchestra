/**
 * Trust tier enforcement unit tests.
 *
 * Validates that trust tier restrictions are correctly applied
 * to different skill types (prompt, tool, plugin).
 */

import { describe, it, expect } from 'vitest'
import { validateTrustTier } from '../trust-tier.js'
import type { TrustTier } from '../trust-tier.js'

describe('validateTrustTier', () => {
  // -------------------------------------------------------------------------
  // official tier — allows all types
  // -------------------------------------------------------------------------

  describe('official tier', () => {
    it('allows prompt skill type', () => {
      const result = validateTrustTier('prompt', 'official')
      expect(result.allowed).toBe(true)
    })

    it('allows tool skill type', () => {
      const result = validateTrustTier('tool', 'official')
      expect(result.allowed).toBe(true)
    })

    it('allows plugin skill type', () => {
      const result = validateTrustTier('plugin', 'official')
      expect(result.allowed).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // verified tier — allows prompt and tool, blocks plugin
  // -------------------------------------------------------------------------

  describe('verified tier', () => {
    it('allows prompt skill type', () => {
      const result = validateTrustTier('prompt', 'verified')
      expect(result.allowed).toBe(true)
    })

    it('allows tool skill type', () => {
      const result = validateTrustTier('tool', 'verified')
      expect(result.allowed).toBe(true)
    })

    it('blocks plugin skill type', () => {
      const result = validateTrustTier('plugin', 'verified')
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('official')
      expect(result.reason).toContain('Plugin')
    })
  })

  // -------------------------------------------------------------------------
  // community tier — allows prompt only, blocks tool and plugin
  // -------------------------------------------------------------------------

  describe('community tier', () => {
    it('allows prompt skill type', () => {
      const result = validateTrustTier('prompt', 'community')
      expect(result.allowed).toBe(true)
    })

    it('blocks tool skill type', () => {
      const result = validateTrustTier('tool', 'community')
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('verified')
      expect(result.reason).toContain('Tool')
    })

    it('blocks plugin skill type', () => {
      const result = validateTrustTier('plugin', 'community')
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('official')
      expect(result.reason).toContain('Plugin')
    })
  })

  // -------------------------------------------------------------------------
  // experimental tier — allows prompt only (with warning), blocks tool and plugin
  // -------------------------------------------------------------------------

  describe('experimental tier', () => {
    it('allows prompt skill type with warning', () => {
      const result = validateTrustTier('prompt', 'experimental')
      expect(result.allowed).toBe(true)
      expect(result.reason).toBeDefined()
      expect(result.reason).toContain('Experimental')
      expect(result.reason).toContain('caution')
    })

    it('blocks tool skill type', () => {
      const result = validateTrustTier('tool', 'experimental')
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('verified')
      expect(result.reason).toContain('Tool')
    })

    it('blocks plugin skill type', () => {
      const result = validateTrustTier('plugin', 'experimental')
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('official')
      expect(result.reason).toContain('Plugin')
    })
  })

  // -------------------------------------------------------------------------
  // Cross-cutting validation
  // -------------------------------------------------------------------------

  describe('cross-cutting', () => {
    it('all tiers allow prompt type', () => {
      const tiers: TrustTier[] = ['official', 'verified', 'community', 'experimental']
      for (const tier of tiers) {
        const result = validateTrustTier('prompt', tier)
        expect(result.allowed).toBe(true)
      }
    })

    it('only official tier allows plugin type', () => {
      const allowedTiers: TrustTier[] = ['official']
      const blockedTiers: TrustTier[] = ['verified', 'community', 'experimental']

      for (const tier of allowedTiers) {
        expect(validateTrustTier('plugin', tier).allowed).toBe(true)
      }
      for (const tier of blockedTiers) {
        expect(validateTrustTier('plugin', tier).allowed).toBe(false)
      }
    })

    it('only official and verified tiers allow tool type', () => {
      const allowedTiers: TrustTier[] = ['official', 'verified']
      const blockedTiers: TrustTier[] = ['community', 'experimental']

      for (const tier of allowedTiers) {
        expect(validateTrustTier('tool', tier).allowed).toBe(true)
      }
      for (const tier of blockedTiers) {
        expect(validateTrustTier('tool', tier).allowed).toBe(false)
      }
    })
  })
})
