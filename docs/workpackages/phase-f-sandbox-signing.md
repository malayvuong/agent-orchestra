# Phase F — Sandbox + Signing (Gated)

> **Formerly:** M4 — Secure Execution + Supply-Chain
> **Duration:** ~5 weeks.
> **Owner:** Platform Dev (1.0 FTE) + Security Engineer (0.5 FTE) + Backend Dev (0.5 FTE support)
> **Prerequisites:** Phase E (Remote Marketplace) complete
> **Maturity level:** Unlocks L3 (Executable plugins)

---

## Gate Criteria — Do NOT Start Until Met

- [ ] At least 1 concrete use case requires `proc.spawn` or plugin execution
- [ ] External contributors are submitting executable skills
- [ ] Phase E marketplace is operational with >10 skills
- [ ] Budget approved for sandbox infrastructure (~18-30k USD)

If these gates are never met, this phase is never started — saving 5 weeks and significant cost.

---

## Objective

Enable executable plugin-type skills by adding sandbox execution, artifact signing/provenance, and supply-chain controls. After Phase F, the full skill spectrum (prompt → tool → plugin) is supported with appropriate security boundaries at each tier.

## Dependencies

| Dependency | Source | Required By |
|-----------|--------|-------------|
| M3 policy engine and MCP client | `packages/core/skills/policy/`, `packages/core/skills/executor/` | All tasks |
| M3 skill invocation model | `packages/core/skills/executor/invocation.ts` | Task 4.1, 4.2 |
| M0 Security RFC (sandbox requirements section) | `docs/rfcs/rfc-001-skill-security.md` | Task 4.1 |
| M0 Red team test plan (sandbox escape tests) | `tests/security/sandbox-escape/` | Task 4.5 |
| Docker or compatible container runtime | Host system | Task 4.1 |
| cosign (Sigstore) | External tool | Task 4.3 |
| SLSA provenance generator | External tool | Task 4.3 |

## Deliverables

1. `packages/core/skills/sandbox/` — Sandbox runner
2. `packages/core/skills/signing/` — Artifact signing and verification
3. Updated registry CI — Scorecard gates + provenance generation
4. Plugin lifecycle hooks in protocol pipeline
5. Sandbox escape test suite
6. `SECURITY.md` and disclosure process

---

## Tasks

### Task 4.1 — Sandbox Runner

**Goal:** Execute plugin-type skills in an isolated container with restricted capabilities.

**Subtasks:**

- 4.1.1 — **Create `packages/core/skills/sandbox/runner.ts`:**
  ```ts
  export type SandboxConfig = {
    /** Container image to use (default: node:20-slim) */
    image: string
    /** Memory limit in MB (default: 256) */
    memoryLimitMb: number
    /** CPU quota (0-1, default: 0.5 = half a core) */
    cpuQuota: number
    /** Filesystem mounts (read-only by default) */
    mounts: SandboxMount[]
    /** Network mode: none | restricted (allowlist) | host (NEVER for untrusted) */
    networkMode: 'none' | 'restricted'
    /** Allowed outbound domains (only if networkMode = 'restricted') */
    allowedDomains: string[]
    /** Wall-clock timeout in ms */
    timeoutMs: number
    /** Environment variables to inject (sanitized) */
    env: Record<string, string>
  }

  export type SandboxMount = {
    hostPath: string
    containerPath: string
    readOnly: boolean
  }

  export type SandboxResult = {
    exitCode: number
    stdout: string
    stderr: string
    artifacts: SandboxArtifact[]
    durationMs: number
    killed: boolean         // true if killed by timeout or OOM
    killReason?: 'timeout' | 'oom' | 'signal'
  }

  export class SandboxRunner {
    constructor(private config: SandboxConfig) {}

    /**
     * Execute a plugin skill's script inside a container.
     *
     * Flow:
     * 1. Validate config against policy
     * 2. Create container with restricted capabilities
     * 3. Mount workspace (read-only) and artifact output dir (write)
     * 4. Run script with timeout
     * 5. Collect artifacts from output dir
     * 6. Destroy container
     */
    async run(
      script: string,
      args: string[],
      workspacePath: string
    ): Promise<SandboxResult>

    /**
     * Check if Docker/container runtime is available.
     */
    async checkRuntime(): Promise<boolean>

    /**
     * Clean up any orphaned containers from previous runs.
     */
    async cleanup(): Promise<void>
  }
  ```

- 4.1.2 — **Container creation with security restrictions:**
  ```ts
  private async createContainer(config: SandboxConfig): Promise<ContainerId> {
    const dockerArgs = [
      'create',
      '--rm',                                    // auto-remove on exit
      `--memory=${config.memoryLimitMb}m`,       // memory limit
      `--cpus=${config.cpuQuota}`,               // CPU limit
      '--pids-limit=100',                        // prevent fork bomb
      '--read-only',                             // read-only root filesystem
      '--tmpfs=/tmp:rw,size=64m',                // writable /tmp (limited)
      '--no-new-privileges',                     // prevent privilege escalation
      '--cap-drop=ALL',                          // drop all Linux capabilities
      '--security-opt=no-new-privileges:true',
    ]

    // Network restrictions
    if (config.networkMode === 'none') {
      dockerArgs.push('--network=none')
    } else if (config.networkMode === 'restricted') {
      // Use custom network with iptables rules for domain allowlist
      // Implementation: create a bridge network + sidecar proxy
      // that only allows connections to allowedDomains
      dockerArgs.push(`--network=skill-restricted-${invocationId}`)
    }

    // Mounts
    for (const mount of config.mounts) {
      const ro = mount.readOnly ? ':ro' : ''
      dockerArgs.push(`-v`, `${mount.hostPath}:${mount.containerPath}${ro}`)
    }

    // Artifact output directory (writable)
    dockerArgs.push('-v', `${artifactDir}:/output:rw`)

    // Sanitized environment
    for (const [key, value] of Object.entries(config.env)) {
      dockerArgs.push('-e', `${key}=${value}`)
    }

    dockerArgs.push(config.image)
    return await this.docker('create', dockerArgs)
  }
  ```

- 4.1.3 — **Timeout enforcement:**
  ```ts
  private async runWithTimeout(containerId: string, timeoutMs: number): Promise<SandboxResult> {
    const startTime = Date.now()

    // Start container
    await this.docker('start', [containerId])

    // Wait with timeout
    const result = await Promise.race([
      this.docker('wait', [containerId]),
      this.timeout(timeoutMs).then(() => 'timeout' as const)
    ])

    if (result === 'timeout') {
      // Kill container
      await this.docker('kill', [containerId])
      return {
        exitCode: -1,
        stdout: await this.getLogs(containerId, 'stdout'),
        stderr: await this.getLogs(containerId, 'stderr'),
        artifacts: [],
        durationMs: timeoutMs,
        killed: true,
        killReason: 'timeout'
      }
    }

    // Collect results
    const durationMs = Date.now() - startTime
    const stdout = await this.getLogs(containerId, 'stdout')
    const stderr = await this.getLogs(containerId, 'stderr')
    const artifacts = await this.collectArtifacts(artifactDir)

    return { exitCode: result.exitCode, stdout, stderr, artifacts, durationMs, killed: false }
  }
  ```

- 4.1.4 — **Artifact collection from sandbox:**
  ```
  Plugin scripts write artifacts to /output/ directory inside container.
  Expected structure:
    /output/
      artifacts.json          # manifest of produced artifacts
      findings.json           # optional: parsed findings
      report.md               # optional: human-readable report
      *.log                   # optional: execution logs

  artifacts.json format:
  {
    "artifacts": [
      { "type": "finding", "file": "findings.json", "includeInContext": true },
      { "type": "report", "file": "report.md", "includeInContext": false },
      { "type": "metric", "name": "coverage", "value": "87.3%" }
    ]
  }
  ```

- 4.1.5 — **Fallback when Docker is unavailable:**
  ```ts
  if (!await this.checkRuntime()) {
    // Option 1: Reject plugin execution with clear error
    throw new SandboxUnavailableError(
      'Docker is required for plugin skill execution. ' +
      'Install Docker or use --skip-plugins flag.'
    )

    // Option 2: (future) Use WebAssembly sandbox as fallback
    // Option 3: (future) Use remote sandbox service (E2B, etc.)
  }
  ```

**Acceptance criteria:**
- [ ] Container runs with all security restrictions (dropped capabilities, read-only root, memory/CPU limits)
- [ ] Network isolation works (none mode: no network; restricted mode: allowlist only)
- [ ] Timeout kills container and collects partial results
- [ ] Artifacts collected from /output/ directory
- [ ] No host secrets leak into container
- [ ] Orphaned container cleanup works
- [ ] Clear error when Docker unavailable

**Files created:**
- `packages/core/skills/sandbox/runner.ts`
- `packages/core/skills/sandbox/runner.test.ts`
- `packages/core/skills/sandbox/docker.ts` (Docker CLI wrapper)
- `packages/core/skills/sandbox/network.ts` (restricted network setup)
- `packages/core/skills/sandbox/config.ts` (default sandbox configs by trust tier)

---

### Task 4.2 — Plugin Lifecycle Hooks

**Goal:** Integrate plugin-type skills into the protocol pipeline at defined lifecycle points.

**Subtasks:**

- 4.2.1 — **Define lifecycle hook points:**

  | Hook | When | Use Case |
  |------|------|----------|
  | `pre_round` | Before ContextBuilder runs | Prepare data, run preprocessors |
  | `post_round` | After OutputNormalizer, before ScopeGuard | Post-process findings, add metadata |
  | `pre_synthesis` | Before SynthesisEngine runs | Inject additional analysis |
  | `post_synthesis` | After synthesis complete | Generate reports, notifications |

- 4.2.2 — **Create `packages/core/skills/hooks/hook-runner.ts`:**
  ```ts
  export class SkillHookRunner {
    constructor(
      private skillLoader: SkillLoader,
      private skillMatcher: SkillMatcher,
      private sandboxRunner: SandboxRunner,
      private invocationManager: SkillInvocationManager,
      private policyEngine: PolicyEngine
    ) {}

    /**
     * Run all matching plugin hooks for a lifecycle point.
     * Hooks run sequentially in skill priority order.
     */
    async runHooks(
      lifecyclePoint: 'pre_round' | 'post_round' | 'pre_synthesis' | 'post_synthesis',
      context: HookContext
    ): Promise<HookResult[]>
  }

  export type HookContext = {
    jobId: string
    roundIndex: number
    agentId: string
    workspacePath: string
    /** Available for post_round and later hooks */
    roundOutput?: AgentOutput
    /** Available for post_synthesis hooks */
    synthesisOutput?: SynthesisResult
  }

  export type HookResult = {
    skillId: string
    success: boolean
    artifacts: SkillArtifact[]
    durationMs: number
    error?: string
  }
  ```

- 4.2.3 — **Integrate hooks into protocol pipeline:**
  ```ts
  // In ProtocolRunner:
  async executeRound(agent, job, deps) {
    // pre_round hooks
    if (deps.hookRunner) {
      await deps.hookRunner.runHooks('pre_round', { jobId: job.id, roundIndex, agentId: agent.id, workspacePath })
    }

    // ... existing round logic (context build → provider → normalize → tool calls) ...

    // post_round hooks
    if (deps.hookRunner) {
      const hookResults = await deps.hookRunner.runHooks('post_round', {
        jobId: job.id, roundIndex, agentId: agent.id, workspacePath,
        roundOutput: normalizedOutput
      })
      // Merge hook artifacts into round data
    }

    // ... scope guard → clustering ...

    // pre_synthesis hooks
    // ... synthesis ...
    // post_synthesis hooks
  }
  ```

- 4.2.4 — **Hook script contract:**
  ```
  Plugin scripts receive context via:
  1. Environment variables: JOB_ID, ROUND_INDEX, AGENT_ID, LIFECYCLE_POINT
  2. Stdin: JSON payload with round output / synthesis output (if available)
  3. Mounted workspace: read-only at /workspace/

  Plugin scripts produce output via:
  1. /output/artifacts.json — artifact manifest
  2. /output/*.json, /output/*.md — artifact files
  3. Exit code: 0 = success, non-zero = failure
  4. Stderr: error messages (captured for audit log)
  ```

**Acceptance criteria:**
- [ ] Hooks fire at correct lifecycle points
- [ ] Hooks receive appropriate context (round output for post_round, synthesis for post_synthesis)
- [ ] Hooks run in sandbox (Task 4.1)
- [ ] Hook failures do not crash the protocol round (graceful degradation)
- [ ] Hook artifacts are collected and available for subsequent steps

**Files created:**
- `packages/core/skills/hooks/hook-runner.ts`
- `packages/core/skills/hooks/hook-runner.test.ts`
- `packages/core/skills/hooks/hook-context.ts`

---

### Task 4.3 — Artifact Signing and Provenance

**Goal:** Sign skill packages with cosign and generate SLSA provenance for registry artifacts.

**Subtasks:**

- 4.3.1 — **Create `packages/core/skills/signing/signer.ts`:**
  ```ts
  export class SkillSigner {
    /**
     * Sign a skill package using cosign (keyless, via Sigstore).
     * Generates a .sig file alongside the package.
     */
    async sign(packagePath: string): Promise<SignatureResult>

    /**
     * Verify a skill package signature.
     * Returns verification result with signer identity.
     */
    async verify(packagePath: string, signaturePath: string): Promise<VerifyResult>

    /**
     * Check if cosign is available on the system.
     */
    async checkCosign(): Promise<boolean>
  }
  ```

- 4.3.2 — **SLSA provenance generation:**
  ```ts
  export class ProvenanceGenerator {
    /**
     * Generate SLSA provenance for a skill package.
     * Provenance records: who built, how built, what inputs.
     */
    async generate(skill: SkillDefinition, buildContext: BuildContext): Promise<SLSAProvenance>
  }

  export type SLSAProvenance = {
    _type: 'https://in-toto.io/Statement/v1'
    subject: [{ name: string; digest: { sha256: string } }]
    predicateType: 'https://slsa.dev/provenance/v1'
    predicate: {
      buildDefinition: {
        buildType: string
        externalParameters: Record<string, unknown>
        internalParameters: Record<string, unknown>
      }
      runDetails: {
        builder: { id: string }
        metadata: {
          invocationId: string
          startedOn: string
          finishedOn: string
        }
      }
    }
  }
  ```

- 4.3.3 — **Verification at install time:**
  ```ts
  // In RegistryClient.download():
  async download(skillId: string, version?: string): Promise<SkillPackage> {
    // ... existing download logic ...

    // Verify signature (if available)
    if (registryEntry.signature) {
      const verifyResult = await this.signer.verify(
        packagePath,
        registryEntry.signature.path
      )
      if (!verifyResult.verified) {
        throw new SignatureVerificationError(
          `Skill ${skillId}@${version}: signature verification failed`
        )
      }
      // Log verified signer identity
      this.logger.info(`${skillId}@${version}: signed by ${verifyResult.signerIdentity}`)
    } else if (registryEntry.trustTier === 'official') {
      // Official skills MUST be signed
      throw new MissingSignatureError(
        `Official skill ${skillId}@${version} is not signed — refusing to install`
      )
    }
  }
  ```

- 4.3.4 — **Registry CI: sign on publish:**
  ```yaml
  # In registry repo: .github/workflows/sign-release.yml
  name: Sign Published Skills
  on:
    push:
      tags: ['skills/*']
  jobs:
    sign:
      runs-on: ubuntu-latest
      permissions:
        id-token: write    # for keyless signing
        contents: read
      steps:
        - uses: actions/checkout@v4
        - uses: sigstore/cosign-installer@v3
        - name: Sign skill packages
          run: |
            for skill_dir in skills/*/; do
              tar -czf "${skill_dir%.*/}.tar.gz" "$skill_dir"
              cosign sign-blob --yes "${skill_dir%.*/}.tar.gz" \
                --output-signature "${skill_dir%.*/}.tar.gz.sig"
            done
        - name: Generate SLSA provenance
          uses: slsa-framework/slsa-github-generator/.github/workflows/generator_generic_slsa3.yml@v2
  ```

**Acceptance criteria:**
- [ ] Skills can be signed with cosign (keyless mode via Sigstore)
- [ ] Signatures verified at install time
- [ ] Official skills without signatures are rejected
- [ ] SLSA provenance generated for registry releases
- [ ] Provenance metadata stored alongside skill packages

**Files created:**
- `packages/core/skills/signing/signer.ts`
- `packages/core/skills/signing/signer.test.ts`
- `packages/core/skills/signing/provenance.ts`

---

### Task 4.4 — OpenSSF Scorecard Gate

**Goal:** Add Scorecard checks to the registry repo and optionally to external skill sources.

**Subtasks:**

- 4.4.1 — **Registry repo Scorecard CI:**
  ```yaml
  # .github/workflows/scorecard.yml
  name: OpenSSF Scorecard
  on:
    push: { branches: [main] }
    schedule: [{ cron: '0 6 * * 1' }]   # weekly Monday 6am

  permissions:
    security-events: write
    id-token: write

  jobs:
    scorecard:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: ossf/scorecard-action@v2
          with:
            results_file: scorecard-results.json
            publish_results: true
        - name: Upload SARIF
          uses: github/codeql-action/upload-sarif@v3
          with:
            sarif_file: scorecard-results.json
  ```

- 4.4.2 — **Minimum Scorecard thresholds:**

  | Check | Minimum Score | Rationale |
  |-------|--------------|-----------|
  | Branch-Protection | 8 | Prevent direct pushes to main |
  | Code-Review | 7 | All PRs must be reviewed |
  | Dangerous-Workflow | 9 | No untrusted code in CI |
  | Token-Permissions | 8 | Minimal CI permissions |
  | Signed-Releases | 7 | Signed artifacts |

- 4.4.3 — **Scorecard badge in registry README**

**Acceptance criteria:**
- [ ] Scorecard runs weekly on registry repo
- [ ] Results published to GitHub security tab
- [ ] Minimum thresholds documented

**Files created:** (in registry repo)
- `.github/workflows/scorecard.yml`

---

### Task 4.5 — Sandbox Escape Test Suite

**Goal:** Implement and run the sandbox escape tests from M0 Task 0.5.4.

**Subtasks:**

- 4.5.1 — **File access tests:**
  ```ts
  // tests/security/sandbox-escape/file-access.test.ts
  test('plugin cannot read host /etc/passwd', async () => {
    const result = await sandbox.run('cat /etc/passwd', [], workspacePath)
    // Container's /etc/passwd is container-local, not host
    expect(result.stdout).not.toContain('root:x:0:0')
    // OR: command fails because of read-only filesystem
  })

  test('plugin cannot write outside /output and /tmp', async () => {
    const result = await sandbox.run('touch /workspace/malicious.txt', [], workspacePath)
    expect(result.exitCode).not.toBe(0) // read-only mount
    // Verify host workspace is unchanged
  })

  test('plugin cannot access host home directory', async () => {
    const result = await sandbox.run('ls /root/.ssh/', [], workspacePath)
    expect(result.exitCode).not.toBe(0)
  })
  ```

- 4.5.2 — **Network escape tests:**
  ```ts
  test('plugin with networkMode=none cannot reach internet', async () => {
    const config = { ...defaultConfig, networkMode: 'none' as const }
    const sandbox = new SandboxRunner(config)
    const result = await sandbox.run(
      'curl -s --max-time 5 https://httpbin.org/get',
      [], workspacePath
    )
    expect(result.exitCode).not.toBe(0)
  })

  test('plugin with restricted network cannot reach non-allowlisted domain', async () => {
    const config = {
      ...defaultConfig,
      networkMode: 'restricted' as const,
      allowedDomains: ['api.example.com']
    }
    const sandbox = new SandboxRunner(config)
    const result = await sandbox.run(
      'curl -s --max-time 5 https://evil.com',
      [], workspacePath
    )
    expect(result.exitCode).not.toBe(0)
  })
  ```

- 4.5.3 — **Process/resource escape tests:**
  ```ts
  test('plugin cannot fork bomb (pids limit)', async () => {
    const result = await sandbox.run(
      'bash -c ":(){ :|:& };:"',
      [], workspacePath
    )
    // Container should be killed, not hang
    expect(result.killed).toBe(true)
  })

  test('plugin cannot exceed memory limit', async () => {
    const config = { ...defaultConfig, memoryLimitMb: 64 }
    const sandbox = new SandboxRunner(config)
    const result = await sandbox.run(
      'node -e "const a = []; while(true) a.push(Buffer.alloc(1024*1024))"',
      [], workspacePath
    )
    expect(result.killed).toBe(true)
    expect(result.killReason).toBe('oom')
  })

  test('plugin cannot escalate privileges', async () => {
    const result = await sandbox.run('sudo whoami', [], workspacePath)
    expect(result.exitCode).not.toBe(0)
  })
  ```

- 4.5.4 — **Environment leak tests:**
  ```ts
  test('plugin cannot see host SECRET_ env vars', async () => {
    process.env.SECRET_API_KEY = 'test-secret'
    const result = await sandbox.run('env | grep SECRET', [], workspacePath)
    expect(result.stdout).not.toContain('test-secret')
    delete process.env.SECRET_API_KEY
  })
  ```

**Acceptance criteria:**
- [ ] All file access escape attempts blocked
- [ ] All network escape attempts blocked
- [ ] Fork bomb and memory bomb handled (container killed)
- [ ] Privilege escalation blocked
- [ ] No host environment variables leak
- [ ] Tests run in CI (requires Docker-in-Docker or similar)

**Files created:**
- `tests/security/sandbox-escape/file-access.test.ts`
- `tests/security/sandbox-escape/network-escape.test.ts`
- `tests/security/sandbox-escape/resource-escape.test.ts`
- `tests/security/sandbox-escape/env-leak.test.ts`

---

### Task 4.6 — SECURITY.md and Disclosure Process

**Goal:** Establish public security policy and vulnerability reporting process.

**Subtasks:**

- 4.6.1 — **Create `SECURITY.md` in main repo:**
  ```markdown
  # Security Policy

  ## Supported Versions
  | Version | Supported |
  |---------|-----------|
  | 1.x     | Yes       |

  ## Reporting a Vulnerability
  Please report vulnerabilities via GitHub Private Security Advisory:
  1. Go to [repo] → Security → Advisories → New draft advisory
  2. Provide: description, reproduction steps, impact assessment
  3. Expected response: acknowledgment within 48 hours, fix timeline within 7 days

  ## Skill Security
  - All executable skills (tool, plugin) run in sandboxed environments
  - Skills from the registry are validated via CI and signed
  - Report suspicious skills via the same vulnerability reporting process

  ## Scope
  - Agent Orchestra core
  - Official registry skills (trustTier: official)
  - CLI and web dashboard
  ```

- 4.6.2 — **Create `SECURITY.md` in registry repo** (similar content, focused on skills)

- 4.6.3 — **Enable GitHub Private Security Advisories** on both repos

- 4.6.4 — **Post-incident template:**
  ```markdown
  # Security Incident Report: [SKILL-ID] [DATE]

  ## Summary
  ## Timeline
  ## Impact
  ## Root Cause
  ## Remediation
  ## Lessons Learned
  ```

**Acceptance criteria:**
- [ ] SECURITY.md in both repos
- [ ] Private Security Advisories enabled
- [ ] Post-incident template created
- [ ] Reporting process tested (create and close a test advisory)

**Files created:**
- `SECURITY.md` (main repo)
- `SECURITY.md` (registry repo)
- `docs/security/incident-template.md`

---

### Task 4.7 — Rollback CLI Commands

**Goal:** Implement CLI commands for skill rollback and deprecation management.

**Subtasks:**

- 4.7.1 — **`skills rollback <id> --to <version>`:**
  ```
  $ agent-orchestra skills rollback security-review --to 1.0.0
  Rolling back security-review: 1.1.0 → 1.0.0...
  Downloading security-review@1.0.0... done
  Verifying signature... ok
  Updated skills.lock
  Rollback complete.
  ```

- 4.7.2 — **`skills status`** (shows deprecation/yank warnings):
  ```
  $ agent-orchestra skills status
  security-review@1.1.0  [official]  OK
  old-scanner@0.5.0      [community] DEPRECATED: use security-review instead
  malicious-tool@1.0.0   [community] YANKED: CVE-2026-XXXX — remove immediately
  ```

- 4.7.3 — **Registry event polling:**
  ```ts
  // On `skills update` or `skills status`:
  // 1. Fetch latest registry.json
  // 2. Check installed skills against registry status
  // 3. Show warnings for deprecated/yanked skills
  // 4. Yanked skills: cannot re-install, existing installations warned
  ```

**Acceptance criteria:**
- [ ] Rollback to specific version works
- [ ] Status shows deprecation and yank warnings
- [ ] Yanked skills cannot be installed
- [ ] Lockfile updated on rollback

**Files modified:**
- `apps/cli/` (add commands)
- `packages/registry/client.ts` (add status checking)

---

## Exit Criteria for M4

- [ ] Sandbox runner executes plugins in Docker containers with all security restrictions
- [ ] Fork bomb, memory bomb, network escape, file access escape all blocked
- [ ] Artifact signing with cosign works end-to-end
- [ ] SLSA provenance generated for registry releases
- [ ] OpenSSF Scorecard runs weekly on registry repo
- [ ] Plugin lifecycle hooks work at all 4 lifecycle points
- [ ] Sandbox escape test suite passes (all attacks blocked)
- [ ] SECURITY.md and disclosure process established
- [ ] Rollback CLI commands work
- [ ] Full skill spectrum supported: prompt (M1) → tool (M3) → plugin (M4)
- [ ] End-to-end test: install plugin from registry → run in sandbox → collect artifacts → verify signature
