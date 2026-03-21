/**
 * Artifact signing and provenance — barrel exports.
 *
 * Phase F — Task 4.3: cosign-based signing/verification and SLSA v1
 * provenance generation for skill package supply-chain security.
 */

export type { SignatureResult, VerifyResult, BuildContext, SLSAProvenance } from './types.js'

export { SkillSigner } from './signer.js'
export type { SignerLogger } from './signer.js'

export { ProvenanceGenerator } from './provenance.js'
