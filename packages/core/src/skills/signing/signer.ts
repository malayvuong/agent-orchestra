/**
 * SkillSigner — cosign-based artifact signing and verification.
 *
 * Phase F — Task 4.3: Signs skill packages using Sigstore's keyless mode
 * and verifies signatures at install time.
 *
 * Uses the `cosign` CLI tool for all cryptographic operations.
 * Keyless signing uses OIDC identity via Sigstore's transparency log.
 */

import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'
import type { SignatureResult, VerifyResult } from './types.js'

const execFile = promisify(execFileCb)

/** Default timeout for cosign operations (30 seconds) */
const DEFAULT_TIMEOUT_MS = 30_000

/** Logger interface for signing operations */
export interface SignerLogger {
  info: (msg: string) => void
  warn: (msg: string) => void
  error: (msg: string) => void
}

/**
 * Signs and verifies skill packages using cosign (Sigstore).
 *
 * All signing uses keyless mode — the signer authenticates via OIDC
 * and the signature is recorded in Sigstore's transparency log (Rekor).
 *
 * Verification checks the signature against Sigstore's root of trust
 * and returns the signer's OIDC identity.
 */
export class SkillSigner {
  private timeoutMs: number

  constructor(
    private logger?: SignerLogger,
    options?: { timeoutMs?: number },
  ) {
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  /**
   * Sign a skill package using cosign keyless signing.
   *
   * Generates a `.sig` file alongside the package at `<packagePath>.sig`.
   * Uses Sigstore's keyless mode (OIDC-based identity).
   *
   * @param packagePath - Absolute path to the skill package file
   * @returns Signature result with the .sig file path and signer identity
   * @throws Error if cosign is not available or signing fails
   */
  async sign(packagePath: string): Promise<SignatureResult> {
    const signaturePath = `${packagePath}.sig`

    try {
      const { stdout, stderr } = await execFile(
        'cosign',
        ['sign-blob', '--yes', packagePath, '--output-signature', signaturePath],
        { timeout: this.timeoutMs },
      )

      // Extract signer identity from cosign output
      const signerIdentity = this.extractSignerIdentity(stdout, stderr)

      this.logger?.info(`[signing] Signed ${packagePath} → ${signaturePath}`)

      return {
        signed: true,
        signaturePath,
        signerIdentity,
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      this.logger?.error(`[signing] Failed to sign ${packagePath}: ${errorMsg}`)

      return {
        signed: false,
        signaturePath: '',
        signerIdentity: '',
      }
    }
  }

  /**
   * Verify a skill package signature using cosign.
   *
   * Checks the signature against Sigstore's root of trust and
   * returns the signer's OIDC identity if verification succeeds.
   *
   * @param packagePath - Absolute path to the skill package file
   * @param signaturePath - Absolute path to the .sig file
   * @returns Verification result with verified status and signer identity
   */
  async verify(packagePath: string, signaturePath: string): Promise<VerifyResult> {
    try {
      const { stdout, stderr } = await execFile(
        'cosign',
        ['verify-blob', packagePath, '--signature', signaturePath],
        { timeout: this.timeoutMs },
      )

      const signerIdentity = this.extractSignerIdentity(stdout, stderr)

      this.logger?.info(`[signing] Verified ${packagePath}: signed by ${signerIdentity}`)

      return {
        verified: true,
        signerIdentity,
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      this.logger?.warn(`[signing] Verification failed for ${packagePath}: ${errorMsg}`)

      return {
        verified: false,
        error: errorMsg,
      }
    }
  }

  /**
   * Check if cosign is available on the system.
   *
   * Runs `cosign version` and returns true if it succeeds.
   *
   * @returns true if cosign is installed and accessible
   */
  async checkCosign(): Promise<boolean> {
    try {
      await execFile('cosign', ['version'], { timeout: 5_000 })
      return true
    } catch {
      return false
    }
  }

  /**
   * Extract the signer identity from cosign's stdout/stderr output.
   *
   * Cosign outputs the signer identity in various formats depending
   * on the signing mode. This method attempts to extract it from
   * common output patterns.
   *
   * @param stdout - cosign stdout
   * @param stderr - cosign stderr (cosign often writes info to stderr)
   * @returns The extracted signer identity, or 'unknown' if not found
   */
  private extractSignerIdentity(stdout: string, stderr: string): string {
    const combined = `${stdout}\n${stderr}`

    // Pattern 1: "Signer: <identity>"
    const signerMatch = combined.match(/[Ss]igner:\s*(.+)/)
    if (signerMatch) {
      return signerMatch[1].trim()
    }

    // Pattern 2: OIDC issuer + subject
    const subjectMatch = combined.match(/[Ss]ubject:\s*(.+)/)
    if (subjectMatch) {
      return subjectMatch[1].trim()
    }

    // Pattern 3: Email-like identity in output
    const emailMatch = combined.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/)
    if (emailMatch) {
      return emailMatch[1]
    }

    return 'unknown'
  }
}
