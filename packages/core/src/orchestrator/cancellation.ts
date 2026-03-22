import type { CancelHandle, CancellationRegistry } from '../interfaces/cancellation-registry.js'

/**
 * Entry tracking cancellation state and registered handles for a single job.
 */
type JobCancellationEntry = {
  cancelled: boolean
  handles: Array<{ agentId: string; handle: CancelHandle }>
}

/**
 * Default in-memory CancellationRegistry implementation.
 *
 * Spec v1.3 SS9.2 -- tracks cancel handles per job and propagates
 * cancellation to all registered handles when cancelJob() is called.
 */
export class DefaultCancellationRegistry implements CancellationRegistry {
  private readonly entries = new Map<string, JobCancellationEntry>()

  /**
   * Register a cancel handle for a specific agent within a job.
   * Creates the job entry if it does not already exist.
   */
  register(jobId: string, agentId: string, handle: CancelHandle): void {
    let entry = this.entries.get(jobId)
    if (!entry) {
      entry = { cancelled: false, handles: [] }
      this.entries.set(jobId, entry)
    }
    entry.handles.push({ agentId, handle })
  }

  /**
   * Cancel a job: mark it as cancelled and invoke all registered cancel handles.
   * Errors from individual handles are caught and logged to stderr to avoid
   * blocking the cancellation of remaining handles.
   */
  async cancelJob(jobId: string): Promise<void> {
    let entry = this.entries.get(jobId)
    if (!entry) {
      entry = { cancelled: true, handles: [] }
      this.entries.set(jobId, entry)
      return
    }

    entry.cancelled = true

    const cancelPromises = entry.handles.map(async ({ agentId, handle }) => {
      try {
        await handle.cancel()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(
          `[CancellationRegistry] Failed to cancel handle for agent ${agentId}: ${message}`,
        )
      }
    })

    await Promise.allSettled(cancelPromises)
  }

  /** Check whether a job has been cancelled. */
  isCancelled(jobId: string): boolean {
    const entry = this.entries.get(jobId)
    return entry?.cancelled ?? false
  }
}
