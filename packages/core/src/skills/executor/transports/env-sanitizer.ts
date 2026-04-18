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
 * Matches keys by prefix OR suffix:
 *
 * Prefix matches:
 * - SECRET_*, API_KEY*, TOKEN*, PASSWORD*, PRIVATE_KEY*
 * - AWS_*, GH_*, GITHUB_TOKEN
 * - ANTHROPIC_*, OPENAI_*, AZURE_*, GOOGLE_*, DEEPSEEK_*, GROK_*
 *
 * Suffix matches (catches VENDOR_API_KEY, MY_SECRET, etc.):
 * - *_API_KEY, *_SECRET, *_TOKEN, *_PASSWORD, *_PRIVATE_KEY, *_CREDENTIALS
 *
 * Case-insensitive to catch all variations.
 */
export const BLOCKED_ENV_PATTERN =
  /^(SECRET_|API_KEY|TOKEN|PASSWORD|PRIVATE_KEY|AWS_|GH_|GITHUB_TOKEN|ANTHROPIC_|OPENAI_|AZURE_|GOOGLE_|DEEPSEEK_|GROK_)|(^[A-Z0-9_]*_API_KEY$)|(^[A-Z0-9_]*_ACCESS_TOKEN$)|(^[A-Z0-9_]*_AUTH_TOKEN$)|(^[A-Z0-9_]*_PRIVATE_KEY$)|(^[A-Z0-9_]*_CREDENTIALS$)/i

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
