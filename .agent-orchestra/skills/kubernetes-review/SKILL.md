---
name: Kubernetes Review
description: Deep review of Kubernetes manifests — pod security, resource limits, health probes, RBAC, network policies, and production readiness.
version: 2026.3.1
license: MIT
triggers:
  lenses:
    - security
    - performance
  keywords:
    - kubernetes
    - k8s
    - pod
    - deployment
    - helm
    - kubectl
---

When reviewing Kubernetes configuration, apply the following checks.

## Resource Limits

Verify every container defines both `resources.requests` and `resources.limits` for CPU and memory. Flag pods without resource limits — they can consume unbounded resources and starve other workloads. Check that requests are set to typical usage and limits to maximum acceptable burst.

Flag `limits.memory` set equal to `requests.memory` unless the workload has a genuinely flat memory profile — this prevents burstable memory usage. Flag CPU limits on latency-sensitive workloads — CPU throttling causes unpredictable latency spikes; consider using only requests without limits for these.

## Health Probes

Verify `livenessProbe`, `readinessProbe`, and `startupProbe` are configured for every production container. Flag liveness probes that check downstream dependencies (database, external API) — a failing dependency should not restart the pod. Liveness probes should check only the application process health.

Check that `initialDelaySeconds` is sufficient for application startup. Flag liveness probes with aggressive `periodSeconds` and `failureThreshold` that cause unnecessary restarts during brief load spikes.

Verify readiness probes actually test whether the pod can serve traffic — not just that the process is running. Flag readiness probes identical to liveness probes.

## Pod Security

Verify `securityContext.runAsNonRoot: true` is set. Flag containers running as root. Check that `readOnlyRootFilesystem: true` is set unless the application requires filesystem writes (use `emptyDir` volumes for temporary files).

Flag `privileged: true` — this gives the container full host access. Flag capabilities that are not explicitly needed — set `drop: ["ALL"]` and add back only required capabilities. Verify `allowPrivilegeEscalation: false` is set.

## RBAC

Verify ServiceAccounts are not using the `default` service account — create dedicated service accounts per workload. Flag `ClusterRoleBinding` to `cluster-admin` — this grants full cluster access. Check that Roles and RoleBindings use the principle of least privilege.

Flag ServiceAccounts with `automountServiceAccountToken: true` when the pod does not need Kubernetes API access. Verify secrets are mounted as files, not environment variables (environment variables appear in process listings and crash dumps).

## Network Policies

Verify NetworkPolicies exist for namespaces containing production workloads. Flag namespaces with no NetworkPolicy — all traffic is allowed by default. Check that ingress rules limit traffic to expected sources and egress rules prevent unexpected outbound connections.

## Deployment Strategy

Verify `strategy.type: RollingUpdate` is configured with appropriate `maxUnavailable` and `maxSurge` values. Flag deployments with `replicas: 1` in production — no redundancy. Check that `PodDisruptionBudget` is defined for critical workloads.

Verify `terminationGracePeriodSeconds` is sufficient for the application to complete in-flight requests. Flag `preStop` hooks that are missing when the application needs graceful shutdown signaling.

## Configuration

Flag hardcoded configuration values in manifests — use ConfigMaps for non-sensitive config and Secrets for credentials. Verify Secrets are not stored in plain text in the repository — use sealed-secrets, SOPS, or external secret managers.

Check that image tags use specific versions, not `latest`. Flag `imagePullPolicy: Always` with a specific tag — this defeats the purpose of versioned images.

For each finding, report: the resource kind and name, the specific Kubernetes pattern violated, and the recommended fix.
