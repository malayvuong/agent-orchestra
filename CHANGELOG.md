# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

**Core Engine**
- Orchestrator with protocol-driven job execution (spec v1.3 §8)
- `single_challenger` protocol: architect analysis → reviewer review → rebuttal → convergence
- OpenAI-compatible provider adapter (GPT-4o, Azure, local proxies) using native `fetch`
- Anthropic provider adapter (Claude Messages API)
- Two-stage OutputNormalizer: structured sections and markdown finding parser
- 4 prompt templates: architect-analysis, reviewer-by-lens, architect-rebuttal, synthesis
- File-based storage: JobStore, RoundStore, EventLogger (JSON/NDJSON, spec §11)
- Typed EventBus: job:update, round:start/complete, agent:output:end, synthesis:ready
- CancellationRegistry with AbortController integration
- ProtocolRegistry for extensible protocol runners

**Skills System (Phase A-F)**
- SKILL.md parser following Agent Skills open standard
- Skill loader with 3-path discovery (project, agent standard, user global)
- Trigger matching by lens, role, keyword, lifecycle (OR logic, priority ordering)
- Progressive disclosure with context budget management (default 20%)
- SkillSet YAML configuration
- 5 built-in skills: security-review, test-conventions, code-quality, perf-review, migration-guide

**Local Registry (Phase B)**
- `skills install` from local path or git URL
- `skills.lock` lockfile with SHA-256 checksums
- `skills verify`, `skills remove`, `skills pin` commands

**MCP Tool Runtime (Phase C)**
- MCP client with stdio and SSE transports
- Tool-calling loop (model → tool → model, max 5 iterations)
- Environment sanitization for child processes (secrets stripped)
- Tool invocation audit logging (JSONL)

**Policy Engine (Phase D)**
- Capability-based permissions: fs.read, fs.write, proc.spawn, net.http, secrets.read
- Deny-by-default with configurable policy.yaml
- Non-overridable system rules (SSRF: RFC1918/metadata blocked, dangerous commands blocked)
- Scope matching: glob (fs), CIDR (net), pattern (proc)
- Trust tier enforcement: official, verified, community, experimental
- Policy merge: skill-level → skillset-level → job-level → system-level

**Remote Marketplace (Phase E)**
- Registry client with ETag caching and semver version resolution
- `skills search`, `skills update`, remote `skills install`
- Registry repo scaffold with CI validation (validate, secret-scan, build-registry)
- JSON Schema for SKILL.md frontmatter validation

**Sandbox + Signing (Phase F)**
- Docker sandbox runner: --cap-drop=ALL, read-only rootfs, pids/memory/CPU limits, network isolation
- Plugin lifecycle hooks: pre_round, post_round, pre_synthesis, post_synthesis
- Artifact signing with cosign (Sigstore keyless)
- SLSA provenance generation (v1 statements)
- OpenSSF Scorecard workflow for registry
- Sandbox escape test suite (file access, network, resource bombs, privilege escalation)
- `skills rollback`, `skills status` commands
- SECURITY.md and incident response template

**CLI**
- `run` command: multi-agent code review with --target, --provider, --model, --lens, --brief
- `job list` and `job show` commands
- `policy show`, `policy eval`, `policy init` commands
- `audit` command for tool invocation log queries
- Global error handling with user-friendly messages
- Logger wiring for loader/parser warnings

**API Server**
- HTTP server on port 3100
- GET /health — health check
- GET /api/status — server status (version, storage, job count)
- GET /api/jobs — list all jobs
- GET /api/jobs/:id — get job details
- CORS headers for dashboard integration

**Infrastructure**
- pnpm monorepo with 6 packages (core, providers, registry, shared, cli, server)
- TypeScript strict mode with consistent-type-imports
- vitest test framework (623+ tests)
- tsup build for all packages
- ESLint + Prettier + husky pre-commit hooks
- GitHub Actions CI (Node 20 + 22) and release workflow
- CONTRIBUTING.md, SECURITY.md, decision log (15 ADRs)
