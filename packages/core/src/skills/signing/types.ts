/**
 * Types for artifact signing and SLSA provenance (Phase F — Task 4.3).
 *
 * Supports cosign-based keyless signing via Sigstore and SLSA v1
 * provenance generation for supply-chain security.
 */

// ---------------------------------------------------------------------------
// Signature Types
// ---------------------------------------------------------------------------

/**
 * Result of signing a skill package with cosign.
 */
export type SignatureResult = {
  /** Whether signing succeeded */
  signed: boolean
  /** Absolute path to the generated .sig file */
  signaturePath: string
  /** Identity of the signer (e.g. OIDC identity from Sigstore) */
  signerIdentity: string
}

/**
 * Result of verifying a skill package signature.
 */
export type VerifyResult = {
  /** Whether the signature is valid */
  verified: boolean
  /** Identity of the signer (if verification succeeded) */
  signerIdentity?: string
  /** Error message if verification failed */
  error?: string
}

// ---------------------------------------------------------------------------
// Build Context
// ---------------------------------------------------------------------------

/**
 * Build context metadata for provenance generation.
 * Records who built the artifact, from what source, and when.
 */
export type BuildContext = {
  /** Builder identity (e.g. "github-actions", "local-dev") */
  builder: string
  /** Git commit SHA at build time */
  commitSha?: string
  /** Source repository URL */
  repoUrl?: string
  /** ISO 8601 timestamp when the build started */
  startedAt: string
  /** ISO 8601 timestamp when the build finished */
  finishedOn: string
}

// ---------------------------------------------------------------------------
// SLSA Provenance
// ---------------------------------------------------------------------------

/**
 * SLSA v1 provenance statement (in-toto Statement v1 format).
 *
 * Records the full build provenance for a skill package:
 * what was built, how it was built, and who built it.
 *
 * @see https://slsa.dev/provenance/v1
 * @see https://in-toto.io/Statement/v1
 */
export type SLSAProvenance = {
  /** In-toto statement type */
  _type: 'https://in-toto.io/Statement/v1'
  /** Subject: the artifact(s) this provenance describes */
  subject: Array<{
    name: string
    digest: { sha256: string }
  }>
  /** Predicate type: SLSA provenance v1 */
  predicateType: 'https://slsa.dev/provenance/v1'
  /** Predicate: build definition and run details */
  predicate: {
    buildDefinition: {
      /** Build type URI identifying the build system */
      buildType: string
      /** Parameters from external sources (e.g. user-specified inputs) */
      externalParameters: Record<string, unknown>
      /** Parameters determined internally by the build system */
      internalParameters: Record<string, unknown>
    }
    runDetails: {
      builder: {
        /** Builder identity URI */
        id: string
      }
      metadata: {
        /** Unique invocation ID for this build */
        invocationId: string
        /** ISO 8601 timestamp when the build started */
        startedOn: string
        /** ISO 8601 timestamp when the build finished */
        finishedOn: string
      }
    }
  }
}
