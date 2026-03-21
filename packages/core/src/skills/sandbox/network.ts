/**
 * Docker network management for restricted sandbox networking.
 *
 * Provides helpers to create and remove Docker networks with domain
 * allowlists. For the MVP, restricted networking logs a warning and
 * falls back to `none` — full iptables-based domain filtering requires
 * manual host configuration or a sidecar proxy.
 *
 * @module
 */

import { DockerCli } from './docker.js'

/** Shared DockerCli instance for network operations. */
const docker = new DockerCli()

/**
 * Create a Docker bridge network with restricted outbound access.
 *
 * **MVP limitation:** True domain-based allowlisting requires iptables
 * rules or a sidecar proxy on the host. This function creates a standard
 * bridge network and logs a warning. For production use, configure
 * iptables rules on the Docker host to restrict outbound traffic from
 * the created network to only the specified domains.
 *
 * @param networkName    - Name for the Docker network.
 * @param allowedDomains - Domains that should be reachable (informational for MVP).
 * @param logger         - Optional logger for warnings.
 */
export async function createRestrictedNetwork(
  networkName: string,
  allowedDomains: string[],
  logger?: { warn: (msg: string) => void },
): Promise<void> {
  const log = logger ?? console

  log.warn(
    `[sandbox/network] Restricted networking for '${networkName}' requires manual iptables ` +
      `setup on the Docker host. Allowed domains: ${allowedDomains.join(', ')}. ` +
      `Creating a standard bridge network — outbound traffic is NOT filtered by domain. ` +
      `For production, use 'none' network mode or configure host-level firewall rules.`,
  )

  const result = await docker.exec([
    'network',
    'create',
    '--driver',
    'bridge',
    '--internal',
    networkName,
  ])

  if (result.exitCode !== 0) {
    throw new Error(`Failed to create Docker network '${networkName}': ${result.stderr}`)
  }
}

/**
 * Remove a Docker network by name.
 *
 * Silently ignores errors if the network does not exist.
 *
 * @param networkName - Name of the Docker network to remove.
 */
export async function removeNetwork(networkName: string): Promise<void> {
  await docker.exec(['network', 'rm', networkName])
}
