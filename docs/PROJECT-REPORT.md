# Agent Orchestra -- Project Scan Report

**Generated:** 2026-03-22
**Scan tool:** Automated project analysis
**Repository:** `nicemvp/agent-orchestra`

---

## 1. Executive Summary

Agent Orchestra is an AI agent orchestration platform for multi-agent code review and planning. It runs multiple LLM agents through structured review protocols (architect analysis, reviewer feedback, rebuttal, synthesis) with a skills/skillset system that lets agents load specialized capabilities via an open standard.

### Key Metrics

| Metric | Value |
|--------|-------|
| TypeScript source files | 154 |
| Test files | 45 |
| Source lines (non-test) | 12,571 |
| Test lines | 12,151 |
| Total tests | 632 (623 passing, 9 skipped) |
| Test files passing | 44 of 45 (1 skipped) |
| Packages (workspace) | 7 (4 library packages + 2 apps + 1 root) |
| Resolved dependencies | 296 |
| Commits | 16 |
| Build status | Passing (all packages) |
| Lint status | Clean (zero warnings) |
| Known vulnerabilities | 0 |
| Project size (source) | ~6 MB (126 MB with node_modules) |
| License | MIT |
| Node.js | >= 20.0.0 |
| Package manager | pnpm 9.15.4 |
| Test runner | Vitest 4.1.0 |
| Build tool | tsup 8.5.1 |

**Current status:** All core functionality is implemented and tested. The project is pre-release (v0.0.1) and has not yet been published to npm or deployed to GitHub Actions CI. All tests pass, the build is clean, and lint reports zero issues.

---

## 2. Architecture Overview

### 2.1 Monorepo Structure

Agent Orchestra uses a pnpm workspace monorepo with the following layout:

```
agent-orchestra/
  packages/
    shared/          @agent-orchestra/shared      (constants, errors, utilities)
    core/            @agent-orchestra/core        (engine, skills, protocols, storage)
    providers/       @agent-orchestra/providers   (LLM provider adapters)
    registry/        @agent-orchestra/registry    (skill registry, lockfile, installer)
  apps/
    cli/             @agent-orchestra/cli         (CLI application)
    server/          @agent-orchestra/server      (HTTP API server)
  tests/
    security/        (cross-cutting security tests)
  docs/              (specs, work packages, skill documentation)
```

### 2.2 Package Dependency Graph

```
@agent-orchestra/shared          (no internal dependencies)
       |
       v
@agent-orchestra/core            (depends on: shared, yaml)
       |
       v
@agent-orchestra/providers       (depends on: core, shared)
@agent-orchestra/registry        (depends on: core, shared, yaml)
       |
       v
@agent-orchestra/cli             (depends on: core, providers, registry, shared, commander)
@agent-orchestra/server          (depends on: core, shared)
```

### 2.3 Key Design Patterns

- **Protocol-driven orchestrator:** The `Orchestrator` class delegates review execution to protocol runners registered in a `ProtocolRegistry`. The `single_challenger` protocol is fully implemented (architect -> reviewer -> rebuttal -> synthesis).
- **Skill injection with progressive disclosure:** Skills are discovered from the workspace, matched to agents by trigger conditions (lens, role, keyword, lifecycle), and injected into the LLM prompt context. When token budget is tight, full content degrades gracefully to summaries.
- **Capability-based policy engine:** A deny-by-default policy engine evaluates capability requests (`fs.read`, `fs.write`, `net.http`, `proc.spawn`, `secrets.read`) against configured rules and non-overridable system rules.
- **Event-driven architecture:** An `EventBus` emits typed events (`job:update`, `round:start`, `round:complete`, `agent:output:end`, `synthesis:ready`, `error`) that drive both CLI output and persistent event logging.
- **File-based storage:** Jobs and rounds are persisted as JSON files under `.agent-orchestra/jobs/` and `.agent-orchestra/rounds/`, with NDJSON event logs for audit trails.

---

## 3. Package Inventory

| Package | Version | Description | Source Files | Test Files | Lines of Code |
|---------|---------|-------------|:------------:|:----------:|:-------------:|
| `@agent-orchestra/shared` | 0.0.1 | Shared constants, errors, and utilities | 3 | 0 | 48 |
| `@agent-orchestra/core` | 0.0.1 | Core engine -- types, skills, protocols, storage, templates, orchestrator | 78 | 31 | 8,986 |
| `@agent-orchestra/providers` | 0.0.1 | LLM provider adapters (OpenAI, Anthropic) | 6 | 2 | 583 |
| `@agent-orchestra/registry` | 0.0.1 | Skill registry, lockfile, and installation management | 6 | 5 | 1,039 |
| `@agent-orchestra/cli` | 0.0.1 | CLI application with commander.js | 8 | 2 | 1,705 |
| `@agent-orchestra/server` | 0.0.1 | HTTP API server (Node.js http module) | 1 | 0 | 143 |
| Security tests (root) | -- | Cross-cutting security test suite | 0 | 5 | 741 |

### Key Exports by Package

**@agent-orchestra/shared:**
- `DEFAULT_STORAGE_DIR`, `DEFAULT_RUNTIME_CONFIG` -- configuration constants
- `AgentOrchestraError`, `NotImplementedError`, `SandboxUnavailableError` -- error classes

**@agent-orchestra/core:**
- Types: `Job`, `Finding`, `AgentAssignment`, `AgentLens`, `Protocol`, `SkillDefinition`, `SkillSet`
- Skills: `SkillParser`, `SkillLoader`, `SkillMatcher`, `SkillInjector`, `SkillSetLoader`
- Policy: `PolicyEngine`, `loadPolicyConfig`, `SYSTEM_RULES`
- Executor: `ToolExecutor`, `ToolAuditLogger`, `ToolInvocationManager`, `ToolResultStore`
- Sandbox: `SandboxRunner`, `SandboxConfig`
- Signing: `ArtifactSigner`, `ProvenanceGenerator`
- Hooks: `HookRunner`, lifecycle hook types
- Protocols: `ProtocolRegistry`, `SingleChallengerProtocol`
- Storage: `FileJobStore`, `FileRoundStore`, `EventLogger`
- Events: `EventBus`
- Templates: `TemplateLoader`, `TemplateRenderer`
- Output: `DefaultOutputNormalizer`, `parseFindingsFromMarkdown`
- Context: `ContextBuilder`
- Orchestrator: `Orchestrator`, `DefaultCancellationRegistry`

**@agent-orchestra/providers:**
- `OpenAIProvider`, `AnthropicProvider` -- LLM adapters
- `ProviderError` -- typed error class

**@agent-orchestra/registry:**
- `LockfileManager` -- skill lockfile read/write/verify/pin
- `SkillInstaller` -- install from local path, git URL, or registry
- `RegistryClient` -- remote registry index fetching, search, update checks
- `computeDirectoryChecksum` -- SHA-256 directory checksums

---

## 4. Feature Matrix

### Phase 0: Bootstrap

| Feature | Status |
|---------|--------|
| Monorepo scaffold (pnpm workspace, tsconfig, ESLint, Prettier) | Done |
| Package structure (shared, core, providers, registry, cli, server) | Done |
| Husky + lint-staged pre-commit hooks | Done |
| Vitest test configuration | Done |
| tsup build configuration per package | Done |
| CI workflow (GitHub Actions YAML) | Scaffold only (not yet deployed) |

### Phase A: Prompt Skills

| Feature | Status |
|---------|--------|
| Task 1.1 -- Core skill types (`SkillType`, `SkillSource`, `SkillTrigger`, `SkillDefinition`) | Done |
| Task 1.2 -- SKILL.md parser (YAML frontmatter + markdown body) | Done |
| Task 1.3 -- SkillLoader (workspace discovery, `.agent-orchestra/skills/`) | Done |
| Task 1.4 -- SkillMatcher (lens, role, keyword, lifecycle matching with OR logic) | Done |
| Task 1.5 -- ContextBuilder integration with SkillInjector | Done |
| Task 1.6 -- SkillSet configuration and loader | Done |
| Task 1.7 -- CLI commands for skills inspection (`list`, `show`, `match`) | Done |
| Task 1.8 -- Integration tests for full skill pipeline | Done |
| Task 1.9 -- Seed skills and documentation | Done |

### Phase B: Local Registry

| Feature | Status |
|---------|--------|
| Lockfile manager (`skills.lock` read/write/verify) | Done |
| Skill installer (local path, git URL sources) | Done |
| Directory checksum computation (SHA-256) | Done |
| CLI `install`, `remove`, `verify`, `pin` commands | Done |

### Phase C: Read-Only Tools

| Feature | Status |
|---------|--------|
| MCP client (stdio, SSE, streamable-http transports) | Done |
| Tool executor with timeout and abort signal support | Done |
| Tool invocation manager (job-scoped invocation tracking) | Done |
| Tool result store (artifact persistence) | Done |
| Tool audit logger (NDJSON audit trail with query) | Done |
| Environment variable sanitizer (secret filtering) | Done |

### Phase D: Permissioning

| Feature | Status |
|---------|--------|
| Policy engine (deny-by-default, rule matching) | Done |
| Scope matcher (glob-based scope evaluation) | Done |
| Trust tier system (official, verified, community) | Done |
| Policy config loader (YAML-based `policy.yaml`) | Done |
| Non-overridable system rules (SSRF, dangerous commands, secrets) | Done |
| CLI `policy show`, `policy eval`, `policy init` commands | Done |

### Phase E: Remote Marketplace

| Feature | Status |
|---------|--------|
| Registry client (index fetching with ETag caching) | Done |
| Search with filters (type, tier, lens, query) | Done |
| Update checking (version comparison) | Done |
| Status checking (deprecation, yank detection) | Done |
| CLI `search`, `update`, `rollback`, `status` commands | Done |
| Registry repo deployment | Not started |

### Phase F: Sandbox and Signing

| Feature | Status |
|---------|--------|
| Sandbox configuration types (Docker, resource limits, mounts) | Done |
| Sandbox runner (container lifecycle management) | Done |
| Network policy enforcement (none / restricted modes) | Done |
| Artifact signing (cosign/Sigstore keyless) | Done |
| SLSA provenance generation | Done |
| Plugin lifecycle hooks (`pre_round`, `post_round`, `pre_synthesis`, `post_synthesis`) | Done |
| Security incident template | Done |
| Deprecation types and rollback CLI | Done |

### Core Engine

| Feature | Status |
|---------|--------|
| E1.1 -- Storage layer (FileJobStore, FileRoundStore) | Done |
| E1.2 -- EventBus (typed pub/sub) | Done |
| E1.3 -- Prompt templates (loader, renderer, 4 defaults) | Done |
| Orchestrator (job creation, protocol dispatch) | Done |
| Single Challenger protocol (4-round flow) | Done |
| Output normalizer and finding parser | Done |
| Cancellation registry (abort signal propagation) | Done |
| Context builder with budget management | Done |

---

## 5. CLI Command Reference

| Command | Options | Description |
|---------|---------|-------------|
| `run` | `--target <path>` (required), `--provider <name>` (default: openai), `--model <model>` (default: gpt-4o), `--lens <lens>` (default: logic), `--brief <text>`, `--protocol <name>` (default: single_challenger), `--path <path>` | Run a multi-agent code review through the orchestrator |
| `job list` | `--path <path>` | List all review jobs with status, protocol, and creation date |
| `job show <id>` | `--path <path>` | Show job details (agents, scope, rounds). Supports partial ID matching |
| `skills list` | `--path <path>` | List all loaded skills with version, trigger type, and source path |
| `skills show <id>` | `--path <path>` | Show skill details including token counts and summary |
| `skills match` | `--lens <lens>`, `--role <role>` (default: reviewer), `--brief <text>`, `--path <path>` | Simulate skill matching for a given agent configuration |
| `skills search <query>` | `--type <type>`, `--tier <tier>` | Search the remote skill registry with optional filters |
| `skills install <source>` | `--path <path>` | Install a skill from local path, git URL, or registry ID (supports `name@version`) |
| `skills remove <id>` | `--path <path>` | Remove an installed skill and update lockfile |
| `skills update [id]` | `--path <path>` | Check for and apply remote updates to installed skills |
| `skills verify` | `--path <path>` | Verify installed skill checksums against the lockfile |
| `skills pin <id>` | `--path <path>` | Pin a skill to its current version to prevent overwrite on reinstall |
| `skills rollback <id>` | `--to <version>` (required), `--path <path>` | Rollback an installed skill to a specific version from the registry |
| `skills status` | `--path <path>` | Check installed skills for deprecation or yank warnings |
| `skills validate [path]` | -- | Validate skill definitions (placeholder, not yet implemented) |
| `policy show` | `--path <path>` | Display active policy configuration and non-overridable system rules |
| `policy eval` | `--capability <cap>` (required), `--scope <scopes>`, `--path <path>` | Evaluate a capability request against the active policy |
| `policy init` | `--path <path>` | Create a default `policy.yaml` configuration file |
| `audit` | `--job <job-id>`, `--skill <skill-id>`, `--path <path>`, `-v/--verbose` | Query tool invocation audit logs filtered by job or skill |

---

## 6. API Server Endpoints

The server runs on `http://localhost:3100` (configurable via `PORT` environment variable).

| Method | Path | Description | Response |
|--------|------|-------------|----------|
| `GET` | `/` | Landing page with endpoint listing | HTML |
| `GET` | `/health` | Health check | `{ status, version, uptime }` |
| `GET` | `/api/status` | Server status with storage info | `{ version, storage, jobs, node }` |
| `GET` | `/api/jobs` | List all jobs (summary view) | `{ jobs: [{ id, title, status, protocol, createdAt }] }` |
| `GET` | `/api/jobs/:id` | Get full job details | Full job JSON |
| `OPTIONS` | `*` | CORS preflight | 204 No Content |

All JSON endpoints return `Content-Type: application/json`. CORS is enabled for all origins. The server reads job data from the `.agent-orchestra/` storage directory.

---

## 7. Test Coverage Summary

**Overall:** 632 tests across 45 test files. 623 passing, 9 skipped, 0 failing. Execution time: ~1.2 seconds.

### Tests by Area

| Area | Test File | Tests |
|------|-----------|:-----:|
| **Skills -- Core** | | |
| Skill types (contract tests) | `core/src/types/__tests__/types.test.ts` | 4 |
| Skill types (skill-specific) | `core/src/skills/__tests__/types.test.ts` | 13 |
| SKILL.md parser | `core/src/skills/__tests__/parser.test.ts` | 37 |
| Skill loader (workspace discovery) | `core/src/skills/__tests__/loader.test.ts` | 32 |
| Skill matcher (trigger matching) | `core/src/skills/__tests__/matcher.test.ts` | 46 |
| Skill injector (context injection) | `core/src/skills/__tests__/injector.test.ts` | 12 |
| SkillSet loader | `core/src/skills/__tests__/skillset-loader.test.ts` | 35 |
| Integration tests (full pipeline) | `core/src/skills/__tests__/integration.test.ts` | 8 |
| **Skills -- Executor** | | |
| Tool executor | `core/src/skills/executor/__tests__/executor.test.ts` | 21 |
| Tool invocation manager | `core/src/skills/executor/__tests__/invocation.test.ts` | 21 |
| Tool result store | `core/src/skills/executor/__tests__/store.test.ts` | 9 |
| Audit logger | `core/src/skills/executor/__tests__/audit-logger.test.ts` | 15 |
| Environment sanitizer | `core/src/skills/executor/__tests__/env-sanitizer.test.ts` | 8 |
| **Skills -- Policy** | | |
| Policy engine | `core/src/skills/policy/__tests__/engine.test.ts` | 20 |
| Scope matcher | `core/src/skills/policy/__tests__/scope-matcher.test.ts` | 33 |
| Trust tier system | `core/src/skills/policy/__tests__/trust-tier.test.ts` | 15 |
| **Skills -- Sandbox** | | |
| Sandbox runner | `core/src/skills/sandbox/__tests__/runner.test.ts` | 20 |
| **Skills -- Signing** | | |
| Artifact signer | `core/src/skills/signing/__tests__/signer.test.ts` | 8 |
| SLSA provenance | `core/src/skills/signing/__tests__/provenance.test.ts` | 9 |
| **Skills -- Hooks** | | |
| Hook runner | `core/src/skills/hooks/__tests__/hook-runner.test.ts` | 11 |
| **Protocols** | | |
| Single Challenger protocol | `core/src/protocols/__tests__/single-challenger.test.ts` | 11 |
| **Orchestrator** | | |
| Orchestrator | `core/src/orchestrator/__tests__/orchestrator.test.ts` | 6 |
| Cancellation registry | `core/src/orchestrator/__tests__/cancellation.test.ts` | 6 |
| **Context** | | |
| Context builder | `core/src/context/__tests__/context-builder.test.ts` | 19 |
| **Output** | | |
| Finding parser | `core/src/output/__tests__/finding-parser.test.ts` | 16 |
| Output normalizer | `core/src/output/__tests__/normalizer.test.ts` | 15 |
| **Events** | | |
| Event bus | `core/src/events/__tests__/event-bus.test.ts` | 6 |
| **Storage** | | |
| Job store | `core/src/storage/__tests__/job-store.test.ts` | 8 |
| Round store | `core/src/storage/__tests__/round-store.test.ts` | 6 |
| **Templates** | | |
| Template loader | `core/src/templates/__tests__/loader.test.ts` | 8 |
| Template renderer | `core/src/templates/__tests__/renderer.test.ts` | 6 |
| **Providers** | | |
| OpenAI adapter | `providers/src/__tests__/openai-adapter.test.ts` | 18 |
| Anthropic adapter | `providers/src/__tests__/anthropic-adapter.test.ts` | 15 |
| **Registry** | | |
| Lockfile manager | `registry/src/__tests__/lockfile.test.ts` | 16 |
| Skill installer | `registry/src/__tests__/installer.test.ts` | 10 |
| Registry client | `registry/src/__tests__/client.test.ts` | 17 |
| Directory checksum | `registry/src/__tests__/checksum.test.ts` | 5 |
| Registry integration | `registry/src/__tests__/integration.test.ts` | 6 |
| **CLI** | | |
| Program structure | `cli/src/__tests__/program.test.ts` | 3 |
| Skills commands | `cli/src/__tests__/skills-commands.test.ts` | 12 |
| **Security (cross-cutting)** | | |
| SSRF prevention | `tests/security/ssrf/ssrf-prevention.test.ts` | 16 |
| Sandbox escape | `tests/security/sandbox-escape/sandbox-escape.test.ts` | 9 |
| Policy bypass | `tests/security/policy-bypass/policy-bypass.test.ts` | 8 |
| Timeout enforcement | `tests/security/timeout/timeout-enforcement.test.ts` | 7 |
| Environment leak | `tests/security/env-leak/env-sanitization.test.ts` | 6 |

### Tests by Package (aggregated)

| Package | Test Files | Approximate Tests |
|---------|:----------:|:-----------------:|
| `@agent-orchestra/core` | 31 | 488 |
| `@agent-orchestra/providers` | 2 | 33 |
| `@agent-orchestra/registry` | 5 | 54 |
| `@agent-orchestra/cli` | 2 | 15 |
| Security tests (root) | 5 | 46 |
| **Total** | **45** | **636 (grep count)** |

Note: The grep-based count (636) slightly exceeds the Vitest report (632) due to parameterized/conditional test registration. The Vitest-reported number (632) is authoritative.

---

## 8. Security Controls

### 8.1 Policy Engine

The policy engine enforces a **deny-by-default** capability model. All skill tool invocations must be explicitly allowed by a policy rule before execution.

**Supported capabilities:**

| Capability | Description |
|------------|-------------|
| `fs.read` | Read files from the host filesystem |
| `fs.write` | Write files to the host filesystem |
| `net.http` | Make outbound HTTP requests |
| `proc.spawn` | Spawn child processes |
| `secrets.read` | Read secret/credential files |

**Policy actions:** `allow`, `deny`, `require_approval`

### 8.2 Non-Overridable System Rules

These rules cannot be overridden by any user-defined policy configuration:

| Capability | Blocked Scopes | Reason |
|------------|---------------|--------|
| `net.http` | RFC1918 IPs (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16), loopback (127.0.0.0/8), link-local (169.254.0.0/16), metadata endpoints (169.254.169.254) | SSRF protection |
| `proc.spawn` | Destructive and escalation commands (`rm -rf`, `sudo`, `chmod`, `chown`, `mkfs`, `dd`, `kill`, etc.) | Dangerous command blocking |
| `secrets.read` | Credential files (`.env`, `credentials.json`, `*.pem`, `*.key`, `id_rsa`, `id_ed25519`, etc.) | Direct secret file access prevention |

### 8.3 Sandbox Restrictions (Docker-based)

Plugin-type skills execute in Docker containers with the following restrictions:

- `--cap-drop=ALL` -- remove all Linux capabilities
- Read-only root filesystem (`--read-only`)
- Memory limits (default: 256 MB)
- CPU quota (default: 0.5 cores)
- Network mode: `none` (no network) or `restricted` (domain allowlist only)
- Wall-clock timeout enforcement
- `/output` directory for artifact collection

### 8.4 Signing and Provenance

- **Artifact signing:** cosign/Sigstore keyless signing for skill artifacts
- **SLSA provenance:** Generates provenance attestations following the SLSA framework
- **Directory checksums:** SHA-256 checksums for installed skills, verified against `skills.lock`
- **Lockfile integrity:** `skills verify` command checks all installed skill checksums

### 8.5 Environment Sanitizer

The environment variable sanitizer filters out sensitive keys before passing environment to MCP tool processes. Variables matching patterns like `*_KEY`, `*_SECRET`, `*_TOKEN`, `*_PASSWORD`, `*_CREDENTIAL` are removed from the environment.

### 8.6 Security Test Suite

46 dedicated security tests across 5 test files (741 lines of test code) covering:
- SSRF prevention (16 tests)
- Sandbox escape prevention (9 tests)
- Policy bypass prevention (8 tests)
- Timeout enforcement (7 tests)
- Environment variable leak prevention (6 tests)

---

## 9. Dependencies

### Direct Dependencies by Package

**Root (devDependencies only):**
- `@eslint/js` ^10.0.1, `eslint` ^10.1.0, `eslint-config-prettier` ^10.1.8
- `typescript` ^5.9.3, `typescript-eslint` ^8.57.1
- `vitest` ^4.1.0, `@vitest/coverage-v8` ^4.1.0
- `tsup` ^8.5.1, `tsx` ^4.21.0
- `prettier` ^3.8.1
- `husky` ^9.1.7, `lint-staged` ^16.4.0
- `@types/node` ^25.5.0

**@agent-orchestra/shared:** (no external dependencies)

**@agent-orchestra/core:**
- `@agent-orchestra/shared` (workspace)
- `yaml` ^2.8.2

**@agent-orchestra/providers:**
- `@agent-orchestra/core` (workspace)
- `@agent-orchestra/shared` (workspace)

**@agent-orchestra/registry:**
- `@agent-orchestra/core` (workspace)
- `@agent-orchestra/shared` (workspace)
- `yaml` ^2.8.2

**@agent-orchestra/cli:**
- `@agent-orchestra/core` (workspace)
- `@agent-orchestra/providers` (workspace)
- `@agent-orchestra/registry` (workspace)
- `@agent-orchestra/shared` (workspace)
- `commander` ^13.1.0

**@agent-orchestra/server:**
- `@agent-orchestra/core` (workspace)
- `@agent-orchestra/shared` (workspace)

### Dependency Summary

| Category | Count |
|----------|:-----:|
| Total resolved (from lockfile) | 296 |
| External runtime dependencies | 2 (`yaml`, `commander`) |
| Workspace dependencies | All other cross-references |
| Known vulnerabilities (`pnpm audit`) | 0 |

The project maintains a minimal external dependency footprint. LLM provider adapters use native `fetch` (Node.js 20+) instead of third-party HTTP clients.

---

## 10. Known Limitations

1. **Anthropic provider is basic.** The Anthropic adapter sends requests via `fetch` but does not support streaming responses. It maps the Claude API response to the internal `ProviderOutput` type but does not handle `thinking` blocks, tool use, or multi-turn conversations.

2. **Web dashboard not implemented.** The server package exposes JSON API endpoints only. The landing page notes "Web dashboard coming in a future release." There is no frontend application.

3. **No real-time streaming for CLI `run` output.** The `run` command waits for each protocol round to complete before printing results. Streaming LLM token output to the terminal is not yet implemented.

4. **Registry not deployed to GitHub.** The `RegistryClient` expects a remote registry index at a GitHub raw URL. The registry repository has not been created or deployed yet. The client is fully tested against mock data.

5. **Sandbox tests require Docker.** The sandbox runner test file (20 tests) mocks Docker CLI interactions. Running actual sandboxed plugin skills requires Docker to be installed and available. No fallback execution mode exists for Docker-less environments.

6. **Only `single_challenger` protocol implemented.** The spec defines `reviewer_wave` and `reviewer_wave_with_final_check` protocols for 3+ agent topologies. Only the 2-agent `single_challenger` protocol is currently implemented.

7. **`skills validate` command is a placeholder.** The CLI registers the command but prints "Not yet implemented" when invoked.

8. **No npm publishing configuration.** Package versions are all `0.0.1` and `prepublishOnly` scripts are defined, but no `.npmrc` or publishing CI workflow is configured.

---

## 11. Recommended Next Steps

### Immediate (pre-release)

1. **Push repository to GitHub and configure CI.** The GitHub Actions workflow scaffold exists in the codebase. Deploy it with the standard matrix (Node 20/22, lint, test, build, typecheck).

2. **Test with real API keys.** Run `agent-orchestra run` against actual OpenAI (`OPENAI_API_KEY`) and Anthropic (`ANTHROPIC_API_KEY`) endpoints to validate end-to-end provider behavior beyond unit test mocks.

3. **Deploy the registry repository.** Create the `nicemvp/agent-orchestra-registry` GitHub repo with the index YAML file so that `skills search` and `skills install` from registry work against a real endpoint.

### Short-term

4. **Implement `reviewer_wave` protocol.** This unlocks 3+ agent topologies as described in the spec (v1.1 sections 2.2 and 2.3). The protocol registry and orchestrator are already designed for multiple protocol runners.

5. **Add streaming support.** Implement SSE or chunked streaming for both the OpenAI provider adapter and CLI `run` output to improve the user experience on long-running reviews.

6. **Build the web dashboard.** The server already provides the API layer. A React/Vue/Svelte frontend consuming `/api/jobs` and `/api/jobs/:id` would provide visual job inspection and finding review.

### Medium-term

7. **Publish to npm.** Configure npm publishing for `@agent-orchestra/cli`, `@agent-orchestra/core`, and sibling packages so users can install globally via `npm install -g @agent-orchestra/cli`.

8. **Add more provider adapters.** Candidates include: Google Gemini, local Ollama, AWS Bedrock, and Azure OpenAI (distinct from vanilla OpenAI for auth/endpoint differences).

9. **Implement `skills validate` command.** Parse and validate SKILL.md files against the schema, report errors, and optionally auto-fix common issues.

10. **Add code coverage reporting.** The `@vitest/coverage-v8` package is already installed as a devDependency. Configure coverage thresholds and integrate with CI reporting.

---

## Appendix: Commit History

| # | Hash (short) | Message |
|:-:|:------------:|---------|
| 16 | `c8af3ac` | feat(core): implement Storage Layer, EventBus, and Prompt Templates (E1.1-E1.3) |
| 15 | `68755dc` | Update README.md |
| 14 | `5989299` | Add skills system, CLI commands, CI/CD and tooling |
| 13 | `b2b54ab` | feat(core): implement plugin lifecycle hooks, artifact signing, and SLSA provenance (Phase F Tasks 4.2, 4.3) |
| 12 | `460c089` | feat(security): implement SECURITY.md, incident template, rollback CLI, and deprecation types (Phase F Tasks 4.6, 4.7) |
| 11 | `62cfe2f` | Initial monorepo scaffold with CLI, core, docs |
| 10 | `d11e680` | feat: add seed skills and documentation (Task 1.9) |
| 9 | `8f60a7c` | feat(core): implement Task 1.8 integration tests for full skill pipeline |
| 8 | `25c1bc0` | feat(cli): implement Task 1.7 CLI commands for skills inspection |
| 7 | `3b8b2ce` | feat(core): implement SkillSetLoader for Task 1.6 SkillSet Configuration |
| 6 | `286f17f` | feat(core): implement Task 1.5 ContextBuilder integration with SkillInjector |
| 5 | `8714006` | feat(core): implement Task 1.4 SkillMatcher with priority-based skill matching |
| 4 | `e228ea9` | feat(core): implement SkillLoader for workspace skill discovery (Task 1.3) |
| 3 | `90b37b2` | feat(core): implement Task 1.2 SKILL.md parser |
| 2 | `3fac45a` | feat(core): implement Task 1.1 -- Core Skill Types |
| 1 | `fe394b7` | Initial commit |

---

*End of report.*
