import { describe, expect, it } from 'vitest'
import { compareCalver, isValidCalver, parseCalver } from '../calver.js'

describe('calver', () => {
  describe('isValidCalver', () => {
    it('accepts YYYY.M.PATCH', () => {
      expect(isValidCalver('2026.3.1')).toBe(true)
      expect(isValidCalver('2030.12.42')).toBe(true)
    })

    it('rejects zero-padded or semver inputs', () => {
      expect(isValidCalver('2026.03.1')).toBe(false)
      expect(isValidCalver('2026.3.01')).toBe(false)
      expect(isValidCalver('1.2.3')).toBe(false)
      expect(isValidCalver('2026.3')).toBe(false)
    })
  })

  describe('parseCalver', () => {
    it('parses year, month, and patch parts', () => {
      expect(parseCalver('2026.3.1')).toEqual({ year: 2026, month: 3, patch: 1 })
    })

    it('throws for invalid versions', () => {
      expect(() => parseCalver('2026.03.1')).toThrow('Invalid CalVer')
      expect(() => parseCalver('1.2.3')).toThrow('Invalid CalVer')
    })
  })

  describe('compareCalver', () => {
    it('orders by year, month, then patch', () => {
      expect(compareCalver('2027.1.1', '2026.12.99')).toBeGreaterThan(0)
      expect(compareCalver('2026.4.1', '2026.3.99')).toBeGreaterThan(0)
      expect(compareCalver('2026.3.2', '2026.3.1')).toBeGreaterThan(0)
      expect(compareCalver('2026.3.1', '2026.3.1')).toBe(0)
    })
  })
})
