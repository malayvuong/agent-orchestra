import type { TokenEstimator } from '@agent-orchestra/core'

/**
 * A simple token estimator using a ~4 chars/token heuristic.
 * This is sufficient for CLI display purposes (counting content tokens).
 */
export const simpleTokenEstimator: TokenEstimator = {
  estimate: (text: string) => Math.ceil(text.length / 4),
}
