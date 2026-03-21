import { describe, it, expect, beforeEach, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock child_process + util at module level
// vi.hoisted ensures the mock fn is created before vi.mock factories run
// ---------------------------------------------------------------------------

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
}))

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}))

vi.mock('node:util', () => ({
  promisify: () => execFileMock,
}))

// Import after mocks are set up
import { SkillSigner } from '../signer.js'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SkillSigner', () => {
  let signer: SkillSigner

  beforeEach(() => {
    signer = new SkillSigner(undefined, { timeoutMs: 5000 })
    execFileMock.mockReset()
  })

  describe('sign', () => {
    it('generates .sig file path on successful signing', async () => {
      execFileMock.mockResolvedValue({
        stdout: 'Signer: user@example.com',
        stderr: '',
      })

      const result = await signer.sign('/packages/skill-v1.tar.gz')

      expect(result.signed).toBe(true)
      expect(result.signaturePath).toBe('/packages/skill-v1.tar.gz.sig')
      expect(result.signerIdentity).toBe('user@example.com')
    })

    it('calls cosign with correct arguments', async () => {
      execFileMock.mockResolvedValue({ stdout: '', stderr: '' })

      await signer.sign('/packages/skill-v1.tar.gz')

      expect(execFileMock).toHaveBeenCalledWith(
        'cosign',
        [
          'sign-blob',
          '--yes',
          '/packages/skill-v1.tar.gz',
          '--output-signature',
          '/packages/skill-v1.tar.gz.sig',
        ],
        expect.objectContaining({ timeout: 5000 }),
      )
    })

    it('returns signed=false when cosign fails', async () => {
      execFileMock.mockRejectedValue(new Error('cosign not found'))

      const result = await signer.sign('/packages/skill-v1.tar.gz')

      expect(result.signed).toBe(false)
      expect(result.signaturePath).toBe('')
      expect(result.signerIdentity).toBe('')
    })
  })

  describe('verify', () => {
    it('returns verified=true for matching signature', async () => {
      execFileMock.mockResolvedValue({
        stdout: 'Verified OK\nSubject: signer@ci.example.com',
        stderr: '',
      })

      const result = await signer.verify(
        '/packages/skill-v1.tar.gz',
        '/packages/skill-v1.tar.gz.sig',
      )

      expect(result.verified).toBe(true)
      expect(result.signerIdentity).toBe('signer@ci.example.com')
    })

    it('returns verified=false for bad signature', async () => {
      execFileMock.mockRejectedValue(new Error('signature mismatch'))

      const result = await signer.verify(
        '/packages/skill-v1.tar.gz',
        '/packages/skill-v1.tar.gz.bad-sig',
      )

      expect(result.verified).toBe(false)
      expect(result.error).toContain('signature mismatch')
    })

    it('calls cosign verify-blob with correct arguments', async () => {
      execFileMock.mockResolvedValue({ stdout: '', stderr: '' })

      await signer.verify('/packages/skill-v1.tar.gz', '/packages/skill-v1.tar.gz.sig')

      expect(execFileMock).toHaveBeenCalledWith(
        'cosign',
        [
          'verify-blob',
          '/packages/skill-v1.tar.gz',
          '--signature',
          '/packages/skill-v1.tar.gz.sig',
        ],
        expect.objectContaining({ timeout: 5000 }),
      )
    })
  })

  describe('checkCosign', () => {
    it('returns true when cosign is available', async () => {
      execFileMock.mockResolvedValue({
        stdout: 'cosign v2.2.0',
        stderr: '',
      })

      const result = await signer.checkCosign()

      expect(result).toBe(true)
      expect(execFileMock).toHaveBeenCalledWith(
        'cosign',
        ['version'],
        expect.objectContaining({ timeout: 5000 }),
      )
    })

    it('returns false when cosign is unavailable', async () => {
      execFileMock.mockRejectedValue(new Error('command not found: cosign'))

      const result = await signer.checkCosign()

      expect(result).toBe(false)
    })
  })
})
