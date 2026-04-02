/**
 * Intent classifier (Phase 4).
 *
 * Lightweight rule-based intent classification to route requests
 * to the right runner mode. Supersedes the Phase 2 TaskClassifier
 * for routing purposes (TaskClassifier is still used for execution
 * guard decisions within the interactive runner).
 *
 * MVP is regex + heuristic. Future versions may use model-based
 * classification for ambiguous cases.
 */

import type { RunRequest, RunMode } from '../types/runtime.js'

export type Intent =
  | 'code_review'
  | 'code_task'
  | 'question'
  | 'automation_setup'
  | 'background_task'
  | 'verification'

export class IntentClassifier {
  classify(request: RunRequest): Intent {
    // Rule-based for MVP

    // 1. Source-based overrides
    if (request.source === 'cron') return 'automation_setup'

    // 2. Explicit mode overrides
    if (request.requestedMode === 'background') return 'background_task'
    if (request.requestedMode === 'verification') return 'verification'
    if (request.requestedMode === 'automation') return 'automation_setup'

    // 3. Content-based classification for interactive requests
    if (request.userMessage) {
      const msg = request.userMessage.toLowerCase()
      if (msg.includes('review') || msg.includes('check this code')) return 'code_review'
      if (msg.includes('schedule') || msg.includes('every') || msg.includes('cron'))
        return 'automation_setup'

      // Question detection
      if (
        /\b(what is|what are|explain|why|how does|how do|describe|show me|tell me)\b/i.test(
          request.userMessage,
        )
      ) {
        return 'question'
      }
    }

    // 4. Default: code task
    return 'code_task'
  }

  intentToMode(intent: Intent): RunMode {
    switch (intent) {
      case 'code_review':
        return 'interactive'
      case 'code_task':
        return 'interactive'
      case 'question':
        return 'interactive'
      case 'automation_setup':
        return 'automation'
      case 'background_task':
        return 'background'
      case 'verification':
        return 'verification'
    }
  }
}
