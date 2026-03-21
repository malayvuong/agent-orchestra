# Security Incident Report: [INCIDENT-ID] — [DATE]

> **Instructions:** Copy this template for each security incident. Replace all
> bracketed placeholders with actual values. Remove this instruction block before
> publishing.

---

## Summary

<!-- Provide a concise (2-3 sentence) summary of the incident. -->

**Affected component:** [e.g., registry skill `malicious-tool@1.0.0`, CLI, core policy engine]
**Severity:** [Critical / High / Medium / Low]
**Status:** [Investigating / Mitigated / Resolved]
**CVE ID:** [CVE-YYYY-XXXXX or N/A]

[Brief description of what happened, what was affected, and the current status.]

---

## Timeline

<!-- Record all significant events in chronological order (UTC). -->

| Time (UTC)          | Event                                                    |
|---------------------|----------------------------------------------------------|
| YYYY-MM-DD HH:MM   | [Vulnerability reported / discovered]                    |
| YYYY-MM-DD HH:MM   | [Report acknowledged by security team]                   |
| YYYY-MM-DD HH:MM   | [Triage completed — severity assessed as X]              |
| YYYY-MM-DD HH:MM   | [Mitigation deployed (e.g., skill yanked, hotfix pushed)]|
| YYYY-MM-DD HH:MM   | [Permanent fix released in version X.Y.Z]                |
| YYYY-MM-DD HH:MM   | [Public disclosure / advisory published]                 |

---

## Impact

<!-- Describe who and what was affected. Be specific about scope. -->

### Affected Users

- [Number of affected users / installations, if known]
- [Which trust tiers were affected: official / verified / community]
- [Geographic or deployment-specific impact, if relevant]

### Affected Components

- [List specific packages, skills, or services affected]
- [Versions affected: e.g., "all versions of `skill-name` prior to 1.2.0"]

### Data Impact

- [Was any data exposed, modified, or destroyed?]
- [What type of data? (credentials, source code, user data, etc.)]
- [Was the impact contained or did it propagate?]

---

## Root Cause

<!-- Explain the technical root cause. Be precise. -->

### What Went Wrong

[Detailed technical explanation of the vulnerability or failure.]

### Why It Was Not Caught

[Explain why existing controls (CI validation, policy engine, sandbox, etc.) did not prevent this.]

### Contributing Factors

- [Factor 1: e.g., insufficient test coverage for edge case X]
- [Factor 2: e.g., validation pipeline did not check for pattern Y]
- [Factor 3: e.g., trust tier allowed the skill to bypass check Z]

---

## Remediation

<!-- Describe all actions taken to resolve the incident. -->

### Immediate Actions

- [ ] [Action 1: e.g., Yanked affected skill version from registry]
- [ ] [Action 2: e.g., Pushed hotfix to core package v1.2.1]
- [ ] [Action 3: e.g., Notified affected users via GitHub Advisory]

### Long-Term Fixes

- [ ] [Fix 1: e.g., Added new validation rule to CI pipeline]
- [ ] [Fix 2: e.g., Updated policy engine to block capability X]
- [ ] [Fix 3: e.g., Added regression test for this attack vector]

### User Action Required

- [What should affected users do? e.g., "Run `skills status` to check for yanked skills"]
- [Should users update, remove, or rollback specific skills?]
- [Are there manual steps needed beyond running CLI commands?]

---

## Lessons Learned

<!-- Honest assessment of what we can do better. -->

### What Went Well

- [e.g., Vulnerability was reported responsibly via Private Security Advisory]
- [e.g., Mitigation was deployed within X hours of report]

### What Could Be Improved

- [e.g., Detection: the suspicious pattern should have been caught by secret scanning]
- [e.g., Response: the yank process took too long because it required manual steps]
- [e.g., Communication: affected users were not notified quickly enough]

### Action Items

| Action                                           | Owner          | Due Date   | Status |
|--------------------------------------------------|----------------|------------|--------|
| [Add validation rule for attack pattern]         | [Team/Person]  | YYYY-MM-DD | [ ]    |
| [Add regression test]                            | [Team/Person]  | YYYY-MM-DD | [ ]    |
| [Update SECURITY.md with new guidance]           | [Team/Person]  | YYYY-MM-DD | [ ]    |
| [Automate the yank notification process]         | [Team/Person]  | YYYY-MM-DD | [ ]    |

---

## References

- [Link to GitHub Security Advisory]
- [Link to CVE entry, if applicable]
- [Link to related pull requests or commits]
- [Link to related documentation updates]

---

**Report prepared by:** [Name / Team]
**Report reviewed by:** [Name / Team]
**Last updated:** [YYYY-MM-DD]
