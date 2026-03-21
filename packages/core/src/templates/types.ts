import type { AgentRole } from '../types/agent.js'

/** Spec v1.3 SS22.2 — Role for prompt templates. */
export type PromptTemplateRole = AgentRole | 'system'

/** Few-shot example for prompt templates. */
export type FewShotExample = {
  user: string
  assistant: string
}

/** Spec v1.3 SS22.2 — Prompt template definition. */
export type PromptTemplate = {
  /** Unique template identifier (e.g. 'architect-analysis'). */
  id: string

  /** Role this template targets. */
  role: PromptTemplateRole

  /** Optional lens focus (for reviewer templates). */
  lens?: string

  /** System prompt content. */
  systemPrompt: string

  /** User prompt template with {{variable}} placeholders. */
  userPromptTemplate: string

  /** Instructions for output format appended to user prompt. */
  outputFormatInstructions: string

  /** Optional few-shot examples for the template. */
  fewShotExamples?: FewShotExample[]
}

/** Result of rendering a template with variables. */
export type RenderedPrompt = {
  system: string
  user: string
}
