import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SkillHookRunner } from '../hook-runner.js'
import type {
  HookSandboxRunner,
  HookSkillMatcher,
  HookPolicyEngine,
  HookLogger,
} from '../hook-runner.js'
import type { HookContext } from '../types.js'
import type { SkillDefinition, SkillMatchResult } from '../../types.js'
import type { SkillArtifact } from '../../executor/types.js'

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function makePluginSkill(id: string, lifecycle: string[]): SkillDefinition {
  return {
    id,
    version: '1.0.0',
    name: id,
    description: `Plugin skill: ${id}`,
    skillType: 'plugin',
    source: { type: 'local', path: `/plugins/${id}/run.sh` },
    triggers: { lifecycle: lifecycle as NonNullable<SkillDefinition['triggers']>['lifecycle'] },
    promptContent: '',
    promptSummary: '',
  }
}

function makeHookContext(overrides?: Partial<HookContext>): HookContext {
  return {
    jobId: 'job-001',
    roundIndex: 0,
    agentId: 'agent-alpha',
    workspacePath: '/workspace/project',
    ...overrides,
  }
}

function makeMockSandboxRunner(): HookSandboxRunner {
  return {
    run: vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: '{"result": "ok"}',
      stderr: '',
      artifacts: [
        {
          type: 'finding' as const,
          name: 'test-finding',
          content: 'found something',
          includeInContext: true,
        },
      ] satisfies SkillArtifact[],
      durationMs: 150,
      killed: false,
    }),
  }
}

function makeMockSkillMatcher(matchedSkills: SkillDefinition[] = []): HookSkillMatcher {
  return {
    match: vi.fn().mockReturnValue({
      matched: matchedSkills,
      reason: new Map(matchedSkills.map((s) => [s.id, `lifecycle:post_round`])),
    } satisfies SkillMatchResult),
  }
}

function makeMockPolicyEngine(overallAction: string = 'allow'): HookPolicyEngine {
  return {
    evaluateInvocation: vi.fn().mockReturnValue([{ action: overallAction, reason: 'test policy' }]),
    getOverallAction: vi.fn().mockReturnValue(overallAction),
  }
}

function makeMockLogger(): HookLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SkillHookRunner', () => {
  let sandboxRunner: HookSandboxRunner
  let skillMatcher: HookSkillMatcher
  let policyEngine: HookPolicyEngine
  let logger: HookLogger
  let runner: SkillHookRunner

  const linterPlugin = makePluginSkill('linter-hook', ['post_round'])
  const coveragePlugin = makePluginSkill('coverage-hook', ['post_round'])
  const preRoundPlugin = makePluginSkill('preprocessor', ['pre_round'])

  beforeEach(() => {
    sandboxRunner = makeMockSandboxRunner()
    policyEngine = makeMockPolicyEngine('allow')
    logger = makeMockLogger()
  })

  describe('runHooks: calls matched plugin skills in priority order', () => {
    it('executes matched skills sequentially', async () => {
      skillMatcher = makeMockSkillMatcher([linterPlugin, coveragePlugin])
      runner = new SkillHookRunner(sandboxRunner, skillMatcher, policyEngine, logger)
      runner.setPluginSkills([linterPlugin, coveragePlugin, preRoundPlugin])

      const results = await runner.runHooks('post_round', makeHookContext())

      expect(results).toHaveLength(2)
      expect(results[0].skillId).toBe('linter-hook')
      expect(results[0].success).toBe(true)
      expect(results[1].skillId).toBe('coverage-hook')
      expect(results[1].success).toBe(true)

      // Verify sandbox was called twice, sequentially
      expect(sandboxRunner.run).toHaveBeenCalledTimes(2)
    })

    it('collects artifacts from each hook', async () => {
      skillMatcher = makeMockSkillMatcher([linterPlugin])
      runner = new SkillHookRunner(sandboxRunner, skillMatcher, policyEngine, logger)
      runner.setPluginSkills([linterPlugin])

      const results = await runner.runHooks('post_round', makeHookContext())

      expect(results[0].artifacts).toHaveLength(1)
      expect(results[0].artifacts[0].type).toBe('finding')
      expect(results[0].artifacts[0].name).toBe('test-finding')
    })
  })

  describe('runHooks: skips denied skills', () => {
    it('skips a skill when policy denies it', async () => {
      policyEngine = makeMockPolicyEngine('deny')
      skillMatcher = makeMockSkillMatcher([linterPlugin])
      runner = new SkillHookRunner(sandboxRunner, skillMatcher, policyEngine, logger)
      runner.setPluginSkills([linterPlugin])

      const results = await runner.runHooks('post_round', makeHookContext())

      expect(results).toHaveLength(1)
      expect(results[0].skillId).toBe('linter-hook')
      expect(results[0].success).toBe(false)
      expect(results[0].error).toBe('Denied by policy')

      // Sandbox should NOT have been called
      expect(sandboxRunner.run).not.toHaveBeenCalled()

      // Logger should have warned
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('denied by policy'))
    })
  })

  describe('runHooks: continues on hook failure (graceful degradation)', () => {
    it('continues to next hook when one throws an exception', async () => {
      const throwingSandbox: HookSandboxRunner = {
        run: vi.fn().mockRejectedValueOnce(new Error('sandbox crashed')).mockResolvedValueOnce({
          exitCode: 0,
          stdout: '',
          stderr: '',
          artifacts: [],
          durationMs: 100,
          killed: false,
        }),
      }

      skillMatcher = makeMockSkillMatcher([linterPlugin, coveragePlugin])
      runner = new SkillHookRunner(throwingSandbox, skillMatcher, policyEngine, logger)
      runner.setPluginSkills([linterPlugin, coveragePlugin])

      const results = await runner.runHooks('post_round', makeHookContext())

      // Both hooks should have results
      expect(results).toHaveLength(2)

      // First hook failed
      expect(results[0].skillId).toBe('linter-hook')
      expect(results[0].success).toBe(false)
      expect(results[0].error).toBe('sandbox crashed')

      // Second hook succeeded despite first failure
      expect(results[1].skillId).toBe('coverage-hook')
      expect(results[1].success).toBe(true)

      // Error was logged
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('threw an exception'))
    })

    it('continues when a hook exits with non-zero code', async () => {
      const failingSandbox: HookSandboxRunner = {
        run: vi
          .fn()
          .mockResolvedValueOnce({
            exitCode: 1,
            stdout: '',
            stderr: 'linter config error',
            artifacts: [],
            durationMs: 50,
            killed: false,
          })
          .mockResolvedValueOnce({
            exitCode: 0,
            stdout: '',
            stderr: '',
            artifacts: [],
            durationMs: 100,
            killed: false,
          }),
      }

      skillMatcher = makeMockSkillMatcher([linterPlugin, coveragePlugin])
      runner = new SkillHookRunner(failingSandbox, skillMatcher, policyEngine, logger)
      runner.setPluginSkills([linterPlugin, coveragePlugin])

      const results = await runner.runHooks('post_round', makeHookContext())

      expect(results).toHaveLength(2)
      expect(results[0].success).toBe(false)
      expect(results[0].error).toContain('Exit code 1')
      expect(results[1].success).toBe(true)
    })
  })

  describe('runHooks: passes correct env vars', () => {
    it('passes JOB_ID, ROUND_INDEX, AGENT_ID, LIFECYCLE_POINT as env vars', async () => {
      skillMatcher = makeMockSkillMatcher([linterPlugin])
      runner = new SkillHookRunner(sandboxRunner, skillMatcher, policyEngine, logger)
      runner.setPluginSkills([linterPlugin])

      const context = makeHookContext({
        jobId: 'job-xyz',
        roundIndex: 3,
        agentId: 'agent-beta',
      })

      await runner.runHooks('post_round', context)

      expect(sandboxRunner.run).toHaveBeenCalledWith(
        expect.any(String),
        [],
        '/workspace/project',
        expect.objectContaining({
          env: {
            JOB_ID: 'job-xyz',
            ROUND_INDEX: '3',
            AGENT_ID: 'agent-beta',
            LIFECYCLE_POINT: 'post_round',
          },
        }),
      )
    })

    it('includes roundOutput in stdin JSON for post_round hooks', async () => {
      skillMatcher = makeMockSkillMatcher([linterPlugin])
      runner = new SkillHookRunner(sandboxRunner, skillMatcher, policyEngine, logger)
      runner.setPluginSkills([linterPlugin])

      const context = makeHookContext({
        roundOutput: { findings: ['issue-1'] },
      })

      await runner.runHooks('post_round', context)

      const stdinArg = (sandboxRunner.run as ReturnType<typeof vi.fn>).mock.calls[0][3]?.stdin
      const parsed = JSON.parse(stdinArg)

      expect(parsed.roundOutput).toEqual({ findings: ['issue-1'] })
      expect(parsed.lifecyclePoint).toBe('post_round')
    })

    it('includes synthesisOutput in stdin JSON for post_synthesis hooks', async () => {
      const postSynthPlugin = makePluginSkill('report-gen', ['post_synthesis'])
      skillMatcher = makeMockSkillMatcher([postSynthPlugin])
      runner = new SkillHookRunner(sandboxRunner, skillMatcher, policyEngine, logger)
      runner.setPluginSkills([postSynthPlugin])

      const context = makeHookContext({
        synthesisOutput: { summary: 'All good' },
      })

      await runner.runHooks('post_synthesis', context)

      const stdinArg = (sandboxRunner.run as ReturnType<typeof vi.fn>).mock.calls[0][3]?.stdin
      const parsed = JSON.parse(stdinArg)

      expect(parsed.synthesisOutput).toEqual({ summary: 'All good' })
    })
  })

  describe('runHooks: returns empty array when no hooks match', () => {
    it('returns [] when matcher finds no matching skills', async () => {
      skillMatcher = makeMockSkillMatcher([]) // no matches
      runner = new SkillHookRunner(sandboxRunner, skillMatcher, policyEngine, logger)
      runner.setPluginSkills([linterPlugin])

      const results = await runner.runHooks('pre_synthesis', makeHookContext())

      expect(results).toEqual([])
      expect(sandboxRunner.run).not.toHaveBeenCalled()
    })

    it('returns [] when no plugin skills are registered', async () => {
      skillMatcher = makeMockSkillMatcher([])
      runner = new SkillHookRunner(sandboxRunner, skillMatcher, policyEngine, logger)
      // Do not call setPluginSkills — empty by default

      const results = await runner.runHooks('pre_round', makeHookContext())

      expect(results).toEqual([])
    })
  })

  describe('setPluginSkills', () => {
    it('filters to plugin-type skills with lifecycle triggers only', async () => {
      const promptSkill: SkillDefinition = {
        id: 'prompt-only',
        version: '1.0.0',
        name: 'prompt-only',
        description: 'A prompt skill',
        skillType: 'prompt',
        source: { type: 'local', path: '/skills/prompt-only' },
        triggers: { lifecycle: ['pre_round'] },
        promptContent: 'content',
        promptSummary: 'summary',
      }

      const pluginNoLifecycle: SkillDefinition = {
        id: 'plugin-no-lifecycle',
        version: '1.0.0',
        name: 'plugin-no-lifecycle',
        description: 'Plugin without lifecycle triggers',
        skillType: 'plugin',
        source: { type: 'local', path: '/plugins/no-lc' },
        triggers: { keywords: ['test'] },
        promptContent: '',
        promptSummary: '',
      }

      skillMatcher = makeMockSkillMatcher([])
      runner = new SkillHookRunner(sandboxRunner, skillMatcher, policyEngine, logger)
      runner.setPluginSkills([promptSkill, pluginNoLifecycle, linterPlugin])

      // Verify the matcher receives only the plugin with lifecycle triggers
      await runner.runHooks('post_round', makeHookContext())

      const matcherCall = (skillMatcher.match as ReturnType<typeof vi.fn>).mock.calls[0]
      // The first argument to match() is the filtered plugin skills
      // Only linterPlugin should survive the filter
      expect(matcherCall[0]).toHaveLength(1)
      expect(matcherCall[0][0].id).toBe('linter-hook')
    })
  })
})
