import { describe, it, expect } from 'vitest'
import { IntentClassifier } from '../intent-classifier.js'
import type { Intent } from '../intent-classifier.js'
import type { RunRequest, RunMode } from '../../types/runtime.js'

describe('IntentClassifier', () => {
  const classifier = new IntentClassifier()

  const makeRequest = (overrides?: Partial<RunRequest>): RunRequest => ({
    source: 'chat',
    sessionId: 'sess-1',
    actorId: 'user-1',
    trustedMeta: {},
    requestedMode: 'interactive',
    ...overrides,
  })

  // ─── Source-based classification ──────────────────────────────

  it('should classify cron source as automation_setup', () => {
    const result = classifier.classify(makeRequest({ source: 'cron' }))
    expect(result).toBe('automation_setup')
  })

  // ─── Mode-based overrides ─────────────────────────────────────

  it('should classify requestedMode background as background_task', () => {
    const result = classifier.classify(makeRequest({ requestedMode: 'background' }))
    expect(result).toBe('background_task')
  })

  it('should classify requestedMode verification as verification', () => {
    const result = classifier.classify(makeRequest({ requestedMode: 'verification' }))
    expect(result).toBe('verification')
  })

  it('should classify requestedMode automation as automation_setup', () => {
    const result = classifier.classify(makeRequest({ requestedMode: 'automation' }))
    expect(result).toBe('automation_setup')
  })

  // ─── Content-based classification ─────────────────────────────

  it('should classify "review" in message as code_review', () => {
    const result = classifier.classify(makeRequest({ userMessage: 'Please review this PR' }))
    expect(result).toBe('code_review')
  })

  it('should classify "check this code" as code_review', () => {
    const result = classifier.classify(makeRequest({ userMessage: 'check this code for bugs' }))
    expect(result).toBe('code_review')
  })

  it('should classify "schedule" in message as automation_setup', () => {
    const result = classifier.classify(makeRequest({ userMessage: 'schedule a daily backup' }))
    expect(result).toBe('automation_setup')
  })

  it('should classify "every" in message as automation_setup', () => {
    const result = classifier.classify(makeRequest({ userMessage: 'run this every 5 minutes' }))
    expect(result).toBe('automation_setup')
  })

  it('should classify "cron" in message as automation_setup', () => {
    const result = classifier.classify(makeRequest({ userMessage: 'set up a cron job for lint' }))
    expect(result).toBe('automation_setup')
  })

  // ─── Question detection ───────────────────────────────────────

  it('should classify "what is" as question', () => {
    const result = classifier.classify(
      makeRequest({ userMessage: 'what is dependency injection?' }),
    )
    expect(result).toBe('question')
  })

  it('should classify "explain" as question', () => {
    const result = classifier.classify(makeRequest({ userMessage: 'explain this function' }))
    expect(result).toBe('question')
  })

  it('should classify "how does" as question', () => {
    const result = classifier.classify(makeRequest({ userMessage: 'how does the event bus work?' }))
    expect(result).toBe('question')
  })

  it('should classify "why" as question', () => {
    const result = classifier.classify(makeRequest({ userMessage: 'why is this test failing?' }))
    expect(result).toBe('question')
  })

  it('should classify "describe" as question', () => {
    const result = classifier.classify(makeRequest({ userMessage: 'describe the architecture' }))
    expect(result).toBe('question')
  })

  it('should classify "show me" as question', () => {
    const result = classifier.classify(makeRequest({ userMessage: 'show me the config' }))
    expect(result).toBe('question')
  })

  it('should classify "tell me" as question', () => {
    const result = classifier.classify(
      makeRequest({ userMessage: 'tell me about the build process' }),
    )
    expect(result).toBe('question')
  })

  it('should classify "what are" as question', () => {
    const result = classifier.classify(
      makeRequest({ userMessage: 'what are the available commands?' }),
    )
    expect(result).toBe('question')
  })

  it('should classify "how do" as question', () => {
    const result = classifier.classify(
      makeRequest({ userMessage: 'how do I configure providers?' }),
    )
    expect(result).toBe('question')
  })

  // ─── Default classification ───────────────────────────────────

  it('should default to code_task for generic messages', () => {
    const result = classifier.classify(makeRequest({ userMessage: 'fix the login bug' }))
    expect(result).toBe('code_task')
  })

  it('should default to code_task when no userMessage', () => {
    const result = classifier.classify(makeRequest({ userMessage: undefined }))
    expect(result).toBe('code_task')
  })

  // ─── Priority: source > mode > content ────────────────────────

  it('should prioritize cron source over content', () => {
    const result = classifier.classify(
      makeRequest({
        source: 'cron',
        userMessage: 'what is this?',
      }),
    )
    expect(result).toBe('automation_setup')
  })

  it('should prioritize requestedMode over content', () => {
    const result = classifier.classify(
      makeRequest({
        requestedMode: 'background',
        userMessage: 'review this code',
      }),
    )
    expect(result).toBe('background_task')
  })

  // ─── intentToMode mapping ─────────────────────────────────────

  describe('intentToMode', () => {
    const cases: Array<[Intent, RunMode]> = [
      ['code_review', 'interactive'],
      ['code_task', 'interactive'],
      ['question', 'interactive'],
      ['automation_setup', 'automation'],
      ['background_task', 'background'],
      ['verification', 'verification'],
    ]

    for (const [intent, expectedMode] of cases) {
      it(`should map ${intent} to ${expectedMode}`, () => {
        expect(classifier.intentToMode(intent)).toBe(expectedMode)
      })
    }
  })
})
