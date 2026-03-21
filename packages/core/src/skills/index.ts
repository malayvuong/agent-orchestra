export type {
  SkillType,
  SkillSource,
  SkillTrigger,
  SkillDefinition,
  SkillSet,
  SkillLoadResult,
  SkillMatchResult,
  SkillParseError,
  ChecksumEntry,
  ChecksumVerifier,
  SkillCapability,
  CapabilityScope,
  SkillPolicyAction,
  SkillPolicyRule,
  SkillPolicy,
} from './types.js'

export { BLOCKED_NET_TARGETS, BLOCKED_PROC_COMMANDS, BLOCKED_SECRET_PATHS } from './types.js'

export { SkillParser } from './parser.js'
export type { SkillParseResult } from './parser.js'

export { SkillLoader } from './loader.js'

export { SkillMatcher } from './matcher.js'

export { SkillInjector } from './injector.js'

export { SkillSetLoader } from './skillset-loader.js'

// Phase C — executor types and classes
export type {
  McpTransport,
  McpConnection,
  McpToolSchema,
  McpToolResult,
  SkillArtifact,
  ToolCall,
  SkillInvocation,
  SkillInvocationStatus,
  SkillExecutionRequest,
  SkillExecutionResult,
  ToolAuditEntry,
  ToolAuditResult,
  SkillInvocationStore,
  AwaitingDecisionPayload,
  DecisionAction,
  DecisionResponse,
} from './executor/types.js'

export { SkillMcpClient } from './executor/mcp-client.js'
export { SkillInvocationManager, SkillPolicyDeniedError } from './executor/invocation.js'
export { InMemoryInvocationStore } from './executor/store.js'
export { ToolAuditLogger } from './executor/audit-logger.js'
export { SkillExecutor } from './executor/executor.js'
export type { SkillEventEmitter } from './executor/executor.js'

// Phase D — policy engine
export { PolicyEngine } from './policy/engine.js'
export type { PolicyEvaluation, NonOverridableRule } from './policy/types.js'
export { SYSTEM_RULES, DEFAULT_POLICY } from './policy/system-rules.js'
export { matchScope, matchGlob } from './policy/scope-matcher.js'
export { loadPolicyConfig } from './policy/config-loader.js'

// Phase D — trust tier enforcement
export { validateTrustTier, loadTrustOverrides } from './policy/trust-tier.js'
export type { TrustTier, TrustTierValidation, TrustTierConfig } from './policy/trust-tier.js'

// Phase D — Streamable HTTP transport
export { StreamableHttpTransport } from './executor/transports/streamable-http.js'

// Phase F — Sandbox execution
export type {
  SandboxConfig,
  SandboxMount,
  SandboxResult,
  SandboxArtifact,
  ContainerId,
  SandboxLogger,
} from './sandbox/index.js'
export { DockerCli } from './sandbox/index.js'
export { DEFAULT_SANDBOX_CONFIG, sandboxConfigByTrustTier } from './sandbox/index.js'
export { SandboxRunner } from './sandbox/index.js'
export { createRestrictedNetwork, removeNetwork } from './sandbox/index.js'

// Phase F — Plugin lifecycle hooks (Task 4.2)
export type { LifecyclePoint, HookContext, HookResult } from './hooks/index.js'
export { SkillHookRunner } from './hooks/index.js'
export type {
  HookSandboxRunner,
  HookSkillMatcher,
  HookPolicyEngine,
  HookLogger,
} from './hooks/index.js'

// Phase F — Artifact signing and provenance (Task 4.3)
export type {
  SignatureResult,
  VerifyResult,
  BuildContext,
  SLSAProvenance,
} from './signing/index.js'
export { SkillSigner } from './signing/index.js'
export type { SignerLogger } from './signing/index.js'
export { ProvenanceGenerator } from './signing/index.js'
