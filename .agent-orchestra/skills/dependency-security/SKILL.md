---
name: Dependency Security Review
description: Deep review of dependency management — supply chain risks, version pinning, vulnerability scanning, lock file integrity, and transitive dependency audit.
version: 2026.3.1
license: MIT
triggers:
  lenses:
    - security
  keywords:
    - dependency
    - package
    - npm
    - pip
    - cargo
    - vulnerability
    - cve
    - supply chain
---

When reviewing dependency management, apply the following checks.

## Lock File Integrity

Verify a lock file exists and is committed to the repository (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `Pipfile.lock`, `poetry.lock`, `Cargo.lock`, `go.sum`). Flag repositories without a committed lock file — builds are non-reproducible and vulnerable to supply chain substitution.

Flag `.gitignore` entries that exclude lock files. Verify CI installs with the frozen lock file (`npm ci`, `pnpm install --frozen-lockfile`, `pip install --require-hashes`) — not `npm install` which can modify the lock file.

Check that lock file changes in PRs are reviewed — a modified lock file can introduce malicious packages. Flag PRs that modify the lock file without a corresponding change to the package manifest.

## Version Pinning

Flag wildcard version specifiers (`*`, `latest`) in production dependencies. Verify direct dependencies use exact versions or tight ranges (`^` for npm is acceptable if lock file is committed, but `>=` without upper bound is not).

Flag `npm install <package>` without `--save-exact` in installation instructions — default `^` ranges allow minor version drift between installs. Check that renovate/dependabot is configured for automated dependency updates with CI verification.

## Typosquatting and Substitution

Check package names for common typosquatting patterns: extra hyphens (`lodash` vs `lodash-utils`), character substitution (`express` vs `expresss`), scope confusion (`@types/react` vs `@typos/react`). Flag new dependencies added in a PR that have fewer than 1000 weekly downloads or were published within the last 30 days without explicit justification.

Flag `install` or `postinstall` scripts in dependencies — these execute arbitrary code at install time. Verify `ignore-scripts` is configured for untrusted packages.

## Known Vulnerabilities

Verify `npm audit`, `pip audit`, `cargo audit`, or equivalent is run in CI. Flag dependencies with known critical or high severity CVEs. Check that vulnerability scanning covers transitive dependencies, not just direct ones — most vulnerabilities come from deep in the dependency tree.

Flag dependencies that are unmaintained (no commits in 2+ years, no response to security issues) — these will never get security patches. Identify alternatives for abandoned packages.

## Transitive Dependency Risk

Flag dependency trees with more than 500 total packages — large trees increase attack surface. Check for duplicate packages at different versions (e.g., two versions of `lodash`) — this increases bundle size and may indicate diamond dependency conflicts.

Verify `peerDependencies` are satisfied — unmet peer dependencies can cause runtime failures. Flag `--legacy-peer-deps` or `--force` in install commands — these hide real compatibility issues.

## License Compliance

Verify all dependencies have licenses compatible with the project's license. Flag `AGPL` dependencies in proprietary projects — AGPL requires disclosing the entire application source. Flag dependencies without a license — the default copyright applies, meaning the dependency cannot be legally redistributed.

Check for license changes between versions — a dependency that was MIT in v1 may become proprietary in v2. Verify license scanning is part of CI.

## Build and Bundle

Flag development dependencies (`devDependencies`) that are imported in production code — these may not be installed in production builds. Verify `npm prune --production` or equivalent is used for production deployments.

Check bundle size impact for frontend dependencies: flag packages larger than 100KB gzipped that have smaller alternatives. Verify tree-shaking is effective — flag dependencies that do not support ES modules and force the entire package to be bundled.

For each finding, report: the package name and version, the specific risk, and the recommended action.
