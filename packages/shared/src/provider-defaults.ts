const DEFAULT_MODELS_BY_PROVIDER: Record<string, string> = {
  'claude-cli': 'claude-opus-4-6[1m]',
  'codex-cli': 'gpt-5.4',
  openai: 'gpt-5.4',
  anthropic: 'claude-sonnet-4-6',
  grok: 'grok-3',
  deepseek: 'deepseek-chat',
}

export function getDefaultModelForProvider(providerName: string): string {
  return DEFAULT_MODELS_BY_PROVIDER[providerName] ?? DEFAULT_MODELS_BY_PROVIDER.openai
}
