/** Spec v1.3 §20.5 */
export interface TokenEstimator {
  estimate(text: string): number
}
