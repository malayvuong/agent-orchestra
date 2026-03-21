/**
 * Environment sanitization for MCP stdio child processes.
 *
 * Strips sensitive environment variables (secrets, API keys, tokens, etc.)
 * before passing the environment to a spawned MCP server process.
 * This prevents accidental credential leakage to third-party skill servers.
 *
 * @module
 */

/**
 * Regex pattern matching environment variable names that must be stripped.
 *
 * Matches keys starting with:
 * - SECRET_*
 * - API_KEY*
 * - TOKEN*
 * - PASSWORD*
 * - PRIVATE_KEY*
 * - AWS_*
 * - GH_*
 * - GITHUB_TOKEN
 *
 * Case-insensitive to catch all variations.
 */
export const BLOCKED_ENV_PATTERN =
  /^(SECRET_|API_KEY|TOKEN|PASSWORD|PRIVATE_KEY|AWS_|GH_|GITHUB_TOKEN)/i

/**
 * Sanitize an environment record by removing entries whose keys match
 * the blocked pattern. Returns a new object; the input is not mutated.
 *
 * @param env - The raw environment variables (typically `process.env`).
 * @returns A filtered copy with sensitive keys removed.
 */
export function sanitizeEnvironment(
  env: Record<string, string | undefined>,
): Record<string, string> {
  const result: Record<string, string> = {}

  for (const [key, value] of Object.entries(env)) {
    // Skip undefined values (possible in process.env)
    if (value === undefined) continue

    // Skip keys that match the blocked pattern
    if (BLOCKED_ENV_PATTERN.test(key)) continue

    result[key] = value
  }

  return result
}
