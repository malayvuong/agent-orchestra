import { stat } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Detected project profile from filesystem signals.
 */
export type ProjectProfile = {
  kind: 'node-ts' | 'python' | 'rust' | 'generic'
  hasTests: boolean
  hasDocs: boolean
  recommendedSuperpowers: string[]
}

/**
 * Check whether a file or directory exists at the given path.
 */
async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * Detect the project type from filesystem signals in the given directory.
 *
 * Checks for common project markers (package.json, Cargo.toml, etc.)
 * and returns a profile with recommended superpowers.
 */
export async function detectProject(rootPath: string): Promise<ProjectProfile> {
  // Check project type signals in parallel
  const [
    hasPackageJson,
    hasTsconfig,
    hasPyprojectToml,
    hasRequirementsTxt,
    hasCargoToml,
    hasTestsDir,
    hasTestDir,
    hasDocsDir,
  ] = await Promise.all([
    exists(join(rootPath, 'package.json')),
    exists(join(rootPath, 'tsconfig.json')),
    exists(join(rootPath, 'pyproject.toml')),
    exists(join(rootPath, 'requirements.txt')),
    exists(join(rootPath, 'Cargo.toml')),
    exists(join(rootPath, 'tests')),
    exists(join(rootPath, 'test')),
    exists(join(rootPath, 'docs')),
  ])

  const hasTests = hasTestsDir || hasTestDir
  const hasDocs = hasDocsDir

  // Determine project kind
  let kind: ProjectProfile['kind'] = 'generic'

  if (hasPackageJson || hasTsconfig) {
    kind = 'node-ts'
  } else if (hasPyprojectToml || hasRequirementsTxt) {
    kind = 'python'
  } else if (hasCargoToml) {
    kind = 'rust'
  }

  // Build recommended superpowers based on project kind
  const recommendedSuperpowers = buildRecommendations(kind, hasTests, hasDocs)

  return { kind, hasTests, hasDocs, recommendedSuperpowers }
}

/**
 * Build superpower recommendations based on project profile.
 */
function buildRecommendations(
  kind: ProjectProfile['kind'],
  hasTests: boolean,
  hasDocs: boolean,
): string[] {
  const superpowers: string[] = []

  switch (kind) {
    case 'node-ts':
      superpowers.push('security-review', 'test-generation', 'auto-fix-lint')
      break
    case 'python':
    case 'rust':
      superpowers.push('security-review', 'test-generation')
      break
    case 'generic':
      superpowers.push('security-review')
      break
  }

  // Add plan-review for docs-heavy repos or always as a general recommendation
  if (hasDocs || kind === 'generic') {
    superpowers.push('plan-review')
  }

  // If tests exist, ensure test-generation is recommended
  if (hasTests && !superpowers.includes('test-generation')) {
    superpowers.push('test-generation')
  }

  return superpowers
}
