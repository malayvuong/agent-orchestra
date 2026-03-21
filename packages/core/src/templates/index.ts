export type { PromptTemplateRole, FewShotExample, PromptTemplate, RenderedPrompt } from './types.js'

export { renderTemplate } from './renderer.js'
export { TemplateLoader } from './loader.js'

export { architectAnalysisTemplate } from './defaults/architect-analysis.js'
export { reviewerByLensTemplate } from './defaults/reviewer-by-lens.js'
export { architectRebuttalTemplate } from './defaults/architect-rebuttal.js'
export { synthesisTemplate } from './defaults/synthesis.js'
