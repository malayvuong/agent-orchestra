import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ProvenanceGenerator } from '../provenance.js'
import type { BuildContext, SLSAProvenance } from '../types.js'

// Mock node:fs/promises for writeProvenance
vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
}))

// Mock crypto.randomUUID for deterministic tests
vi.mock('node:crypto', () => ({
  randomUUID: vi.fn().mockReturnValue('test-uuid-1234-5678-abcd-ef0123456789'),
}))

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProvenanceGenerator', () => {
  let generator: ProvenanceGenerator

  const defaultBuildContext: BuildContext = {
    builder: 'github-actions',
    commitSha: 'abc123def456',
    repoUrl: 'https://github.com/agent-orchestra/registry',
    startedAt: '2026-03-21T10:00:00Z',
    finishedOn: '2026-03-21T10:05:00Z',
  }

  const defaultChecksum = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'

  beforeEach(() => {
    generator = new ProvenanceGenerator()
  })

  describe('generate: returns valid SLSA v1 statement', () => {
    it('has correct _type and predicateType', () => {
      const provenance = generator.generate(
        'security-review',
        '1.2.0',
        defaultChecksum,
        defaultBuildContext,
      )

      expect(provenance._type).toBe('https://in-toto.io/Statement/v1')
      expect(provenance.predicateType).toBe('https://slsa.dev/provenance/v1')
    })

    it('has correct build type in predicate', () => {
      const provenance = generator.generate(
        'security-review',
        '1.2.0',
        defaultChecksum,
        defaultBuildContext,
      )

      expect(provenance.predicate.buildDefinition.buildType).toBe(
        'https://agent-orchestra.dev/skill-build/v1',
      )
    })

    it('includes external parameters with skill info', () => {
      const provenance = generator.generate(
        'security-review',
        '1.2.0',
        defaultChecksum,
        defaultBuildContext,
      )

      const ext = provenance.predicate.buildDefinition.externalParameters
      expect(ext.skillId).toBe('security-review')
      expect(ext.version).toBe('1.2.0')
      expect(ext.source).toBe('https://github.com/agent-orchestra/registry')
      expect(ext.commit).toBe('abc123def456')
    })

    it('omits source and commit when not provided', () => {
      const minimalContext: BuildContext = {
        builder: 'local-dev',
        startedAt: '2026-03-21T10:00:00Z',
        finishedOn: '2026-03-21T10:01:00Z',
      }

      const provenance = generator.generate('my-skill', '0.1.0', defaultChecksum, minimalContext)

      const ext = provenance.predicate.buildDefinition.externalParameters
      expect(ext).not.toHaveProperty('source')
      expect(ext).not.toHaveProperty('commit')
    })
  })

  describe('generate: includes correct subject with sha256 digest', () => {
    it('has subject with skillId@version name and sha256 digest', () => {
      const provenance = generator.generate(
        'code-quality',
        '2.0.0',
        'deadbeef1234567890abcdef1234567890abcdef1234567890abcdef12345678',
        defaultBuildContext,
      )

      expect(provenance.subject).toHaveLength(1)
      expect(provenance.subject[0].name).toBe('code-quality@2.0.0')
      expect(provenance.subject[0].digest.sha256).toBe(
        'deadbeef1234567890abcdef1234567890abcdef1234567890abcdef12345678',
      )
    })
  })

  describe('generate: includes builder ID and timestamps', () => {
    it('has correct builder ID from build context', () => {
      const provenance = generator.generate(
        'security-review',
        '1.0.0',
        defaultChecksum,
        defaultBuildContext,
      )

      expect(provenance.predicate.runDetails.builder.id).toBe('github-actions')
    })

    it('has correct started and finished timestamps', () => {
      const provenance = generator.generate(
        'security-review',
        '1.0.0',
        defaultChecksum,
        defaultBuildContext,
      )

      const metadata = provenance.predicate.runDetails.metadata
      expect(metadata.startedOn).toBe('2026-03-21T10:00:00Z')
      expect(metadata.finishedOn).toBe('2026-03-21T10:05:00Z')
    })

    it('has a unique invocation ID', () => {
      const provenance = generator.generate(
        'security-review',
        '1.0.0',
        defaultChecksum,
        defaultBuildContext,
      )

      expect(provenance.predicate.runDetails.metadata.invocationId).toBe(
        'test-uuid-1234-5678-abcd-ef0123456789',
      )
    })
  })

  describe('writeProvenance', () => {
    it('writes JSON to the specified output path', async () => {
      const { writeFile } = await import('node:fs/promises')

      const provenance = generator.generate(
        'test-skill',
        '1.0.0',
        defaultChecksum,
        defaultBuildContext,
      )

      await generator.writeProvenance(provenance, '/output/test-skill.provenance.json')

      expect(writeFile).toHaveBeenCalledWith(
        '/output/test-skill.provenance.json',
        expect.any(String),
        'utf-8',
      )

      // Verify it's valid JSON with 2-space indentation
      const writtenContent = (writeFile as ReturnType<typeof vi.fn>).mock.calls[0][1]
      const parsed = JSON.parse(writtenContent) as SLSAProvenance
      expect(parsed._type).toBe('https://in-toto.io/Statement/v1')
      expect(writtenContent).toContain('  ') // 2-space indent
    })
  })
})
