import { SuperpowerCatalog } from './catalog.js'

/**
 * Factory function that creates a SuperpowerCatalog pre-loaded with
 * built-in superpowers.
 *
 * Future: this could merge user-defined superpowers from a workspace
 * configuration file (e.g., .agent-orchestra/superpowers.yaml).
 */
export function loadSuperpowerCatalog(): SuperpowerCatalog {
  return new SuperpowerCatalog()
}
