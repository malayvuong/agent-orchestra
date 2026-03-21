/**
 * Policy configuration loader.
 *
 * Reads `.agent-orchestra/policy.yaml` from the workspace root and
 * parses it into a validated SkillPolicy. Falls back to DEFAULT_POLICY
 * when the configuration file is not found.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { SkillCapability, SkillPolicy, SkillPolicyAction, SkillPolicyRule } from '../types.js'
import { DEFAULT_POLICY } from './system-rules.js'

/** Valid capability values for validation */
const VALID_CAPABILITIES: SkillCapability[] = [
  'fs.read',
  'fs.write',
  'proc.spawn',
  'net.http',
  'secrets.read',
]

/** Valid action values for validation */
const VALID_ACTIONS: SkillPolicyAction[] = ['allow', 'deny', 'require_approval']

/**
 * Load policy configuration from `.agent-orchestra/policy.yaml`.
 *
 * Falls back to {@link DEFAULT_POLICY} if:
 * - The file does not exist
 * - The file cannot be read
 *
 * Throws if the file exists but contains invalid structure.
 *
 * @param workspacePath - Absolute path to the workspace root
 * @returns The parsed and validated SkillPolicy
 * @throws Error if the YAML structure is invalid
 */
export async function loadPolicyConfig(workspacePath: string): Promise<SkillPolicy> {
  const configPath = join(workspacePath, '.agent-orchestra', 'policy.yaml')

  let content: string
  try {
    content = await readFile(configPath, 'utf-8')
  } catch {
    // File not found or unreadable — use default policy
    return { ...DEFAULT_POLICY }
  }

  const parsed = parseYaml(content)
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Invalid policy config: expected an object at ${configPath}`)
  }

  const policyData = parsed.defaultPolicy ?? parsed
  return validatePolicy(policyData, configPath)
}

/**
 * Validate and normalize a raw policy object from YAML.
 *
 * Ensures all required fields are present, types are correct, and
 * capability/action values are from the allowed set.
 *
 * @param data - The raw parsed YAML object
 * @param filePath - Path to the config file (for error messages)
 * @returns A validated SkillPolicy
 * @throws Error if validation fails
 */
function validatePolicy(data: unknown, filePath: string): SkillPolicy {
  if (!data || typeof data !== 'object') {
    throw new Error(`Invalid policy structure in ${filePath}`)
  }

  const obj = data as Record<string, unknown>

  // defaultAction must be 'deny' (non-negotiable)
  if (obj.defaultAction !== undefined && obj.defaultAction !== 'deny') {
    throw new Error(
      `Invalid defaultAction in ${filePath}: must be "deny" (deny-by-default is non-negotiable)`,
    )
  }

  // maxExecutionMs
  const maxExecutionMs =
    typeof obj.maxExecutionMs === 'number' ? obj.maxExecutionMs : DEFAULT_POLICY.maxExecutionMs

  if (maxExecutionMs <= 0) {
    throw new Error(`Invalid maxExecutionMs in ${filePath}: must be positive`)
  }

  // networkAllowed
  const networkAllowed =
    typeof obj.networkAllowed === 'boolean' ? obj.networkAllowed : DEFAULT_POLICY.networkAllowed

  // rules
  const rules: SkillPolicyRule[] = []
  if (Array.isArray(obj.rules)) {
    for (let i = 0; i < obj.rules.length; i++) {
      rules.push(validateRule(obj.rules[i], i, filePath))
    }
  }

  return {
    defaultAction: 'deny',
    rules,
    maxExecutionMs,
    networkAllowed,
  }
}

/**
 * Validate a single policy rule from the YAML configuration.
 *
 * @param rule - The raw rule object
 * @param index - The rule's index in the array (for error messages)
 * @param filePath - Path to the config file (for error messages)
 * @returns A validated SkillPolicyRule
 * @throws Error if the rule is invalid
 */
function validateRule(rule: unknown, index: number, filePath: string): SkillPolicyRule {
  if (!rule || typeof rule !== 'object') {
    throw new Error(`Invalid rule at index ${index} in ${filePath}: expected an object`)
  }

  const obj = rule as Record<string, unknown>

  // capability (required)
  if (!obj.capability || typeof obj.capability !== 'string') {
    throw new Error(`Missing or invalid capability at rule ${index} in ${filePath}`)
  }
  if (!VALID_CAPABILITIES.includes(obj.capability as SkillCapability)) {
    throw new Error(
      `Invalid capability "${obj.capability}" at rule ${index} in ${filePath}. ` +
        `Valid: ${VALID_CAPABILITIES.join(', ')}`,
    )
  }

  // action (required)
  if (!obj.action || typeof obj.action !== 'string') {
    throw new Error(`Missing or invalid action at rule ${index} in ${filePath}`)
  }
  if (!VALID_ACTIONS.includes(obj.action as SkillPolicyAction)) {
    throw new Error(
      `Invalid action "${obj.action}" at rule ${index} in ${filePath}. ` +
        `Valid: ${VALID_ACTIONS.join(', ')}`,
    )
  }

  // scope (optional)
  const result: SkillPolicyRule = {
    capability: obj.capability as SkillCapability,
    action: obj.action as SkillPolicyAction,
  }

  if (obj.scope !== undefined) {
    if (!Array.isArray(obj.scope) || !obj.scope.every((s: unknown) => typeof s === 'string')) {
      throw new Error(`Invalid scope at rule ${index} in ${filePath}: expected string array`)
    }
    result.scope = obj.scope as string[]
  }

  return result
}
