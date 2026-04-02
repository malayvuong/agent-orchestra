/**
 * Lightweight task classifier (Phase 2 bridge to Phase 4 IntentClassifier).
 *
 * Sets `executionRequired` based on message content so the execution guard
 * can make the right decision. This classifier is intentionally simple
 * (regex-based) and will be superseded by the full IntentClassifier in Phase 4.
 */

export type TaskClassification = {
  executionRequired: boolean
  allowedResponseModes: Array<'action' | 'explanation' | 'question' | 'blocker'>
}

const ACTION_VERBS =
  /\b(fix|create|deploy|run|update|build|delete|move|rename|install|add|remove|write|edit|send|schedule|stop|start|restart|implement|refactor|migrate|configure|setup|execute|change|modify|replace|patch)\b/i

const QUESTION_PATTERNS =
  /\b(what is|what are|explain|why|how does|how do|describe|show me|tell me|list|which|where is|can you explain|could you explain|what does)\b/i

export class TaskClassifier {
  classify(message: string): TaskClassification {
    if (!message || message.trim().length === 0) {
      return {
        executionRequired: false,
        allowedResponseModes: ['explanation', 'question'],
      }
    }

    // Question patterns take priority — asking about actions is still a question
    if (QUESTION_PATTERNS.test(message)) {
      return {
        executionRequired: false,
        allowedResponseModes: ['explanation', 'question'],
      }
    }

    if (ACTION_VERBS.test(message)) {
      return {
        executionRequired: true,
        allowedResponseModes: ['action', 'blocker'],
      }
    }

    // Default: not actionable (safe fallback — guard won't block explanations)
    return {
      executionRequired: false,
      allowedResponseModes: ['explanation', 'action', 'question'],
    }
  }
}
