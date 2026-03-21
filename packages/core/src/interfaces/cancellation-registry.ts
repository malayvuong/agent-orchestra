/** Spec v1.3 §9.2 */
export interface CancelHandle {
  cancel(): Promise<void>
}
export interface CancellationRegistry {
  register(jobId: string, agentId: string, handle: CancelHandle): void
  cancelJob(jobId: string): Promise<void>
  isCancelled(jobId: string): boolean
}
