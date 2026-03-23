import type { Job, JobScope, JobMode } from '../types/job.js'
import type { Protocol } from '../types/protocol.js'
import type { AgentAssignment } from '../types/agent.js'
import type { ProtocolExecutionDeps } from '../types/orchestrator.js'
import type { JobStore } from '../storage/types.js'
import type { ProtocolRegistry } from '../protocols/registry.js'

/**
 * Parameters for creating a new job via the Orchestrator.
 */
export type CreateJobParams = {
  title: string
  brief: string
  mode: JobMode
  protocol: Protocol
  scope: JobScope
  targetResolution: Job['targetResolution']
  baselineSnapshot?: Job['baselineSnapshot']
  agents: AgentAssignment[]
  maxRounds?: number
  runtimeConfig?: Job['runtimeConfig']
  failurePolicy?: Job['failurePolicy']
}

/**
 * Orchestrator drives the job lifecycle.
 *
 * Spec v1.3 SS8.3 -- loads a job, resolves its protocol runner from the
 * registry, and executes the protocol. Manages status transitions:
 * draft -> running -> awaiting_decision | cancelled | failed.
 */
export class Orchestrator {
  private readonly protocolRegistry: ProtocolRegistry
  private readonly deps: ProtocolExecutionDeps

  constructor(protocolRegistry: ProtocolRegistry, deps: ProtocolExecutionDeps) {
    this.protocolRegistry = protocolRegistry
    this.deps = deps
  }

  /**
   * Run a job by ID.
   *
   * 1. Loads the job from the store
   * 2. Resolves the protocol runner
   * 3. Updates status to 'running'
   * 4. Executes the protocol
   * 5. On success: updates status to 'awaiting_decision'
   * 6. On cancel: updates status to 'cancelled'
   * 7. On error: updates status to 'failed'
   */
  async runJob(jobId: string): Promise<void> {
    const jobStore = this.deps.jobStore as JobStore

    const job = await jobStore.load(jobId)
    if (!job) {
      throw new Error(`Job not found: ${jobId}`)
    }

    const runner = this.protocolRegistry.get(job.protocol)

    await jobStore.updateStatus(job.id, 'running')

    try {
      await runner.execute(job, this.deps)
      await jobStore.updateStatus(job.id, 'awaiting_decision')
    } catch (error) {
      if (this.deps.cancellationRegistry.isCancelled(job.id)) {
        await jobStore.updateStatus(job.id, 'cancelled')
      } else {
        await jobStore.updateStatus(job.id, 'failed')
      }
      throw error
    }
  }

  /**
   * Create a new job and persist it to the store.
   *
   * The job is created with 'draft' status. Call runJob() to execute it.
   */
  async createJob(params: CreateJobParams): Promise<Job> {
    const jobStore = this.deps.jobStore as JobStore

    const job = await jobStore.create({
      title: params.title,
      brief: params.brief,
      mode: params.mode,
      protocol: params.protocol,
      scope: params.scope,
      targetResolution: params.targetResolution,
      baselineSnapshot: params.baselineSnapshot,
      agents: params.agents,
      currentRoundIndex: 0,
      maxRounds: params.maxRounds ?? 10,
      templateVersions: {},
      runtimeConfig: params.runtimeConfig ?? {
        maxConcurrentAgents: 2,
        pausePointsEnabled: false,
        synthesisConfig: {
          provider: 'architect_provider',
          rerunnable: false,
        },
      },
      decisionLog: {
        lockedConstraints: [],
        acceptedDecisions: [],
        rejectedOptions: [],
        unresolvedItems: [],
      },
      failurePolicy: params.failurePolicy,
    })

    return job
  }
}
