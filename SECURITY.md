# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 1.x     | :white_check_mark: |
| < 1.0   | :x:                |

Only the latest minor release of the current major version receives security patches.
Pre-release versions (alpha, beta, rc) are not covered.

## Reporting a Vulnerability

We take security seriously. If you discover a vulnerability in Agent Orchestra,
please report it responsibly through GitHub Private Security Advisories.

### How to Report

1. Go to **[agent-orchestra](https://github.com/nicemvp/agent-orchestra)** > **Security** > **Advisories** > **New draft advisory**.
2. Provide the following information:
   - A clear description of the vulnerability.
   - Step-by-step reproduction instructions.
   - Impact assessment (what can an attacker do?).
   - Affected component(s) and version(s).
   - Any suggested fix or mitigation, if known.
3. Submit the advisory. The security team will be notified immediately.

### Do NOT

- Open a public GitHub issue for security vulnerabilities.
- Disclose the vulnerability publicly before a fix is available.
- Exploit the vulnerability beyond what is necessary to demonstrate the issue.

### Response Timeline

| Stage                   | Target Time         |
|-------------------------|---------------------|
| Acknowledgment          | Within 48 hours     |
| Initial triage          | Within 72 hours     |
| Fix timeline commitment | Within 7 days       |
| Patch release           | Within 14-30 days   |
| Public disclosure       | After patch release  |

We will credit reporters in the release notes unless anonymity is requested.

## Skill Security

Agent Orchestra executes skills at three tiers with increasing privilege:

| Skill Type | Execution Model              | Security Boundary                          |
|------------|------------------------------|--------------------------------------------|
| `prompt`   | Injected into LLM context    | Prompt injection scanning, token budgets   |
| `tool`     | MCP tool call via provider   | Policy engine, capability checks, SSRF     |
| `plugin`   | Sandboxed container          | Docker isolation, network/fs/process limits|

### Key Security Controls

- **Sandbox Execution:** All executable skills (`tool`, `plugin`) run in sandboxed environments with dropped capabilities, read-only root filesystems, memory/CPU limits, and network isolation.
- **CI Validation:** Skills published to the official registry are validated via automated CI pipelines including frontmatter validation, secret scanning, and policy compliance checks.
- **Artifact Signing:** Official registry skills are signed using cosign (Sigstore keyless mode) and include SLSA provenance. Signatures are verified at install time.
- **Policy Engine:** A capability-based policy engine evaluates every tool invocation against maturity-level rules and custom policies. Deny-by-default.
- **SSRF Protection:** Network requests from tools are validated against IP/CIDR blocklists covering private ranges, cloud metadata endpoints, and link-local addresses.
- **Lockfile Integrity:** Installed skills are checksummed (SHA-256) and recorded in `skills.lock`. Tamper detection runs on load.

### Reporting a Suspicious Skill

If you encounter a skill in the registry that appears malicious, compromised, or suspicious:

1. Report it using the same vulnerability reporting process described above.
2. Include the skill ID, version, and a description of the suspicious behavior.
3. The security team will triage, and if confirmed, the skill will be yanked from the registry immediately.

## Scope

The following components are in scope for this security policy:

### In Scope

- **Agent Orchestra core** (`packages/core/`) — protocol engine, policy engine, skill system, MCP client.
- **Official registry skills** (`trustTier: official`) — skills maintained by the Agent Orchestra team.
- **CLI** (`apps/cli/`) — the `agent-orchestra` command-line tool.
- **Web dashboard** (`apps/web/`) — the orchestration dashboard.
- **Registry infrastructure** — the skill registry, validation pipelines, and signing infrastructure.

### Out of Scope

- **Third-party skills** (`trustTier: community`) — report issues directly to the skill author. If the skill is malicious, report it as a suspicious skill (see above).
- **Experimental tier skills** — skills marked as experimental are not covered by security SLAs.
- **Self-hosted deployments** — security of your infrastructure (firewalls, OS patches, Docker configuration) is your responsibility.
- **LLM provider vulnerabilities** — issues in OpenAI, Anthropic, or other LLM providers should be reported to those providers directly.

## Security Best Practices for Skill Authors

- Never embed secrets (API keys, tokens, passwords) in skill definitions.
- Declare the minimum required capabilities in your skill manifest.
- Use `networkMode: 'none'` for plugins that do not need network access.
- Pin dependencies to exact versions in plugin scripts.
- Respond promptly to security reports about your skills.

## Security Advisories

Past security advisories are published on the [GitHub Security Advisories](https://github.com/nicemvp/agent-orchestra/security/advisories) page.
