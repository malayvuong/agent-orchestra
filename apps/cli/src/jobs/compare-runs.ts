import type { Job, Round } from '@malayvuong/agent-orchestra-core'

export type ComparableRun = {
  jobId: string
  title: string
  createdAt: string
  status: Job['status']
  convergenceFindings: number
  applyWrittenFiles: number
  finalVerdict?: string
  finalScore?: number
}

export type RunComparison = {
  basis: 'baseline_fingerprint' | 'entry_target'
  anchorJobId: string
  entryTarget?: string
  baselineFingerprint?: string
  runs: ComparableRun[]
  bestRunId?: string
}

export function buildRunComparison(
  anchorJob: Job,
  relatedJobs: Job[],
  roundsByJob: Map<string, Round[]>,
): RunComparison {
  const baselineFingerprint = anchorJob.baselineSnapshot?.fingerprint
  const basis = baselineFingerprint ? 'baseline_fingerprint' : 'entry_target'
  const entryTarget = anchorJob.targetResolution?.entryTarget

  const runs = relatedJobs
    .map((job) => {
      const rounds = roundsByJob.get(job.id) ?? []
      const convergence = rounds.find((round) => round.state === 'convergence')
      const apply = rounds.find((round) => round.state === 'apply')
      const finalCheck = rounds.find((round) => round.state === 'final_check')

      return {
        jobId: job.id,
        title: job.title,
        createdAt: job.createdAt,
        status: job.status,
        convergenceFindings: convergence?.architectOutput?.findings.length ?? 0,
        applyWrittenFiles: apply?.applySummary?.writtenFiles.length ?? 0,
        finalVerdict: finalCheck?.finalCheckSummary?.verdict,
        finalScore: finalCheck?.finalCheckSummary?.score,
      } satisfies ComparableRun
    })
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())

  const scoredRuns = runs.filter((run) => run.finalScore !== undefined)
  const bestRunId = scoredRuns.sort((left, right) => {
    const byScore = (right.finalScore ?? -1) - (left.finalScore ?? -1)
    if (byScore !== 0) return byScore
    return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  })[0]?.jobId

  return {
    basis,
    anchorJobId: anchorJob.id,
    entryTarget,
    baselineFingerprint,
    runs,
    bestRunId,
  }
}

export function selectComparableJobs(anchorJob: Job, allJobs: Job[]): Job[] {
  const baselineFingerprint = anchorJob.baselineSnapshot?.fingerprint
  if (baselineFingerprint) {
    return allJobs.filter((job) => job.baselineSnapshot?.fingerprint === baselineFingerprint)
  }

  const entryTarget = anchorJob.targetResolution?.entryTarget
  return entryTarget
    ? allJobs.filter((job) => job.targetResolution?.entryTarget === entryTarget)
    : [anchorJob]
}
