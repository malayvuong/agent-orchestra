# CalVer Hard-Cut Design

**Date:** 2026-03-23

## Goal

Convert Agent Orchestra release versions and the `skills/registry` subsystem from SemVer to a hard-cut CalVer scheme.

## Canonical Version Format

- Canonical format: `YYYY.M.PATCH`
- Example: `2026.3.1`

Rules:

- `YYYY` must be a four-digit year.
- `M` must be a non-zero month without zero-padding (`1` to `12`).
- `PATCH` must be a positive integer without zero-padding.
- `v` prefixes may appear only in git tags or user-facing text such as `v2026.3.1`.
- Stored version strings in package manifests, registry entries, skill metadata, lockfiles, CLI output, and API payloads must not include the `v` prefix.

Invalid examples:

- `2026.03.1`
- `2026.3.01`
- `1.2.3`
- `2026.3`

## Scope

This hard-cut applies to:

- all publishable package versions in this repo
- CLI and server version surfaces
- git release tag examples and release workflow expectations
- skill metadata versions used by `packages/core` and `packages/registry`
- registry resolution, latest-version selection, update detection, and rollback/install flows
- lockfile entries and validation paths that read stored skill versions

This hard-cut does not attempt backward compatibility for old SemVer skill versions or SemVer lockfile entries.

## Required Behavior

### Release/App Versioning

- All workspace packages move from `0.0.1` to the current CalVer release string.
- CLI `--version`, MCP server metadata, and server status endpoints return the same CalVer string.
- Release tags and documentation examples use `vYYYY.M.PATCH`.

### Skill/Registry Versioning

- Skill metadata versions must conform to `YYYY.M.PATCH`.
- Registry entries must conform to `YYYY.M.PATCH`.
- Update checks compare versions by calendar parts, not SemVer semantics.
- “Latest version” resolution picks the highest CalVer by `(year, month, patch)`.
- Install, resolve, rollback, and pin flows reject invalid version strings rather than coercing them.

### Hard-Cut Migration Boundary

- SemVer skill versions are no longer accepted by parser, installer, registry client, or lockfile validation.
- Existing tests and fixtures using SemVer in registry-related flows must be updated to CalVer or moved into explicit invalid-version test cases.

## Implementation Shape

### Shared CalVer Utility

Create a small utility in `packages/registry` that:

- validates `YYYY.M.PATCH`
- parses it into `{ year, month, patch }`
- compares two CalVer strings

This utility replaces the current inline SemVer comparator in the registry client.

### Registry/Installer Changes

- `packages/registry/src/client.ts`
  - replace SemVer comparison logic
  - validate version inputs before resolution/update checks
- `packages/registry/src/installer.ts`
  - validate extracted frontmatter versions
  - replace SemVer-era defaults with a CalVer-compatible default
- `packages/core/src/skills/parser.ts`
  - enforce CalVer on parsed skill frontmatter
  - replace default version fallback with a CalVer-compatible fallback

### Version Source of Truth

Use one shared release constant for app/package runtime surfaces where practical, instead of scattering literal version strings in CLI/server code.

## Testing

Required coverage:

- CalVer validator accepts valid `YYYY.M.PATCH` and rejects zero-padded or SemVer inputs.
- Registry client sorts and compares CalVer versions correctly across month and patch boundaries.
- Registry update detection reports newer CalVer versions and ignores equal/older versions.
- Installer/parser reject SemVer skill versions.
- CLI/server version surfaces emit the new release string.

## Risks

- Hard-cutting lockfile and registry version parsing means old installed skill metadata may need manual refresh.
- Docs that still describe SemVer for skill metadata will become misleading and must be updated in this slice.
