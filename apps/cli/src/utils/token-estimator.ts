import type { TokenEstimator } from '@malayvuong/agent-orchestra-core'

/**
 * Conservative token estimator using ~3 chars/token heuristic.
 *
 * Spec v1.3 §20.5 explicitly prohibits the naive `length / 4` formula because it
 * silently underestimates for Vietnamese, code, and mixed content. The conservative
 * `length / 3` intentionally over-estimates, which is the safer failure mode: context
 * gets trimmed more aggressively rather than silently exceeding provider limits.
 *
 * For production provider calls, replace with `js-tiktoken` matched to the model's
 * tokenizer (e.g., cl100k_base for GPT-4o, similar for Claude).
 */
export const simpleTokenEstimator: TokenEstimator = {
  estimate: (text: string) => Math.ceil(text.length / 3),
}
