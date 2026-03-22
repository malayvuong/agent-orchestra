import type { Superpower } from './types.js'
import { BUILTIN_SUPERPOWERS } from './builtin.js'

/**
 * SuperpowerCatalog manages the collection of available superpowers.
 * Currently loads only built-in superpowers; future versions may load
 * from workspace configuration files.
 */
export class SuperpowerCatalog {
  private readonly superpowers = new Map<string, Superpower>()

  constructor() {
    for (const sp of BUILTIN_SUPERPOWERS) {
      this.superpowers.set(sp.id, sp)
    }
  }

  /** Return all available superpowers. */
  list(): Superpower[] {
    return Array.from(this.superpowers.values())
  }

  /** Get a superpower by ID, or undefined if not found. */
  get(id: string): Superpower | undefined {
    return this.superpowers.get(id)
  }

  /** Check whether a superpower with the given ID exists in the catalog. */
  has(id: string): boolean {
    return this.superpowers.has(id)
  }
}

/**
 * Factory function that creates a SuperpowerCatalog pre-loaded with
 * built-in superpowers.
 *
 * Re-exported here for convenience; the canonical location is loader.ts.
 */
export function loadSuperpowerCatalog(): SuperpowerCatalog {
  return new SuperpowerCatalog()
}
