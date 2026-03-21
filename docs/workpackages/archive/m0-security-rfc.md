# M0 — Security RFC (Parallel Track)

> **Runs in parallel with M1.** Start date: 2026-03-23. Duration: ~40 days.
> **Owner:** Security Engineer (0.5 FTE) + Backend Dev (review support)

---

## Objective

Produce a formal Security RFC that defines the threat model, capability/permission model, and spec amendments required before Agent Orchestra can safely support executable skills (M3+). This track runs in parallel with M1 to avoid security being bolted on after the fact.

## Dependencies

| Dependency | Source | Status |
|-----------|--------|--------|
| Spec v1.3-patch.md | `docs/spec-v1.3-patch.md` | Available |
| Plan report (English) | `docs/plan-report.md` | Available |
| Agent Skills standard (external) | agentskills/agentskills repo | Reference only |

## Deliverables

1. `docs/rfcs/rfc-001-skill-security.md` — Security RFC document
2. `docs/rfcs/rfc-002-spec-amendments.md` — Spec amendment proposals
3. `docs/rfcs/threat-model.md` — Threat model with attack trees
4. `tests/security/` — Red team test plan (executable in M3/M4)

---

## Tasks

### Task 0.1 — Threat Model Document

**Goal:** Document all attack surfaces for the skill system with attack trees and severity ratings.

**Subtasks:**

- 0.1.1 — **Enumerate attack surfaces** from plan-report.md section "Security Risks":
  - Prompt injection (direct/indirect) into skill content
  - Tool/skill registry poisoning (ToolHijacker pattern)
  - SSRF via skill HTTP calls (Flowise SSRF advisory pattern)
  - RCE via stdio MCP tools (AutoGen warning pattern)
  - Sandbox escape from plugin execution
  - Supply-chain attacks on skill dependencies
  - Secret exfiltration via skill artifacts
  - Context poisoning (skill injects misleading context to bias agent output)

- 0.1.2 — **Create attack trees** (Mermaid diagrams) for each surface:
  ```
  For each attack surface:
  1. Define attacker goal
  2. Map attack paths (how attacker achieves goal)
  3. Identify existing mitigations (from spec v1.3)
  4. Identify gaps (what the skill system introduces)
  5. Rate: Likelihood (1-5) × Impact (1-5) = Risk Score
  ```

- 0.1.3 — **Severity matrix:**

  | Attack Surface | Likelihood | Impact | Risk Score | Milestone Addressed |
  |---------------|-----------|--------|-----------|-------------------|
  | Prompt injection in SKILL.md | 4 | 3 | 12 | M1 (input sanitization) |
  | Registry poisoning | 3 | 5 | 15 | M2 (review process) |
  | SSRF via net.http | 4 | 4 | 16 | M3 (policy engine) |
  | RCE via stdio | 3 | 5 | 15 | M3 (transport policy) |
  | Sandbox escape | 2 | 5 | 10 | M4 (sandbox hardening) |
  | Supply-chain (malicious dep) | 3 | 5 | 15 | M4 (provenance/signing) |
  | Secret exfiltration | 3 | 5 | 15 | M3 (secrets isolation) |
  | Context poisoning | 3 | 3 | 9 | M1 (content boundaries) |

- 0.1.4 — **Write `docs/rfcs/threat-model.md`** containing:
  - Attack surface inventory
  - Attack trees (Mermaid)
  - Severity matrix
  - Mitigation mapping to milestones
  - Red team test cases (pointers to `tests/security/`)

**Acceptance criteria:**
- [ ] All 8 attack surfaces documented with attack trees
- [ ] Each surface has severity rating and milestone mapping
- [ ] Document reviewed by at least 1 backend developer

**Files created:** `docs/rfcs/threat-model.md`

---

### Task 0.2 — Capability Model Design

**Goal:** Define the fine-grained permission system that replaces the coarse `canWriteCode`/`allowReferenceScan` flags.

**Subtasks:**

- 0.2.1 — **Define capability taxonomy:**
  ```ts
  // These types will be proposed as spec amendments
  export type SkillCapability =
    | 'fs.read'       // read files within scoped paths
    | 'fs.write'      // write/create/delete files within scoped paths
    | 'proc.spawn'    // execute a process from command allowlist
    | 'net.http'      // make HTTP requests to domain allowlist
    | 'secrets.read'  // read secrets from secret manager (NOT env vars or files)

  export type CapabilityScope = {
    capability: SkillCapability
    scope: string[]   // path globs, domain patterns, command patterns
  }
  ```

- 0.2.2 — **Define policy evaluation rules:**
  ```
  1. Start with defaultAction: 'deny' (always)
  2. Check each SkillPolicyRule in order:
     a. If capability matches AND scope matches → apply action
     b. First match wins (no further rules evaluated for this capability)
  3. If no rule matches → apply defaultAction (deny)
  4. If action is 'require_approval' → transition job to awaiting_decision
  ```

- 0.2.3 — **Map to existing spec types:**
  - `canWriteCode: true` → shortcut for `{ capability: 'fs.write', action: 'allow', scope: ['**'] }`
  - `allowReferenceScan: true` → shortcut for `{ capability: 'fs.read', action: 'allow', scope: ['**'] }`
  - New capabilities have no shortcut — must be declared explicitly

- 0.2.4 — **Define default policies per skill type:**

  | Skill Type | Default Policy |
  |-----------|---------------|
  | `prompt` | No capabilities needed (context injection only) |
  | `tool` | `fs.read: allow` (scoped to job target), all others: `deny` |
  | `plugin` | All capabilities: `require_approval` |

- 0.2.5 — **Define policy merge order:**
  ```
  Effective policy = merge(
    1. Skill-level (from SkillDefinition.capabilitiesRequired)  ← declares what skill needs
    2. SkillSet-level (from SkillSet.policyOverrides)           ← project-wide overrides
    3. Job-level (from JobRuntimeConfig)                         ← per-job overrides
    4. System-level (hardcoded safety: always block metadata IPs) ← non-overridable
  )
  ```

- 0.2.6 — **Define non-overridable safety rules:**
  - `net.http` MUST block: `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.169.254`, `fd00::/8`
  - `proc.spawn` MUST block: `rm -rf /`, `sudo`, `chmod 777`, `curl | sh`, `eval`, `exec`
  - `secrets.read` MUST NOT read: `.env` files, `~/.ssh/`, `~/.aws/credentials`

**Acceptance criteria:**
- [ ] Capability taxonomy covers all skill runtime needs
- [ ] Policy evaluation algorithm is deterministic and testable
- [ ] Backward compatibility with existing `canWriteCode`/`allowReferenceScan` documented
- [ ] Non-overridable safety rules defined
- [ ] Policy merge order documented with examples

**Files created:** Section within `docs/rfcs/rfc-001-skill-security.md`

---

### Task 0.3 — Spec Amendment Proposals

**Goal:** Write formal amendment proposals for spec v1.3 sections that conflict with the skill system.

**Subtasks:**

- 0.3.1 — **Amendment A: §26 — Scoped Skill Tool Runtime**
  ```
  Current: "Bridge is NOT implemented in Phase 1"
  Proposed: Add §26.A "Skill Tool Runtime" — a scoped MCP client that:
    - Only connects to skill-declared MCP servers (not arbitrary bridges)
    - Supports 3 transports: stdio (restricted), SSE, streamable-http
    - Routes tool_calls from model output through PolicyEngine before execution
    - Returns tool results as SkillArtifact entries
    - Is NOT the general Bridge system (which remains deferred)
  ```

- 0.3.2 — **Amendment B: §4.10 — Extended AgentConfig Capabilities**
  ```
  Current: Only allowReferenceScan: boolean, canWriteCode: boolean
  Proposed: Add optional field:
    skillCapabilities?: CapabilityScope[]
    skillPolicy?: SkillPolicy
  Preserve existing boolean fields as backward-compatible shortcuts.
  ```

- 0.3.3 — **Amendment C: §24 — awaiting_decision UX Contract**
  ```
  Current: "awaiting_decision UX undefined" (listed as known gap)
  Proposed: Define AwaitingDecisionPayload type:
    - invocationId: string
    - skillId: string
    - requestedCapabilities: CapabilityScope[]
    - violatedRules: SkillPolicyRule[]
    - proposedArgs: Record<string, unknown>
    - actions: ['approve', 'edit', 'reject']
  Define response contract:
    - approve → continue execution with original args
    - edit → continue with modified args (re-validate against policy)
    - reject → log rejection, return to agent with feedback
  ```

- 0.3.4 — **Amendment D: §4.NEW — SkillArtifact Type**
  ```
  New section defining:
    SkillArtifact = { type, name, content, includeInContext }
  Relationship to Finding:
    - Artifacts of type 'finding' can be converted to Finding[] via OutputNormalizer
    - Other artifact types are stored for audit but not mixed into Finding pipeline
  Relationship to AgentOutput:
    - AgentOutput gains optional field: skillArtifacts?: SkillArtifact[]
  ```

- 0.3.5 — **Amendment E: §8.2 — ProtocolExecutionDeps Extension**
  ```
  Add to ProtocolExecutionDeps:
    skillLoader: SkillLoader
    policyEngine: PolicyEngine
    skillExecutor: SkillExecutor
  These are optional in Phase 1 (null/noop) and required when skill system is enabled.
  ```

**Acceptance criteria:**
- [ ] Each amendment has: current state, proposed change, rationale, backward compatibility note
- [ ] Amendments are self-contained (can be reviewed independently)
- [ ] No amendment breaks existing Phase 1 implementation
- [ ] TypeScript type changes are shown as diffs

**Files created:** `docs/rfcs/rfc-002-spec-amendments.md`

---

### Task 0.4 — Security RFC Document

**Goal:** Consolidate threat model, capability model, and amendments into a single RFC for team review.

**Subtasks:**

- 0.4.1 — **RFC structure:**
  ```
  # RFC-001: Skill System Security Model
  ## Status: Draft
  ## Authors: [security engineer]
  ## Reviewers: [backend devs]

  ## 1. Problem Statement
  ## 2. Threat Model (summary, link to threat-model.md)
  ## 3. Capability Model
  ## 4. Policy Engine Contract
  ## 5. MCP Transport Security
  ## 6. Sandbox Requirements
  ## 7. Supply-chain Controls
  ## 8. Incident Response Process
  ## 9. Spec Amendments Required (summary, link to rfc-002)
  ## 10. Phased Rollout (which controls in which milestone)
  ## 11. Open Questions
  ```

- 0.4.2 — **MCP Transport Security section:**
  - stdio: denied by default for third-party skills; allowed only for verified first-party skills
  - SSE/streamable-http: allowed with domain allowlist; RFC1918 blocked at system level
  - All transports: TLS required for remote; timeout enforced per `SkillPolicy.maxExecutionMs`

- 0.4.3 — **Sandbox Requirements section:**
  - Minimum sandbox spec: isolated filesystem, no host network (unless `net.http` granted), no host secrets
  - Recommended implementations: Docker (local dev), cloud sandbox (production), WebAssembly (lightweight)
  - Sandbox escape test requirement: must pass basic escape test suite before M4 ships

- 0.4.4 — **Incident Response Process section:**
  - Skill lifecycle states: `published → deprecated → yanked → removed`
  - Yank procedure: immediate block on install; existing installations warned
  - Force-remove: requires 2 maintainer approvals
  - Notification: registry event poll on `skills update`; critical yanks push to configured webhooks
  - Post-mortem template for security incidents

**Acceptance criteria:**
- [ ] RFC is self-contained and reviewable
- [ ] Links to threat model and spec amendments
- [ ] Covers all 4 milestones' security requirements
- [ ] Includes open questions section for team discussion
- [ ] Approved by at least 2 team members before M3 begins

**Files created:** `docs/rfcs/rfc-001-skill-security.md`

---

### Task 0.5 — Red Team Test Plan

**Goal:** Create executable test scenarios that will be run during M3 and M4.

**Subtasks:**

- 0.5.1 — **Prompt injection tests:**
  ```
  tests/security/prompt-injection/
    skill-override-instructions.md    # SKILL.md that tries to override agent system prompt
    skill-exfiltrate-context.md       # SKILL.md that tries to leak job context
    skill-force-tool-call.md          # SKILL.md that tries to force specific tool invocation
  ```

- 0.5.2 — **Registry poisoning tests:**
  ```
  tests/security/registry-poisoning/
    hijack-common-name.skill/         # skill with name designed to hijack popular skill
    malicious-description.skill/      # skill with adversarial description
    dependency-confusion.skill/       # skill that mimics internal skill name
  ```

- 0.5.3 — **SSRF tests:**
  ```
  tests/security/ssrf/
    localhost-access.test.ts          # tool skill tries http://127.0.0.1
    metadata-access.test.ts           # tool skill tries http://169.254.169.254
    dns-rebinding.test.ts             # tool skill with DNS rebinding attempt
    redirect-to-internal.test.ts      # tool skill follows redirect to internal IP
  ```

- 0.5.4 — **Sandbox escape tests:**
  ```
  tests/security/sandbox-escape/
    read-host-file.test.ts            # plugin tries to read /etc/passwd
    write-host-file.test.ts           # plugin tries to write outside sandbox
    env-var-leak.test.ts              # plugin tries to read host env vars
    network-escape.test.ts            # plugin tries to connect to unrestricted host
    process-escape.test.ts            # plugin tries to spawn unrestricted process
  ```

- 0.5.5 — **Policy bypass tests:**
  ```
  tests/security/policy-bypass/
    escalate-capabilities.test.ts     # skill requests more capabilities than declared
    override-system-policy.test.ts    # skill tries to override non-overridable rules
    race-condition-approval.test.ts   # rapid fire invocations to bypass approval
  ```

**Acceptance criteria:**
- [ ] At least 3 test cases per attack surface
- [ ] Tests are documented with expected behavior (all should FAIL — attack blocked)
- [ ] Test infrastructure can run in CI (containerized)
- [ ] Tests reference specific threat model entries

**Files created:** `tests/security/` directory structure with test stubs

---

## Exit Criteria for M0

- [ ] Threat model document reviewed and approved
- [ ] Security RFC reviewed and approved by 2+ team members
- [ ] Spec amendment proposals drafted (not necessarily merged — that happens before M3)
- [ ] Red team test plan documented (tests will be implemented in M3/M4)
- [ ] All deliverables committed to repo
