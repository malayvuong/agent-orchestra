import type { Job, JobStatus } from '../types/job.js'
import type { Round } from '../types/protocol.js'

/**
 * Store interface for Job persistence.
 * Storage layout: .agent-orchestra/jobs/{jobId}/job.json (spec v1.3 SS11.1)
 */
export interface JobStore {
  /** Create a new job, generating UUID and setting status to 'draft'. */
  create(job: Omit<Job, 'id' | 'createdAt' | 'updatedAt' | 'status'>): Promise<Job>

  /** Load a job by its ID. Returns undefined if not found. */
  load(jobId: string): Promise<Job | undefined>

  /** Update job status and updatedAt timestamp. */
  updateStatus(jobId: string, status: JobStatus): Promise<Job>

  /** List all jobs in storage. */
  list(): Promise<Job[]>

  /** Save (overwrite) a full job object to disk. */
  save(job: Job): Promise<void>
}

/**
 * Store interface for Round persistence.
 * Storage layout: .agent-orchestra/jobs/{jobId}/rounds/round-{index}.json (spec v1.3 SS11.1)
 */
export interface RoundStore {
  /** Save a round to disk. */
  save(round: Round): Promise<void>

  /** Load a specific round by job ID and round index. Returns undefined if not found. */
  load(jobId: string, roundIndex: number): Promise<Round | undefined>

  /** List all rounds for a given job. */
  listByJob(jobId: string): Promise<Round[]>
}
