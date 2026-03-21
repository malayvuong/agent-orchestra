import { describe, it, expect } from 'vitest'
import { PolicyEngine } from '../engine.js'
import { DEFAULT_POLICY } from '../system-rules.js'
import type { SkillPolicy } from '../types.js'

describe('PolicyEngine', () => {
  const engine = new PolicyEngine()

  // -------------------------------------------------------------------------
  // evaluate()
  // -------------------------------------------------------------------------

  describe('evaluate', () => {
    it('allows fs.read when rule says allow', () => {
      const policy: SkillPolicy = {
        defaultAction: 'deny',
        rules: [{ capability: 'fs.read', action: 'allow', scope: ['./src/**'] }],
        maxExecutionMs: 30_000,
        networkAllowed: false,
      }

      const result = engine.evaluate('fs.read', ['./src/index.ts'], policy)

      expect(result.action).toBe('allow')
      expect(result.matchedRule).toBeDefined()
      expect(result.matchedRule!.capability).toBe('fs.read')
      expect(result.matchedRule!.action).toBe('allow')
      expect(result.capability).toBe('fs.read')
      expect(result.requestedScope).toEqual(['./src/index.ts'])
    })

    it('denies fs.write when no rule matches (default deny)', () => {
      const policy: SkillPolicy = {
        defaultAction: 'deny',
        rules: [],
        maxExecutionMs: 30_000,
        networkAllowed: false,
      }

      const result = engine.evaluate('fs.write', ['./output.txt'], policy)

      expect(result.action).toBe('deny')
      expect(result.matchedRule).toBeUndefined()
      expect(result.reason).toContain('default action')
    })

    it('requires approval for net.http with require_approval rule', () => {
      const policy: SkillPolicy = {
        defaultAction: 'deny',
        rules: [{ capability: 'net.http', action: 'require_approval', scope: ['api.example.com'] }],
        maxExecutionMs: 30_000,
        networkAllowed: true,
      }

      const result = engine.evaluate('net.http', ['api.example.com'], policy)

      expect(result.action).toBe('require_approval')
      expect(result.matchedRule).toBeDefined()
      expect(result.matchedRule!.action).toBe('require_approval')
    })

    it('system rule blocks 127.0.0.1 even when policy says allow', () => {
      const policy: SkillPolicy = {
        defaultAction: 'deny',
        rules: [{ capability: 'net.http', action: 'allow' }],
        maxExecutionMs: 30_000,
        networkAllowed: true,
      }

      const result = engine.evaluate('net.http', ['127.0.0.1'], policy)

      expect(result.action).toBe('deny')
      expect(result.reason).toContain('SSRF protection')
      expect(result.reason).toContain('127.0.0.1')
    })

    it('system rule blocks 169.254.169.254', () => {
      const policy: SkillPolicy = {
        defaultAction: 'deny',
        rules: [{ capability: 'net.http', action: 'allow' }],
        maxExecutionMs: 30_000,
        networkAllowed: true,
      }

      const result = engine.evaluate('net.http', ['169.254.169.254'], policy)

      expect(result.action).toBe('deny')
      expect(result.reason).toContain('SSRF protection')
      expect(result.reason).toContain('169.254.169.254')
    })

    it('system rule blocks "sudo" command', () => {
      const policy: SkillPolicy = {
        defaultAction: 'deny',
        rules: [{ capability: 'proc.spawn', action: 'allow' }],
        maxExecutionMs: 30_000,
        networkAllowed: false,
      }

      const result = engine.evaluate('proc.spawn', ['sudo rm -rf /tmp'], policy)

      expect(result.action).toBe('deny')
      expect(result.reason).toContain('Dangerous command blocked')
    })

    it('system rule blocks 10.x.x.x private IPs', () => {
      const policy: SkillPolicy = {
        defaultAction: 'deny',
        rules: [{ capability: 'net.http', action: 'allow' }],
        maxExecutionMs: 30_000,
        networkAllowed: true,
      }

      const result = engine.evaluate('net.http', ['10.0.0.5'], policy)

      expect(result.action).toBe('deny')
      expect(result.reason).toContain('SSRF protection')
    })

    it('system rule blocks .env secret access', () => {
      const policy: SkillPolicy = {
        defaultAction: 'deny',
        rules: [{ capability: 'secrets.read', action: 'allow' }],
        maxExecutionMs: 30_000,
        networkAllowed: false,
      }

      const result = engine.evaluate('secrets.read', ['.env'], policy)

      expect(result.action).toBe('deny')
      expect(result.reason).toContain('Direct secret file access blocked')
    })

    it('allows capability with rule that has no scope (applies to all)', () => {
      const policy: SkillPolicy = {
        defaultAction: 'deny',
        rules: [{ capability: 'fs.read', action: 'allow' }],
        maxExecutionMs: 30_000,
        networkAllowed: false,
      }

      const result = engine.evaluate('fs.read', ['/any/path/file.ts'], policy)

      expect(result.action).toBe('allow')
    })

    it('uses first matching rule when multiple rules match', () => {
      const policy: SkillPolicy = {
        defaultAction: 'deny',
        rules: [
          { capability: 'fs.read', action: 'deny', scope: ['./src/**'] },
          { capability: 'fs.read', action: 'allow', scope: ['./src/**'] },
        ],
        maxExecutionMs: 30_000,
        networkAllowed: false,
      }

      const result = engine.evaluate('fs.read', ['./src/index.ts'], policy)

      expect(result.action).toBe('deny')
    })
  })

  // -------------------------------------------------------------------------
  // evaluateInvocation()
  // -------------------------------------------------------------------------

  describe('evaluateInvocation', () => {
    it('returns deny for mixed capabilities where one is denied', () => {
      const policy: SkillPolicy = {
        defaultAction: 'deny',
        rules: [
          { capability: 'fs.read', action: 'allow', scope: ['./src/**'] },
          // No rule for fs.write — defaults to deny
        ],
        maxExecutionMs: 30_000,
        networkAllowed: false,
      }

      const evaluations = engine.evaluateInvocation(
        [
          { capability: 'fs.read', scope: ['./src/index.ts'] },
          { capability: 'fs.write', scope: ['./output.txt'] },
        ],
        policy,
      )

      expect(evaluations).toHaveLength(2)
      expect(evaluations[0].action).toBe('allow')
      expect(evaluations[1].action).toBe('deny')

      const overall = engine.getOverallAction(evaluations)
      expect(overall).toBe('deny')
    })

    it('returns require_approval when one capability needs approval', () => {
      const policy: SkillPolicy = {
        defaultAction: 'deny',
        rules: [
          { capability: 'fs.read', action: 'allow', scope: ['./src/**'] },
          { capability: 'net.http', action: 'require_approval', scope: ['api.example.com'] },
        ],
        maxExecutionMs: 30_000,
        networkAllowed: true,
      }

      const evaluations = engine.evaluateInvocation(
        [
          { capability: 'fs.read', scope: ['./src/index.ts'] },
          { capability: 'net.http', scope: ['api.example.com'] },
        ],
        policy,
      )

      expect(evaluations).toHaveLength(2)
      expect(evaluations[0].action).toBe('allow')
      expect(evaluations[1].action).toBe('require_approval')

      const overall = engine.getOverallAction(evaluations)
      expect(overall).toBe('require_approval')
    })

    it('returns allow when all capabilities are allowed', () => {
      const policy: SkillPolicy = {
        defaultAction: 'deny',
        rules: [
          { capability: 'fs.read', action: 'allow' },
          { capability: 'proc.spawn', action: 'allow', scope: ['npm test'] },
        ],
        maxExecutionMs: 30_000,
        networkAllowed: false,
      }

      const evaluations = engine.evaluateInvocation(
        [
          { capability: 'fs.read', scope: ['./src/index.ts'] },
          { capability: 'proc.spawn', scope: ['npm test'] },
        ],
        policy,
      )

      const overall = engine.getOverallAction(evaluations)
      expect(overall).toBe('allow')
    })
  })

  // -------------------------------------------------------------------------
  // mergePolicy()
  // -------------------------------------------------------------------------

  describe('mergePolicy', () => {
    it('skill-level rules take precedence over job-level rules', () => {
      const skillPolicy: SkillPolicy = {
        defaultAction: 'deny',
        rules: [{ capability: 'fs.read', action: 'deny', scope: ['./secrets/**'] }],
        maxExecutionMs: 10_000,
        networkAllowed: false,
      }

      const jobPolicy: SkillPolicy = {
        defaultAction: 'deny',
        rules: [{ capability: 'fs.read', action: 'allow', scope: ['./secrets/**'] }],
        maxExecutionMs: 60_000,
        networkAllowed: true,
      }

      const merged = engine.mergePolicy(skillPolicy, undefined, jobPolicy)

      // Skill-level rules come first
      expect(merged.rules[0].action).toBe('deny')
      expect(merged.rules[0].scope).toEqual(['./secrets/**'])

      // Job-level rules come second
      expect(merged.rules[1].action).toBe('allow')

      // Skill-level settings take precedence
      expect(merged.maxExecutionMs).toBe(10_000)

      // defaultAction is always deny
      expect(merged.defaultAction).toBe('deny')

      // Evaluate: skill-level deny should win (first match)
      const result = engine.evaluate('fs.read', ['./secrets/api-key'], merged)
      expect(result.action).toBe('deny')
    })

    it('returns default policy when no policies provided', () => {
      const merged = engine.mergePolicy(undefined, undefined, undefined)

      expect(merged.defaultAction).toBe('deny')
      expect(merged.rules).toEqual([])
      expect(merged.maxExecutionMs).toBe(DEFAULT_POLICY.maxExecutionMs)
      expect(merged.networkAllowed).toBe(DEFAULT_POLICY.networkAllowed)
    })

    it('merges rules from all three levels in priority order', () => {
      const skillPolicy: SkillPolicy = {
        defaultAction: 'deny',
        rules: [{ capability: 'fs.read', action: 'allow', scope: ['./src/**'] }],
        maxExecutionMs: 5_000,
        networkAllowed: false,
      }
      const skillSetPolicy: SkillPolicy = {
        defaultAction: 'deny',
        rules: [{ capability: 'fs.write', action: 'require_approval', scope: ['./src/**'] }],
        maxExecutionMs: 15_000,
        networkAllowed: false,
      }
      const jobPolicy: SkillPolicy = {
        defaultAction: 'deny',
        rules: [{ capability: 'proc.spawn', action: 'allow', scope: ['npm test'] }],
        maxExecutionMs: 60_000,
        networkAllowed: true,
      }

      const merged = engine.mergePolicy(skillPolicy, skillSetPolicy, jobPolicy)

      expect(merged.rules).toHaveLength(3)
      expect(merged.rules[0].capability).toBe('fs.read') // skill-level
      expect(merged.rules[1].capability).toBe('fs.write') // skillSet-level
      expect(merged.rules[2].capability).toBe('proc.spawn') // job-level
      expect(merged.maxExecutionMs).toBe(5_000) // skill-level wins
    })
  })

  // -------------------------------------------------------------------------
  // getOverallAction()
  // -------------------------------------------------------------------------

  describe('getOverallAction', () => {
    it('deny wins over require_approval', () => {
      const evaluations = [
        {
          action: 'allow' as const,
          capability: 'fs.read' as const,
          requestedScope: [],
          reason: '',
        },
        {
          action: 'require_approval' as const,
          capability: 'net.http' as const,
          requestedScope: [],
          reason: '',
        },
        {
          action: 'deny' as const,
          capability: 'fs.write' as const,
          requestedScope: [],
          reason: '',
        },
      ]

      expect(engine.getOverallAction(evaluations)).toBe('deny')
    })

    it('require_approval wins over allow', () => {
      const evaluations = [
        {
          action: 'allow' as const,
          capability: 'fs.read' as const,
          requestedScope: [],
          reason: '',
        },
        {
          action: 'require_approval' as const,
          capability: 'net.http' as const,
          requestedScope: [],
          reason: '',
        },
      ]

      expect(engine.getOverallAction(evaluations)).toBe('require_approval')
    })

    it('returns allow when all evaluations are allow', () => {
      const evaluations = [
        {
          action: 'allow' as const,
          capability: 'fs.read' as const,
          requestedScope: [],
          reason: '',
        },
        {
          action: 'allow' as const,
          capability: 'proc.spawn' as const,
          requestedScope: [],
          reason: '',
        },
      ]

      expect(engine.getOverallAction(evaluations)).toBe('allow')
    })

    it('returns deny for empty evaluations', () => {
      expect(engine.getOverallAction([])).toBe('deny')
    })
  })
})
