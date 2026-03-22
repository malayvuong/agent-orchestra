import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createProgram } from '../program.js'
import { handleReviewTarget } from '../mcp/handlers.js'
import { Orchestrator } from '@agent-orchestra/core'

let workspacePath: string
let originalOpenAiKey: string | undefined

async function writeWorkspaceFile(relativePath: string, content: string): Promise<string> {
  const absolutePath = join(workspacePath, relativePath)
  await mkdir(join(absolutePath, '..'), { recursive: true })
  await writeFile(absolutePath, content, 'utf-8')
  return realpath(absolutePath)
}

beforeEach(async () => {
  workspacePath = await mkdtemp(join(tmpdir(), 'ao-run-targeting-'))
  workspacePath = await realpath(workspacePath)
  originalOpenAiKey = process.env.OPENAI_API_KEY
  process.env.OPENAI_API_KEY = 'test-key'
})

afterEach(async () => {
  await rm(workspacePath, { recursive: true, force: true })
  vi.restoreAllMocks()
  if (originalOpenAiKey === undefined) {
    delete process.env.OPENAI_API_KEY
  } else {
    process.env.OPENAI_API_KEY = originalOpenAiKey
  }
})

describe('run command target wiring', () => {
  it('expands Markdown-linked files before creating the job scope', async () => {
    await writeWorkspaceFile('README.md', ['# Root Plan', '', '- [Spec](docs/spec.md)'].join('\n'))
    const specPath = await writeWorkspaceFile('docs/spec.md', '# Spec\n')

    let capturedParams: Record<string, unknown> | undefined
    vi.spyOn(Orchestrator.prototype, 'createJob').mockImplementation(async (params) => {
      capturedParams = params as unknown as Record<string, unknown>
      return {
        id: 'job-run-targeting',
        title: params.title,
        brief: params.brief,
        mode: params.mode,
        status: 'draft',
        protocol: params.protocol,
        scope: params.scope,
        targetResolution: params.targetResolution,
        decisionLog: {
          lockedConstraints: [],
          acceptedDecisions: [],
          rejectedOptions: [],
          unresolvedItems: [],
        },
        agents: params.agents,
        currentRoundIndex: 0,
        maxRounds: 10,
        templateVersions: {},
        runtimeConfig: params.runtimeConfig ?? {
          maxConcurrentAgents: 2,
          pausePointsEnabled: false,
          synthesisConfig: { provider: 'architect_provider', rerunnable: false },
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
    })
    vi.spyOn(Orchestrator.prototype, 'runJob').mockResolvedValue(undefined)

    const program = createProgram()
    await program.parseAsync([
      'node',
      'agent-orchestra',
      'run',
      '--provider',
      'openai',
      '--model',
      'gpt-4o',
      '--path',
      workspacePath,
      '--target',
      'README.md',
    ])

    expect(capturedParams).toBeDefined()

    const scope = capturedParams!.scope as { primaryTargets: string[] }
    expect(scope.primaryTargets).toContain(specPath)
    expect(capturedParams!.targetResolution).toEqual(
      expect.objectContaining({
        entryKind: 'file',
        workspaceRoot: workspacePath,
        resolvedFiles: expect.arrayContaining([specPath]),
      }),
    )

    const brief = capturedParams!.brief as string
    expect(brief).toContain('--- README.md ---')
    expect(brief).toContain('--- docs/spec.md ---')
  })
})

describe('MCP review_target target wiring', () => {
  it('uses the shared target expansion when building the job scope', async () => {
    await writeWorkspaceFile('README.md', ['# Root Plan', '', '- [Spec](docs/spec.md)'].join('\n'))
    const specPath = await writeWorkspaceFile('docs/spec.md', '# Spec\n')

    let capturedParams: Record<string, unknown> | undefined
    vi.spyOn(Orchestrator.prototype, 'createJob').mockImplementation(async (params) => {
      capturedParams = params as unknown as Record<string, unknown>
      return {
        id: 'job-mcp-targeting',
        title: params.title,
        brief: params.brief,
        mode: params.mode,
        status: 'draft',
        protocol: params.protocol,
        scope: params.scope,
        targetResolution: params.targetResolution,
        decisionLog: {
          lockedConstraints: [],
          acceptedDecisions: [],
          rejectedOptions: [],
          unresolvedItems: [],
        },
        agents: params.agents,
        currentRoundIndex: 0,
        maxRounds: 10,
        templateVersions: {},
        runtimeConfig: {
          maxConcurrentAgents: 2,
          pausePointsEnabled: false,
          synthesisConfig: { provider: 'architect_provider', rerunnable: false },
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
    })
    vi.spyOn(Orchestrator.prototype, 'runJob').mockResolvedValue(undefined)

    const result = await handleReviewTarget(
      { target: 'README.md', brief: 'Review this plan' },
      workspacePath,
    )

    expect(result.isError).toBeUndefined()
    expect(capturedParams).toBeDefined()

    const scope = capturedParams!.scope as { primaryTargets: string[] }
    expect(scope.primaryTargets).toContain(specPath)
    expect(capturedParams!.targetResolution).toEqual(
      expect.objectContaining({
        entryKind: 'file',
        workspaceRoot: workspacePath,
        resolvedFiles: expect.arrayContaining([specPath]),
      }),
    )

    const brief = capturedParams!.brief as string
    expect(brief).toContain('--- README.md ---')
    expect(brief).toContain('--- docs/spec.md ---')
  })
})
