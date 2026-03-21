/** Spec v1.3 §4.7 */
export type FindingScopeType = 'primary' | 'reference' | 'out_of_scope'
export type FindingActionability = 'must_fix_now' | 'note_only' | 'follow_up_candidate'
export type FindingConfidence = 'high' | 'medium' | 'low'
export type FindingEvidence = {
  files: string[]
  summary: string
  excerpts?: string[]
}
export type Finding = {
  id: string
  title: string
  description: string
  scopeType: FindingScopeType
  actionability: FindingActionability
  confidence: FindingConfidence
  evidence?: FindingEvidence
  tags?: string[]
  relatedClusterId?: string
}
