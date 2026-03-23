import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, writeFile, rm, utimes } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { RegistryClient } from '../client.js'
import type { RegistryIndex, RegistrySkillEntry } from '../types.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeSkillEntry(overrides: Partial<RegistrySkillEntry> = {}): RegistrySkillEntry {
  return {
    id: 'test-skill',
    name: 'Test Skill',
    version: '2026.3.1',
    description: 'A test skill for unit tests',
    skillType: 'prompt',
    license: 'MIT',
    compatibility: { agentOrchestra: '>=1.0.0' },
    checksum: { algorithm: 'sha256', digest: 'abc123def456' },
    publishedAt: '2026-01-01T00:00:00Z',
    author: 'test-author',
    trustTier: 'community',
    ...overrides,
  }
}

function makeRegistryIndex(skills: RegistrySkillEntry[] = []): RegistryIndex {
  return {
    version: 1,
    generatedAt: '2026-01-01T00:00:00Z',
    skills,
    plugins: [],
  }
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

let cacheDir: string

beforeEach(async () => {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  cacheDir = join(tmpdir(), `ao-test-client-${id}`)
  await mkdir(cacheDir, { recursive: true })
})

afterEach(async () => {
  await rm(cacheDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

/**
 * Write a mock registry.json to the cache directory so tests
 * can operate without real HTTP calls.
 */
async function seedCache(index: RegistryIndex): Promise<void> {
  const registryCacheDir = join(cacheDir, 'registry')
  await mkdir(registryCacheDir, { recursive: true })
  await writeFile(join(registryCacheDir, 'registry.json'), JSON.stringify(index), 'utf-8')
}

/**
 * Create a RegistryClient pointing at the test cache with a long TTL
 * so it always reads from cache (no real HTTP calls).
 */
function createCachedClient(ttl = 86400): RegistryClient {
  return new RegistryClient({
    registryUrl: 'https://example.com/registry.json',
    cacheDir,
    cacheTtlSeconds: ttl,
  })
}

describe('RegistryClient', () => {
  // -------------------------------------------------------------------------
  // fetchIndex
  // -------------------------------------------------------------------------

  describe('fetchIndex', () => {
    it('returns cached index when fresh', async () => {
      const index = makeRegistryIndex([
        makeSkillEntry({ id: 'cached-skill', name: 'Cached Skill' }),
      ])
      await seedCache(index)

      const client = createCachedClient()
      const result = await client.fetchIndex()

      expect(result.version).toBe(1)
      expect(result.skills).toHaveLength(1)
      expect(result.skills[0].id).toBe('cached-skill')
    })

    it('uses default config when none provided', async () => {
      // Create a client with default registryUrl but custom cacheDir to avoid
      // hitting real cache from previous runs.
      const index = makeRegistryIndex([makeSkillEntry()])
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: () => Promise.resolve(JSON.stringify(index)),
      })
      vi.stubGlobal('fetch', mockFetch)

      // Only override cacheDir so registryUrl stays at the default
      const client = new RegistryClient({ cacheDir })
      const result = await client.fetchIndex()

      expect(result.version).toBe(1)
      expect(mockFetch).toHaveBeenCalledTimes(1)

      // Verify it used the default URL (agent-orchestra-registry)
      const calledUrl = mockFetch.mock.calls[0][0] as string
      expect(calledUrl).toContain('agent-orchestra-registry')
    })

    it('fetches from remote when cache is expired', async () => {
      const staleIndex = makeRegistryIndex([makeSkillEntry({ id: 'stale-skill', name: 'Stale' })])
      await seedCache(staleIndex)

      // Touch the cache file to be 2 hours old so it's expired
      const cacheFile = join(cacheDir, 'registry', 'registry.json')
      const past = new Date(Date.now() - 7200_000)
      await utimes(cacheFile, past, past)

      const freshIndex = makeRegistryIndex([makeSkillEntry({ id: 'fresh-skill', name: 'Fresh' })])
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ etag: '"abc123"' }),
        text: () => Promise.resolve(JSON.stringify(freshIndex)),
      })
      vi.stubGlobal('fetch', mockFetch)

      const client = new RegistryClient({
        registryUrl: 'https://example.com/registry.json',
        cacheDir,
        cacheTtlSeconds: 3600, // 1 hour — cache is 2 hours old, so expired
      })

      const result = await client.fetchIndex()

      expect(result.skills[0].id).toBe('fresh-skill')
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('stores and sends ETag for conditional requests', async () => {
      const index = makeRegistryIndex([makeSkillEntry()])

      // First call — no cache, no ETag
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ etag: '"v1-etag"' }),
        text: () => Promise.resolve(JSON.stringify(index)),
      })
      vi.stubGlobal('fetch', mockFetch)

      const client = new RegistryClient({
        registryUrl: 'https://example.com/registry.json',
        cacheDir,
        cacheTtlSeconds: 3600,
      })

      await client.fetchIndex()

      // First call should NOT have If-None-Match (no prior ETag)
      const firstCallHeaders = mockFetch.mock.calls[0][1]?.headers as Record<string, string>
      expect(firstCallHeaders['If-None-Match']).toBeUndefined()

      // Age the cache file so the second call skips cache
      const cacheFile = join(cacheDir, 'registry', 'registry.json')
      const past = new Date(Date.now() - 7200_000)
      await utimes(cacheFile, past, past)

      // Second call should send If-None-Match with the stored ETag
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ etag: '"v2-etag"' }),
        text: () => Promise.resolve(JSON.stringify(index)),
      })

      await client.fetchIndex()

      expect(mockFetch).toHaveBeenCalledTimes(2)
      const secondCallHeaders = mockFetch.mock.calls[1][1]?.headers as Record<string, string>
      expect(secondCallHeaders['If-None-Match']).toBe('"v1-etag"')
    })

    it('throws when fetch fails and no cache exists', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'))
      vi.stubGlobal('fetch', mockFetch)

      // Use a fresh cache dir with no seeded data and TTL=0 to skip cache
      const client = new RegistryClient({
        registryUrl: 'https://example.com/registry.json',
        cacheDir,
        cacheTtlSeconds: 0,
      })

      await expect(client.fetchIndex()).rejects.toThrow('Failed to fetch registry index')
    })
  })

  // -------------------------------------------------------------------------
  // search
  // -------------------------------------------------------------------------

  describe('search', () => {
    const testSkills = [
      makeSkillEntry({
        id: 'security-review',
        name: 'Security Review',
        description: 'OWASP security checklist',
        skillType: 'prompt',
        trustTier: 'official',
        triggers: { lenses: ['security'] },
      }),
      makeSkillEntry({
        id: 'code-quality',
        name: 'Code Quality',
        description: 'General code quality guidelines',
        skillType: 'prompt',
        trustTier: 'verified',
        triggers: { lenses: ['quality'] },
      }),
      makeSkillEntry({
        id: 'dep-audit',
        name: 'Dependency Audit',
        description: 'Audit dependencies for vulnerabilities',
        skillType: 'tool',
        trustTier: 'community',
        triggers: { lenses: ['security'] },
      }),
      makeSkillEntry({
        id: 'test-patterns',
        name: 'Test Patterns',
        description: 'Testing conventions and patterns',
        skillType: 'prompt',
        trustTier: 'official',
        triggers: { lenses: ['testing'] },
      }),
    ]

    it('filters by query string (case-insensitive)', async () => {
      await seedCache(makeRegistryIndex(testSkills))
      const client = createCachedClient()

      const results = await client.search('SECURITY')

      // Matches: security-review (id/name/description), dep-audit (description contains "vulnerabilities" but not "security")
      // Actually: dep-audit description is "Audit dependencies for vulnerabilities" — no "security" word
      // security-review: id has "security", name has "Security", description has "security"
      // So only security-review matches "SECURITY"
      expect(results).toHaveLength(1)
      expect(results[0].id).toBe('security-review')
    })

    it('matches against description content', async () => {
      await seedCache(makeRegistryIndex(testSkills))
      const client = createCachedClient()

      const results = await client.search('owasp')
      expect(results).toHaveLength(1)
      expect(results[0].id).toBe('security-review')
    })

    it('filters by skillType', async () => {
      await seedCache(makeRegistryIndex(testSkills))
      const client = createCachedClient()

      const results = await client.search('audit', { skillType: 'tool' })

      expect(results).toHaveLength(1)
      expect(results[0].id).toBe('dep-audit')
    })

    it('filters by trustTier', async () => {
      await seedCache(makeRegistryIndex(testSkills))
      const client = createCachedClient()

      // Empty query matches everything, then filter by official trustTier
      const results = await client.search('', { trustTier: 'official' })

      expect(results).toHaveLength(2)
      const ids = results.map((r) => r.id)
      expect(ids).toContain('security-review')
      expect(ids).toContain('test-patterns')
    })

    it('filters by lens', async () => {
      await seedCache(makeRegistryIndex(testSkills))
      const client = createCachedClient()

      const results = await client.search('', { lens: 'security' })

      expect(results).toHaveLength(2)
      const ids = results.map((r) => r.id)
      expect(ids).toContain('security-review')
      expect(ids).toContain('dep-audit')
    })

    it('returns empty for no matches', async () => {
      await seedCache(makeRegistryIndex(testSkills))
      const client = createCachedClient()

      const results = await client.search('nonexistent-xyz-12345')

      expect(results).toHaveLength(0)
    })

    it('combines query with multiple filters', async () => {
      await seedCache(makeRegistryIndex(testSkills))
      const client = createCachedClient()

      const results = await client.search('security', {
        skillType: 'prompt',
        trustTier: 'official',
      })

      expect(results).toHaveLength(1)
      expect(results[0].id).toBe('security-review')
    })
  })

  // -------------------------------------------------------------------------
  // checkUpdates
  // -------------------------------------------------------------------------

  describe('checkUpdates', () => {
    it('detects newer version available', async () => {
      const index = makeRegistryIndex([
        makeSkillEntry({ id: 'skill-a', version: '2026.4.1' }),
        makeSkillEntry({ id: 'skill-b', version: '2026.3.5' }),
      ])
      await seedCache(index)
      const client = createCachedClient()

      const updates = await client.checkUpdates([
        { skillId: 'skill-a', version: '2026.3.1' },
        { skillId: 'skill-b', version: '2026.3.1' },
      ])

      expect(updates).toHaveLength(2)
      expect(updates).toEqual(
        expect.arrayContaining([
          { skillId: 'skill-a', currentVersion: '2026.3.1', latestVersion: '2026.4.1' },
          { skillId: 'skill-b', currentVersion: '2026.3.1', latestVersion: '2026.3.5' },
        ]),
      )
    })

    it('returns empty when all up to date', async () => {
      const index = makeRegistryIndex([
        makeSkillEntry({ id: 'skill-a', version: '2026.3.1' }),
        makeSkillEntry({ id: 'skill-b', version: '2026.4.1' }),
      ])
      await seedCache(index)
      const client = createCachedClient()

      const updates = await client.checkUpdates([
        { skillId: 'skill-a', version: '2026.3.1' },
        { skillId: 'skill-b', version: '2026.4.1' },
      ])

      expect(updates).toHaveLength(0)
    })

    it('ignores skills not found in registry', async () => {
      const index = makeRegistryIndex([makeSkillEntry({ id: 'skill-a', version: '2026.4.1' })])
      await seedCache(index)
      const client = createCachedClient()

      const updates = await client.checkUpdates([
        { skillId: 'skill-a', version: '2026.3.1' },
        { skillId: 'unknown-skill', version: '2026.3.1' },
      ])

      expect(updates).toHaveLength(1)
      expect(updates[0].skillId).toBe('skill-a')
    })

    it('handles installed version newer than registry (no downgrade)', async () => {
      const index = makeRegistryIndex([makeSkillEntry({ id: 'skill-a', version: '2026.3.1' })])
      await seedCache(index)
      const client = createCachedClient()

      const updates = await client.checkUpdates([{ skillId: 'skill-a', version: '2026.4.1' }])

      expect(updates).toHaveLength(0)
    })

    it('picks the highest version among multiple registry entries', async () => {
      const index = makeRegistryIndex([
        makeSkillEntry({ id: 'skill-a', version: '2026.3.1' }),
        makeSkillEntry({ id: 'skill-a', version: '2026.10.1' }),
        makeSkillEntry({ id: 'skill-a', version: '2026.4.8' }),
      ])
      await seedCache(index)
      const client = createCachedClient()

      const updates = await client.checkUpdates([{ skillId: 'skill-a', version: '2026.4.1' }])

      expect(updates).toHaveLength(1)
      expect(updates[0].latestVersion).toBe('2026.10.1')
    })

    it('treats zero-padded versions as invalid input', async () => {
      const index = makeRegistryIndex([makeSkillEntry({ id: 'skill-a', version: '2026.3.1' })])
      await seedCache(index)
      const client = createCachedClient()

      await expect(
        client.checkUpdates([{ skillId: 'skill-a', version: '2026.03.1' }]),
      ).rejects.toThrow('not a valid CalVer')
    })
  })
})
