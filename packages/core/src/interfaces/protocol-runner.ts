import type { Job } from '../types/job.js'
import type { ProtocolExecutionDeps } from '../types/orchestrator.js'

/** Spec v1.3 §8.1 */
export interface ProtocolRunner {
  execute(job: Job, deps: ProtocolExecutionDeps): Promise<void>
}
