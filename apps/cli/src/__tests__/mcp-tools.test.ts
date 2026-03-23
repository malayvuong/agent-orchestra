import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { TOOL_DEFINITIONS } from '../mcp/tools.js'
import {
  handleListSuperpowers,
  handleListSkills,
  handleEvaluatePolicy,
  handleShowFindings,
  handleGetJob,
} from '../mcp/handlers.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'ao-mcp-'))
  await mkdir(join(tempDir, '.agent-orchestra'), { recursive: true })
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

function parseResult(result: { content: Array<{ type: string; text: string }> }): unknown {
  return JSON.parse(result.content[0].text)
}

function getRequiredFields(toolName: string): string[] {
  const tool = TOOL_DEFINITIONS.find((entry) => entry.name === toolName)!
  const schema = tool.inputSchema as { required?: string[] }
  return schema.required ?? []
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

describe('MCP tool definitions', () => {
  it('defines 7 tools', () => {
    expect(TOOL_DEFINITIONS).toHaveLength(8)
  })

  it('each tool has name, description, and inputSchema', () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.name).toBeTruthy()
      expect(tool.description).toBeTruthy()
      expect(tool.inputSchema).toBeDefined()
      expect(tool.inputSchema.type).toBe('object')
    }
  })

  it('tool names are unique', () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('includes all expected tools', () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name)
    expect(names).toContain('list_superpowers')
    expect(names).toContain('review_target')
    expect(names).toContain('review_plan')
    expect(names).toContain('show_findings')
    expect(names).toContain('list_skills')
    expect(names).toContain('evaluate_policy')
    expect(names).toContain('get_job')
    expect(names).toContain('compare_runs')
  })

  it('review_target requires target parameter', () => {
    expect(getRequiredFields('review_target')).toContain('target')
  })

  it('review_plan requires target parameter', () => {
    expect(getRequiredFields('review_plan')).toContain('target')
  })

  it('show_findings requires jobId parameter', () => {
    expect(getRequiredFields('show_findings')).toContain('jobId')
  })

  it('evaluate_policy requires capability parameter', () => {
    expect(getRequiredFields('evaluate_policy')).toContain('capability')
  })

  it('list_superpowers has no required parameters', () => {
    expect(getRequiredFields('list_superpowers')).toEqual([])
  })

  it('compare_runs requires jobId parameter', () => {
    expect(getRequiredFields('compare_runs')).toContain('jobId')
  })
})

// ---------------------------------------------------------------------------
// list_superpowers handler
// ---------------------------------------------------------------------------

describe('handleListSuperpowers', () => {
  it('returns superpowers list', () => {
    const result = handleListSuperpowers()
    const parsed = parseResult(result) as { superpowers: unknown[] }

    expect(parsed.superpowers).toBeDefined()
    expect(Array.isArray(parsed.superpowers)).toBe(true)
    expect(parsed.superpowers.length).toBeGreaterThanOrEqual(5)
  })

  it('returns superpowers with expected fields', () => {
    const result = handleListSuperpowers()
    const parsed = parseResult(result) as { superpowers: Array<Record<string, unknown>> }

    for (const sp of parsed.superpowers) {
      expect(sp.id).toBeTruthy()
      expect(sp.name).toBeTruthy()
      expect(sp.category).toBeTruthy()
      expect(sp.maturity).toBeTruthy()
      expect(sp.description).toBeTruthy()
      expect(typeof sp.requiresApproval).toBe('boolean')
    }
  })

  it('includes plan-review in results', () => {
    const result = handleListSuperpowers()
    const parsed = parseResult(result) as { superpowers: Array<{ id: string }> }

    const ids = parsed.superpowers.map((s) => s.id)
    expect(ids).toContain('plan-review')
  })

  it('result is not an error', () => {
    const result = handleListSuperpowers()
    expect(result.isError).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// list_skills handler
// ---------------------------------------------------------------------------

describe('handleListSkills', () => {
  it('returns skills from workspace', async () => {
    // Create a minimal skill in the temp workspace
    const skillDir = join(tempDir, '.agent-orchestra', 'skills', 'test-skill')
    await mkdir(skillDir, { recursive: true })
    await writeFile(
      join(skillDir, 'SKILL.md'),
      `---
name: Test Skill
description: A test skill for MCP handler tests
version: 2026.3.1
---

Test content.
`,
    )

    const result = await handleListSkills(tempDir)
    const parsed = parseResult(result) as { skills: unknown[]; count: number }

    expect(parsed.count).toBeGreaterThanOrEqual(1)
    expect(parsed.skills.length).toBe(parsed.count)
  })

  it('returns empty list when no skills exist', async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), 'ao-mcp-empty-'))
    try {
      const result = await handleListSkills(emptyDir)
      const parsed = parseResult(result) as { skills: unknown[]; count: number }
      expect(parsed.count).toBe(0)
      expect(parsed.skills).toHaveLength(0)
    } finally {
      await rm(emptyDir, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// evaluate_policy handler
// ---------------------------------------------------------------------------

describe('handleEvaluatePolicy', () => {
  it('evaluates a capability against default policy', async () => {
    const result = await handleEvaluatePolicy({ capability: 'fs.read' }, tempDir)
    const parsed = parseResult(result) as { capability: string; action: string; reason: string }

    expect(parsed.capability).toBe('fs.read')
    expect(parsed.action).toBeTruthy()
    expect(parsed.reason).toBeTruthy()
  })

  it('evaluates with scope array', async () => {
    const result = await handleEvaluatePolicy(
      { capability: 'fs.read', scope: ['./src/index.ts'] },
      tempDir,
    )
    const parsed = parseResult(result) as { scope: string[] }

    expect(parsed.scope).toEqual(['./src/index.ts'])
  })

  it('evaluates with scope string', async () => {
    const result = await handleEvaluatePolicy(
      { capability: 'fs.read', scope: './src/index.ts' },
      tempDir,
    )
    const parsed = parseResult(result) as { scope: string[] }

    expect(parsed.scope).toEqual(['./src/index.ts'])
  })

  it('denies internal metadata SSRF by system rules', async () => {
    const result = await handleEvaluatePolicy(
      { capability: 'net.http', scope: ['http://169.254.169.254'] },
      tempDir,
    )
    const parsed = parseResult(result) as { action: string }

    expect(parsed.action).toBe('deny')
  })
})

// ---------------------------------------------------------------------------
// show_findings handler — error cases
// ---------------------------------------------------------------------------

describe('handleShowFindings', () => {
  it('returns error for nonexistent job', async () => {
    const result = await handleShowFindings({ jobId: 'nonexistent-job' }, tempDir)
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('not found')
  })
})

// ---------------------------------------------------------------------------
// get_job handler — error cases and read surfaces
// ---------------------------------------------------------------------------

describe('handleGetJob', () => {
  it('returns error for nonexistent job', async () => {
    const result = await handleGetJob({ jobId: 'nonexistent-job' }, tempDir)
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('not found')
  })

  it('returns targetResolution summary when present', async () => {
    // Seed a job with targetResolution
    const jobId = 'mcp-target-job-001'
    const jobDir = join(tempDir, '.agent-orchestra', 'jobs', jobId)
    await mkdir(jobDir, { recursive: true })
    await mkdir(join(jobDir, 'rounds'), { recursive: true })
    await writeFile(
      join(jobDir, 'job.json'),
      JSON.stringify({
        id: jobId,
        title: 'MCP Test',
        mode: 'code_review',
        brief: 'test',
        status: 'awaiting_decision',
        protocol: 'single_challenger',
        scope: {
          primaryTargets: ['/ws/a.ts'],
          excludedTargets: [],
          referencePolicy: { enabled: false, depth: 'same_file' },
          outOfScopeHandling: 'ignore',
          allowDebateExpansion: false,
        },
        targetResolution: {
          entryTarget: '/ws/a.ts',
          entryKind: 'file',
          workspaceRoot: '/ws',
          resolvedFiles: ['/ws/a.ts'],
          discovery: [{ path: '/ws/a.ts', reason: 'entry' }],
        },
        baselineSnapshot: {
          fingerprint: 'fp-a',
          capturedAt: '2026-03-22T00:00:00Z',
          files: [
            {
              path: '/ws/a.ts',
              relativePath: 'a.ts',
              content: 'export const a = 1\n',
              sha256: 'sha-a',
            },
          ],
        },
        decisionLog: {
          lockedConstraints: [],
          acceptedDecisions: [],
          rejectedOptions: [],
          unresolvedItems: [],
        },
        agents: [],
        currentRoundIndex: 0,
        maxRounds: 10,
        templateVersions: {},
        runtimeConfig: {
          maxConcurrentAgents: 2,
          pausePointsEnabled: false,
          synthesisConfig: { provider: 'architect_provider', rerunnable: false },
        },
        createdAt: '2026-03-22T00:00:00Z',
        updatedAt: '2026-03-22T00:00:00Z',
      }),
    )

    const result = await handleGetJob({ jobId }, tempDir)
    expect(result.isError).toBeUndefined()
    const parsed = parseResult(result) as Record<string, unknown>
    expect(parsed.targetResolution).toBeDefined()
    const tr = parsed.targetResolution as Record<string, unknown>
    expect(tr.entryTarget).toBe('/ws/a.ts')
    expect(tr.resolvedFileCount).toBe(1)
    expect(parsed.baselineSnapshot).toBeDefined()
  })

  it('returns null targetResolution for legacy jobs', async () => {
    const jobId = 'mcp-legacy-job-001'
    const jobDir = join(tempDir, '.agent-orchestra', 'jobs', jobId)
    await mkdir(jobDir, { recursive: true })
    await mkdir(join(jobDir, 'rounds'), { recursive: true })
    await writeFile(
      join(jobDir, 'job.json'),
      JSON.stringify({
        id: jobId,
        title: 'Legacy',
        mode: 'code_review',
        brief: 'test',
        status: 'awaiting_decision',
        protocol: 'single_challenger',
        scope: {
          primaryTargets: ['/ws/a.ts'],
          excludedTargets: [],
          referencePolicy: { enabled: false, depth: 'same_file' },
          outOfScopeHandling: 'ignore',
          allowDebateExpansion: false,
        },
        decisionLog: {
          lockedConstraints: [],
          acceptedDecisions: [],
          rejectedOptions: [],
          unresolvedItems: [],
        },
        agents: [],
        currentRoundIndex: 0,
        maxRounds: 10,
        templateVersions: {},
        runtimeConfig: {
          maxConcurrentAgents: 2,
          pausePointsEnabled: false,
          synthesisConfig: { provider: 'architect_provider', rerunnable: false },
        },
        createdAt: '2026-03-22T00:00:00Z',
        updatedAt: '2026-03-22T00:00:00Z',
      }),
    )

    const result = await handleGetJob({ jobId }, tempDir)
    const parsed = parseResult(result) as Record<string, unknown>
    expect(parsed.targetResolution).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// show_findings handler — apply summary
// ---------------------------------------------------------------------------

describe('handleShowFindings — apply summary', () => {
  it('includes apply summary counts when an apply round exists', async () => {
    // Seed job + convergence round + apply round
    const jobId = 'mcp-apply-job-001'
    const jobDir = join(tempDir, '.agent-orchestra', 'jobs', jobId)
    await mkdir(join(jobDir, 'rounds'), { recursive: true })
    await writeFile(
      join(jobDir, 'job.json'),
      JSON.stringify({
        id: jobId,
        title: 'Apply Test',
        mode: 'code_review',
        brief: 'test',
        status: 'awaiting_decision',
        protocol: 'single_challenger',
        scope: {
          primaryTargets: [],
          excludedTargets: [],
          referencePolicy: { enabled: false, depth: 'same_file' },
          outOfScopeHandling: 'ignore',
          allowDebateExpansion: false,
        },
        decisionLog: {
          lockedConstraints: [],
          acceptedDecisions: [],
          rejectedOptions: [],
          unresolvedItems: [],
        },
        agents: [],
        currentRoundIndex: 0,
        maxRounds: 10,
        templateVersions: {},
        runtimeConfig: {
          maxConcurrentAgents: 2,
          pausePointsEnabled: false,
          synthesisConfig: { provider: 'architect_provider', rerunnable: false },
        },
        createdAt: '2026-03-22T00:00:00Z',
        updatedAt: '2026-03-22T00:00:00Z',
      }),
    )

    // Convergence round
    await writeFile(
      join(jobDir, 'rounds', 'round-0.json'),
      JSON.stringify({
        id: 'conv-1',
        jobId,
        index: 0,
        state: 'convergence',
        reviewerOutputs: [],
        architectOutput: {
          rawText: 'synthesis',
          structuredSections: {},
          findings: [
            {
              id: 'f1',
              title: 'Issue',
              description: 'desc',
              scopeType: 'primary',
              actionability: 'must_fix_now',
              confidence: 'high',
            },
          ],
          warnings: [],
        },
        createdAt: '2026-03-22T00:00:00Z',
      }),
    )

    // Apply round with summary
    await writeFile(
      join(jobDir, 'rounds', 'round-1.json'),
      JSON.stringify({
        id: 'apply-1',
        jobId,
        index: 1,
        state: 'apply',
        reviewerOutputs: [],
        architectOutput: { rawText: 'applied', structuredSections: {}, findings: [], warnings: [] },
        applySummary: {
          attemptedFiles: ['/ws/a.ts'],
          writtenFiles: ['/ws/a.ts'],
          unchangedFiles: [],
          skippedFiles: [],
          errors: [],
        },
        createdAt: '2026-03-22T00:00:00Z',
      }),
    )

    const result = await handleShowFindings({ jobId }, tempDir)
    expect(result.isError).toBeUndefined()
    const parsed = parseResult(result) as Record<string, unknown>
    expect(parsed.applySummary).toBeDefined()
    const as = parsed.applySummary as Record<string, unknown>
    expect(as.writtenFiles).toBe(1)
    expect(as.attemptedFiles).toBe(1)
  })
})

describe('compare_runs tool surface', () => {
  it('returns comparable runs for the same baseline fingerprint', async () => {
    const jobIdA = 'mcp-compare-job-001'
    const jobIdB = 'mcp-compare-job-002'
    const baselineSnapshot = {
      fingerprint: 'mcp-shared-fp',
      capturedAt: '2026-03-22T00:00:00Z',
      files: [
        {
          path: '/ws/a.ts',
          relativePath: 'a.ts',
          content: 'export const a = 1\n',
          sha256: 'sha-a',
        },
      ],
    }

    for (const [jobId, score] of [
      [jobIdA, 70],
      [jobIdB, 91],
    ] as const) {
      const jobDir = join(tempDir, '.agent-orchestra', 'jobs', jobId)
      await mkdir(join(jobDir, 'rounds'), { recursive: true })
      await writeFile(
        join(jobDir, 'job.json'),
        JSON.stringify({
          id: jobId,
          title: `Compare ${jobId}`,
          mode: 'code_review',
          brief: 'test',
          status: 'awaiting_decision',
          protocol: 'single_challenger',
          scope: {
            primaryTargets: ['/ws/a.ts'],
            excludedTargets: [],
            referencePolicy: { enabled: false, depth: 'same_file' },
            outOfScopeHandling: 'ignore',
            allowDebateExpansion: false,
          },
          targetResolution: {
            entryTarget: '/ws/a.ts',
            entryKind: 'file',
            workspaceRoot: '/ws',
            resolvedFiles: ['/ws/a.ts'],
            discovery: [{ path: '/ws/a.ts', reason: 'entry' }],
          },
          baselineSnapshot,
          decisionLog: {
            lockedConstraints: [],
            acceptedDecisions: [],
            rejectedOptions: [],
            unresolvedItems: [],
          },
          agents: [],
          currentRoundIndex: 0,
          maxRounds: 10,
          templateVersions: {},
          runtimeConfig: {
            maxConcurrentAgents: 2,
            pausePointsEnabled: false,
            synthesisConfig: { provider: 'architect_provider', rerunnable: false },
          },
          createdAt: '2026-03-22T00:00:00Z',
          updatedAt: '2026-03-22T00:00:00Z',
        }),
      )
      await writeFile(
        join(jobDir, 'rounds', 'round-5.json'),
        JSON.stringify({
          id: `final-${jobId}`,
          jobId,
          index: 5,
          state: 'final_check',
          reviewerOutputs: [],
          createdAt: '2026-03-22T00:00:00Z',
          finalCheckSummary: {
            verdict: score > 80 ? 'improved' : 'mixed',
            score,
            summary: 'comparison',
            changedFiles: ['/ws/a.ts'],
            unchangedFiles: [],
            baselineFingerprint: 'mcp-shared-fp',
          },
        }),
      )
    }

    const { handleCompareRuns } = await import('../mcp/handlers.js')
    const result = await handleCompareRuns({ jobId: jobIdA }, tempDir)
    expect(result.isError).toBeUndefined()
    const parsed = parseResult(result) as Record<string, unknown>
    expect(parsed.basis).toBe('baseline_fingerprint')
    const runs = parsed.runs as Array<Record<string, unknown>>
    expect(runs).toHaveLength(2)
    expect(parsed.bestRunId).toBe(jobIdB)
  })
})
