import type { SkillInvocation, SkillInvocationStore } from './types.js'

/**
 * In-memory implementation of SkillInvocationStore.
 *
 * Phase C storage backend — keeps all invocations in a Map keyed by
 * invocation ID.  Suitable for single-process runs; a persistent
 * (file/database) store can replace this in later phases.
 */
export class InMemoryInvocationStore implements SkillInvocationStore {
  private readonly invocations = new Map<string, SkillInvocation>()

  /**
   * Persist (or overwrite) a skill invocation record.
   */
  save(invocation: SkillInvocation): void {
    this.invocations.set(invocation.id, { ...invocation })
  }

  /**
   * Retrieve a single invocation by its ID.
   * Returns `null` when the ID is unknown.
   */
  get(invocationId: string): SkillInvocation | null {
    const inv = this.invocations.get(invocationId)
    return inv ? { ...inv } : null
  }

  /**
   * Return every invocation that belongs to the given job,
   * ordered by creation time (earliest first).
   */
  listByJob(jobId: string): SkillInvocation[] {
    const results: SkillInvocation[] = []
    for (const inv of this.invocations.values()) {
      if (inv.jobId === jobId) {
        results.push({ ...inv })
      }
    }
    return results.sort(
      (a, b) =>
        new Date(a.timestamps.createdAt).getTime() - new Date(b.timestamps.createdAt).getTime(),
    )
  }
}
