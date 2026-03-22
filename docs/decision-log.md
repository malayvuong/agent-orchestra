# Architecture Decision Log — Agent Orchestra Skills/Skillset System

Decisions recorded during the planning phase (2026-03-20). Extracted from the plan-report and work package restructuring process.

---

### ADR-001: Adopt Agent Skills Standard (SKILL.md) Over Proprietary Format
**Status:** Accepted | **Date:** 2026-03-20

**Context:** Multiple agent frameworks (OpenHands, Continue, Aider) are converging on a common skill format. GitHub describes Agent Skills as an "open standard" used across many AI ecosystems. Inventing a proprietary format would fragment the ecosystem and reduce community reuse.
**Decision:** Agent Orchestra will adopt the Agent Skills standard — skills as folders containing `SKILL.md` with YAML frontmatter (name, description, license, compatibility, allowed-tools) plus optional `scripts/`, `references/`, and `assets/` directories. The `skills-ref validate` tool will be used for CI-level schema checking.
**Consequences:** Skills authored for other Agent Skills-compatible systems can be loaded without conversion. Agent Orchestra must respect the standard's field semantics, even where optional fields (like `license`) are made mandatory for the marketplace. Custom extensions must not break standard compatibility.

---

### ADR-002: Risk Ladder Sequencing — Prompt, Then Tool, Then Plugin
**Status:** Accepted | **Date:** 2026-03-20

**Context:** Shipping all three skill types (prompt, tool, plugin) simultaneously would require building the permission engine, sandbox, and MCP runtime in parallel — tripling the initial scope while delaying any shipped value. Research on tool-selection hijack (ToolHijacker 2025) and sandbox escape (SANDBOXESCAPEBENCH 2026) shows each tier introduces qualitatively different risks.
**Decision:** Skills are deployed along a progressive risk ladder: Prompt Skills (context injection, zero execution) ship first, followed by Tool Skills (MCP-based, initially read-only), and finally Executable Plugin Skills (sandboxed scripts/hooks). Each tier requires its security boundary to be validated before the next tier is opened.
**Consequences:** Prompt-only skills ship in 4 weeks with no sandbox or permission infrastructure. Tool and plugin capabilities are blocked at runtime until their respective phases complete. The maturity model (ADR-012) enforces this at the registry level.

---

### ADR-003: Marketplace After Permissioning (Phase E After Phase D)
**Status:** Accepted | **Date:** 2026-03-20

**Context:** The original roadmap (M1-M4) shipped a remote marketplace (M2) before the permission engine (M3). This risked premature infrastructure burden with no real skills, created pressure to allow executable skills before security boundaries existed, and exposed format instability if the schema changed after initial learnings.
**Decision:** The remote marketplace (Phase E) is sequenced after the permission engine (Phase D). The marketplace only opens once there are 10+ real skills, 3+ contributors, and community demand.
**Consequences:** Contributors share skills via git repos or local paths during Phases A-D. The marketplace launches with a stable schema, a working policy engine, and real content — avoiding an empty registry problem. Phase E may be deferred indefinitely if local distribution meets demand.

---

### ADR-004: Dissolve Standalone Security RFC — Embed Security as Code Per Phase
**Status:** Accepted | **Date:** 2026-03-20

**Context:** A 40-page upfront Security RFC risked becoming "documentation theatre" — comprehensive on paper but disconnected from implementation reality. Security concerns differ qualitatively across skill types: prompt injection for prompt skills, SSRF for network-calling tools, and sandbox escape for plugins.
**Decision:** Instead of a standalone security phase or RFC, security deliverables are embedded in each implementation phase as actionable code: schema freeze and capability enum as TypeScript types (Phase A), checksum verification (Phase B), environment sanitization (Phase C), full policy engine with security tests (Phase D), CI gates (Phase E), and sandbox hardening with escape tests (Phase F).
**Consequences:** Every phase ships with its own security boundary tested. There is no "security phase" to delay or cut. Threat modeling is expressed as test cases, not documents. Spec amendments (required for Phase D) must be drafted during Phases A-B.

---

### ADR-005: Local Registry Before Remote Marketplace (Phase B Before Phase E)
**Status:** Accepted | **Date:** 2026-03-20

**Context:** Developers need reproducible skill installations (pinned versions, checksums) before a remote marketplace adds network-dependent distribution. The lockfile format and install workflow should be validated locally before scaling to remote fetching with caching, trust tiers, and CI pipelines.
**Decision:** Phase B implements `skills install` from local paths and git URLs, a `skills.lock` file with SHA-256 checksums, and `skills verify` — all without any remote registry. Phase E adds the remote registry client later.
**Consequences:** Skills can be shared via monorepo paths or git repos immediately. The lockfile format is proven stable before the marketplace depends on it. Contributors do not need registry access to distribute skills during early phases.

---

### ADR-006: Read-Only Tools Before Full Permissions (Phase C Before Phase D)
**Status:** Accepted | **Date:** 2026-03-20

**Context:** The MCP client, tool-calling loop, and artifact model are complex subsystems that need validation. Read-only tool skills (linters, analyzers, dependency scanners) deliver real value with minimal risk. Building the full permission engine and approval UX simultaneously would delay the first working tool skill by weeks.
**Decision:** Phase C ships MCP tool skills restricted to `fs.read` capability only, with `net.http`, `fs.write`, and `proc.spawn` denied. No approval flow is needed because read-only operations are inherently safe. The policy engine and approval UX are deferred to Phase D.
**Consequences:** The team validates MCP integration, tool-calling loop, and artifact model in isolation. Product design for the approval UX gets additional time. Write and network capabilities remain blocked until the policy engine ships in Phase D.

---

### ADR-007: Schema and Capability Enum Frozen in Phase A
**Status:** Accepted | **Date:** 2026-03-20

**Context:** If the `SkillDefinition` schema and capability taxonomy change after skills are published, it breaks lockfile checksums, registry contracts, and installed skills. Deferring the schema freeze risks "format instability" — a problem the original M1-M2 sequencing would have caused.
**Decision:** Phase A freezes the `SkillDefinition` TypeScript types, the skill type taxonomy (`prompt | tool | plugin`), and the capability enum (`fs.read | fs.write | proc.spawn | net.http | secrets.read`) as code (types and constants), not just documentation. Non-overridable SSRF rules (RFC1918/metadata block list) are also codified in Phase A.
**Consequences:** All subsequent phases build on a stable contract. The 5 real skills created in Phase A serve as a format validation suite. Schema changes after Phase A require a formal migration path for existing skills.

---

### ADR-008: MCP stdio Transport Denied by Default for Third-Party Skills
**Status:** Accepted | **Date:** 2026-03-20

**Context:** MCP stdio transport executes a local process with full access to the local filesystem, environment variables, and secrets. AutoGen explicitly warns users to only connect to trusted MCP servers, especially via stdio. A marketplace skill using stdio could exfiltrate secrets or execute arbitrary commands.
**Decision:** All MCP transports are denied by default in `SkillPolicy`. Stdio transport is allowed only for verified, first-party skills from the official registry. Third-party skills using stdio must run in a container sandbox (Phase F). SSE and Streamable HTTP transports are allowed with domain allowlist and RFC1918/localhost/metadata blocking.
**Consequences:** Third-party tool skills are effectively restricted to remote transports (SSE/HTTP) until sandbox infrastructure exists. First-party skills can use stdio for local tools like linters and test runners. The transport decision matrix is enforced by the policy engine in Phase D.

---

### ADR-009: Deny-by-Default Capability Model with Non-Overridable System Rules
**Status:** Accepted | **Date:** 2026-03-20

**Context:** Research on tool-selection injection (ToolHijacker) shows that poisoned skill metadata can steer agents toward malicious tools. The Flowise SSRF advisory (CVE-2026-31829) demonstrated that HTTP nodes without default blocking of internal IPs lead to SSRF. A permissive-by-default model would leave these attack surfaces open.
**Decision:** The `SkillPolicy` type uses `defaultAction: 'deny'` — all capabilities are blocked unless explicitly granted by a policy rule. Certain rules are non-overridable system rules: RFC1918/metadata IP blocking for `net.http`, dangerous command blocking for `proc.spawn`, and secret file blocking for `fs.read`. These cannot be relaxed by skill authors or users.
**Consequences:** Every capability a skill needs must be declared in `capabilitiesRequired` and approved by policy. Skills that request undeclared capabilities fail at runtime. The non-overridable rules provide a security floor that no configuration can lower.

---

### ADR-010: SLSA/Cosign Deferred to Phase F (Gated)
**Status:** Accepted | **Date:** 2026-03-20

**Context:** SLSA provenance, cosign signing, and OpenSSF Scorecard are enterprise-grade supply-chain security measures. They require CI infrastructure (hosted build service, signing keys, attestation storage) and are only meaningful when distributing executable artifacts to external consumers. Prompt-only and read-only tool skills do not execute untrusted code.
**Decision:** Artifact signing (cosign/Sigstore keyless), SLSA provenance generation (L1 initially, L2 when CI supports it), and OpenSSF Scorecard integration are deferred to Phase F. Phase F is gated — it only starts when a real use case requires `proc.spawn` or plugin execution and external contributors are submitting executable skills.
**Consequences:** Phases A-D ship without signing infrastructure, reducing initial scope by approximately 5 weeks and $18-30k. Checksum verification (SHA-256 in lockfile) provides integrity assurance for non-executable skills. If executable skill demand never materializes, Phase F may never be needed.

---

### ADR-011: Context Budget — Max 20% Allocation for Skills with Progressive Disclosure
**Status:** Accepted | **Date:** 2026-03-20

**Context:** Prompt-only skills consume tokens from the `ContextBudgetManager` allocation. Without a cap, skills could crowd out the actual code context, reference material, and agent instructions that drive review quality. The Agent Skills standard and OpenHands both use progressive disclosure to manage context.
**Decision:** All skills combined are capped at 20% of the total context budget (configurable via `SkillSet.contextBudgetPercent`). Within a skillset, budget is allocated proportionally by priority — trigger-matched skills get budget first. If total skill content exceeds budget, progressive disclosure applies: load a 500-token summary first, expand to full content only if the agent requests it.
**Consequences:** Skills must be written concisely to fit within budget. Always-on skills (no trigger) count against base budget; triggered skills only consume budget when activated. Skill authors are incentivized to use the summary/detail pattern rather than writing monolithic instructions.

---

### ADR-012: Skill Maturity Model (L0-L3) Gates Marketplace Distribution
**Status:** Accepted | **Date:** 2026-03-20

**Context:** Without a formal maturity model, there is no mechanism to prevent the marketplace from distributing executable plugins before the sandbox exists, or write-capable tools before the policy engine ships. The risk ladder (ADR-002) needs an enforcement mechanism.
**Decision:** Four maturity levels are defined: L0 (prompt-only, no execution), L1 (read-only tools via MCP), L2 (controlled tools with write/network, approval required), and L3 (executable plugins, sandbox required). The marketplace must not distribute skills of a higher maturity level than the runtime supports. Each level has explicit gate criteria (e.g., L0 to L1 requires 5+ real skills, stable format, 1 demo repo).
**Consequences:** The runtime's current maturity level acts as a hard cap on what the marketplace can serve. Upgrading the maturity level requires meeting gate criteria — not just shipping code. This prevents "opening the door before building the wall."

---

### ADR-013: Phases E and F Are Gated — May Never Start
**Status:** Accepted | **Date:** 2026-03-20

**Context:** Phase E (Remote Marketplace) requires 10+ real skills, 3+ contributors, and community demand. Phase F (Sandbox + Signing) requires executable skill demand from external contributors. Building infrastructure without demand wastes resources and creates maintenance burden.
**Decision:** Phases E and F have explicit start gates. If prerequisites are not met, they do not start. If the project never gets external contributors wanting executable skills, Phase F is skipped entirely — saving 5 weeks and $18-30k. The total roadmap cost of $68-110k assumes all phases; the committed cost (Phases A-D) is $40-64k.
**Consequences:** The team is not committed to building a marketplace or sandbox. Phases A-D deliver a fully functional local skill system with prompt skills, tool skills, and a permission engine. Investment in Phases E-F is a conscious decision made when evidence of demand exists.

---

### ADR-014: Spec Amendments Required Before Phase D
**Status:** Accepted | **Date:** 2026-03-20

**Context:** Three areas of spec v1.3 conflict with the skill system design: Bridge/external tool integration is deferred (section 26), the permission model is coarse-grained with only two boolean flags (section 4.10), and the `awaiting_decision` UX is undefined (section 24). Phase D (Permissioning + Approval) cannot ship without resolving these conflicts.
**Decision:** Spec amendments for sections 26, 4.10, and 24 must be drafted during Phases A-B and merged before Phase D begins. Section 26 must define a scoped "Skill Tool Runtime" separate from the general-purpose Bridge. Section 4.10 must add a `capabilities` field extending beyond `canWriteCode`/`allowReferenceScan`. Section 24 must define the decision UX contract (payload, actions, validation).
**Consequences:** Phases A-C can proceed without spec changes (prompt-only skills and read-only tools do not conflict with v1.3). Phase D is blocked until amendments merge. This creates a forcing function to resolve spec debt early rather than accumulating it.

---

### ADR-015: DCO Over CLA for Marketplace Contributions
**Status:** Accepted | **Date:** 2026-03-20

**Context:** The marketplace will receive many small PRs from community contributors adding skills. A Contributor License Agreement (CLA) creates friction — contributors must sign a legal document, often requiring employer approval. The Developer Certificate of Origin (DCO 1.1) is lighter: contributors certify their right to contribute via a `Signed-off-by` line in each commit.
**Decision:** The marketplace registry repo will use DCO (not CLA) for contributions. Contributors certify their right to contribute per DCO 1.1. Signed commits/tags are required for maintainers on critical release pipelines. The project license will be permissive (Apache-2.0 or MIT) to maximize contributor willingness.
**Consequences:** Lower barrier to entry for skill authors — no legal paperwork beyond the sign-off line. Maintainers still have signed commits for audit trail. If the project later needs stronger IP protection (e.g., for enterprise licensing), migrating from DCO to CLA is possible but disruptive.

---

### ADR-016: Superpowers Integrate at Job Composition Layer, Not Skill Execution Layer
**Status:** Accepted | **Date:** 2026-03-22

**Context:** The Superpowers feature adds curated user-facing presets (security-review, test-generation, etc.). The question is where this layer integrates: at the skill execution layer (intercepting/modifying how skills run) or at the job composition layer (resolving presets into standard job configuration before execution begins). The project already has a complete skill execution stack (skills, policy engine, sandbox, registry) and a working orchestrator with single_challenger protocol.
**Decision:** Superpowers integrate at the **job composition layer only**. A `SuperpowerResolver` converts a superpower definition into: agent assignments, skill/skillset IDs, runtime config patch, and protocol selection. These resolved values feed directly into `orchestrator.createJob()`. The existing orchestrator, protocol runner, provider adapters, normalizer, and skill injection pipeline handle execution without modification. Superpowers never touch the skill execution path, policy engine, sandbox, or provider layer.
**Consequences:** Zero churn in the execution stack — skills, policy, sandbox, and registry are untouched. Superpowers are purely declarative presets with no executable logic. Adding new superpowers requires only a catalog entry, not new runtime behavior. The resolver validates feasibility (e.g., reviewer_wave not implemented → warn and use single reviewer) but never fails silently. CLI override precedence (explicit args > preset > defaults) ensures superpowers enhance without constraining.
