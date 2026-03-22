# Built-in Superpowers

Agent Orchestra ships with four built-in superpowers that cover common review and analysis workflows.

## Summary Table

| ID | Category | Maturity | Description |
|---|---|---|---|
| `security-review` | review | safe | OWASP-based security code review |
| `dependency-audit` | analysis | controlled | Dependency vulnerability analysis |
| `test-generation` | testing | safe | Test generation and quality review |
| `auto-fix-lint` | fix | advanced | Automated lint fixing |
| `plan-review` | review | safe | Plan review for sequencing, scope, and readiness |

## Detailed Descriptions

### security-review

**Category:** review
**Maturity:** safe
**Approval required:** No

Runs a security-focused code review using the OWASP Top 10 checklist as a foundation. The architect agent performs structural analysis looking for security-sensitive patterns (authentication flows, input handling, data exposure), while the reviewer agent applies a `security` lens to identify injection vulnerabilities, broken authentication, XSS, SSRF, and other security issues.

**Skills:** `security-review` (skill), `security-review` (skill set)
**Protocol:** `single_challenger`
**Reviewer lens:** `security`
**Capabilities:** None required (read-only analysis)

```bash
agent-orchestra run --target src/ --superpower security-review
```

### dependency-audit

**Category:** analysis
**Maturity:** controlled
**Approval required:** Yes

Performs dependency vulnerability analysis. The reviewer examines package manifests, lock files, and import patterns to identify known vulnerabilities, outdated packages, and supply chain risks. The `controlled` maturity level reflects that this superpower's skills may read additional files (e.g., `package-lock.json`, `Cargo.lock`) beyond the primary target and make HTTP requests for vulnerability database lookups.

**Skills:** `security-review`
**Protocol:** `single_challenger`
**Reviewer lens:** `security`
**Capabilities:** `fs.read`, `net.http`

```bash
agent-orchestra run --target package.json --superpower dependency-audit
```

### test-generation

**Category:** testing
**Maturity:** safe
**Approval required:** No

Reviews existing test coverage and generates recommendations for new tests. The architect analyzes code structure to identify untested paths, boundary conditions, and integration points. The reviewer applies a `testing` lens to evaluate test quality, naming conventions, assertion patterns, and coverage gaps.

**Skills:** `test-conventions`
**Protocol:** `single_challenger`
**Reviewer lens:** `testing`
**Capabilities:** None required (read-only analysis)

```bash
agent-orchestra run --target src/ --superpower test-generation
```

### auto-fix-lint

**Category:** fix
**Maturity:** advanced
**Approval required:** Yes

Automated lint fixing that can suggest or apply code modifications. This is the only built-in superpower that may write files, which is why it has `advanced` maturity and requires explicit user approval. The architect identifies lint violations and structural issues, while the reviewer validates proposed fixes against project conventions.

**Skills:** `code-quality`
**Protocol:** `single_challenger`
**Reviewer lens:** `logic`
**Capabilities:** `fs.read`, `fs.write`, `proc.spawn`

```bash
agent-orchestra run --target src/ --superpower auto-fix-lint
```

When running an `advanced` superpower, the CLI will prompt for approval before executing any write operations. You can pre-approve with the `--yes` flag (when available in a future release).

### plan-review

**Category:** review
**Maturity:** safe
**Approval required:** No

Reviews implementation plans, roadmaps, and RFCs for execution readiness. The architect agent analyzes the plan structure for sequencing issues, missing prerequisites, and dependency problems. The reviewer agent applies an `implementation_readiness` lens to challenge whether each step is concrete enough to execute, properly scoped, and has measurable exit criteria.

The plan-review superpower bundles five purpose-built skills: `sequencing-check`, `dependency-check`, `scope-discipline`, `implementation-readiness`, and `risk-check`.

**Skills:** `sequencing-check`, `dependency-check`, `scope-discipline`, `implementation-readiness`, `risk-check`
**Skill Set:** `plan-review`
**Protocol:** `single_challenger`
**Reviewer lens:** `implementation_readiness`
**Capabilities:** None required (prompt-only analysis)

```bash
agent-orchestra run --target ./docs/phase-plan.md --superpower plan-review
```

See [plan-review.md](plan-review.md) for detailed documentation.

## Overriding Superpower Defaults

All superpowers accept CLI overrides. The explicit flag always wins:

```bash
# Use security-review but with Anthropic instead of the default provider
agent-orchestra run --target src/ --superpower security-review --provider anthropic --model claude-sonnet-4-20250514

# Use test-generation but focus on regression testing specifically
agent-orchestra run --target src/ --superpower test-generation --lens regression

# Use dependency-audit with a custom brief
agent-orchestra run --target . --superpower dependency-audit --brief "Focus on npm dependencies only"
```

## Creating Custom Superpowers

Custom superpower definitions are planned for a future release. The built-in superpowers are defined in the core catalog and cannot be modified, but the catalog system is designed to support user-defined superpowers loaded from workspace configuration files.
