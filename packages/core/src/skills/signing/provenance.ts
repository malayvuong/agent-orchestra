/**
 * ProvenanceGenerator — generates SLSA v1 provenance statements.
 *
 * Phase F — Task 4.3.2: Records the full build provenance for skill
 * packages following the SLSA v1 / in-toto Statement v1 format.
 *
 * Provenance records: who built it, how it was built, what inputs were used.
 * This metadata is stored alongside skill packages in the registry for
 * supply-chain verification.
 */

import { writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import type { SLSAProvenance, BuildContext } from './types.js'

/** Build type URI for agent-orchestra skill builds */
const BUILD_TYPE = 'https://agent-orchestra.dev/skill-build/v1'

/**
 * Generates SLSA v1 provenance statements for skill packages.
 *
 * Provenance ties a specific artifact (identified by name + SHA-256 digest)
 * to a specific build process (builder identity, timestamps, parameters).
 *
 * The generated provenance follows the in-toto Statement v1 envelope
 * with SLSA Provenance v1 as the predicate type.
 */
export class ProvenanceGenerator {
  /**
   * Generate a SLSA v1 provenance statement for a skill package.
   *
   * @param skillId - The skill identifier (e.g. "security-review")
   * @param version - The skill version (e.g. "1.2.0")
   * @param checksum - The SHA-256 hex digest of the skill package
   * @param buildContext - Build metadata (builder, timestamps, source info)
   * @returns The complete SLSA provenance statement
   */
  generate(
    skillId: string,
    version: string,
    checksum: string,
    buildContext: BuildContext,
  ): SLSAProvenance {
    const invocationId = randomUUID()
    const artifactName = `${skillId}@${version}`

    return {
      _type: 'https://in-toto.io/Statement/v1',
      subject: [
        {
          name: artifactName,
          digest: { sha256: checksum },
        },
      ],
      predicateType: 'https://slsa.dev/provenance/v1',
      predicate: {
        buildDefinition: {
          buildType: BUILD_TYPE,
          externalParameters: {
            skillId,
            version,
            ...(buildContext.repoUrl ? { source: buildContext.repoUrl } : {}),
            ...(buildContext.commitSha ? { commit: buildContext.commitSha } : {}),
          },
          internalParameters: {
            reproducible: false,
          },
        },
        runDetails: {
          builder: {
            id: buildContext.builder,
          },
          metadata: {
            invocationId,
            startedOn: buildContext.startedAt,
            finishedOn: buildContext.finishedOn,
          },
        },
      },
    }
  }

  /**
   * Write a provenance statement to a JSON file.
   *
   * The file is written with 2-space indentation for human readability.
   * Convention: provenance files are named `<package>.provenance.json`.
   *
   * @param provenance - The SLSA provenance statement to write
   * @param outputPath - Absolute path for the output JSON file
   */
  async writeProvenance(provenance: SLSAProvenance, outputPath: string): Promise<void> {
    const json = JSON.stringify(provenance, null, 2)
    await writeFile(outputPath, json, 'utf-8')
  }
}
