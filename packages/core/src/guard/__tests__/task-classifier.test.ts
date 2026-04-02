import { describe, it, expect } from 'vitest'
import { TaskClassifier } from '../task-classifier.js'

describe('TaskClassifier', () => {
  const classifier = new TaskClassifier()

  // ─── Action verbs → executionRequired ──────────────────────────

  it('should mark action verb messages as executionRequired', () => {
    const actionMessages = [
      'Fix the login bug',
      'Create a new API endpoint',
      'Deploy to production',
      'Run the test suite',
      'Update the README',
      'Build the Docker image',
      'Delete the old migration',
      'Install the dependencies',
      'Add a retry mechanism',
      'Remove the deprecated code',
      'Write unit tests',
      'Edit the config file',
      'Send a notification',
      'Schedule a backup',
      'Stop the server',
      'Start the worker',
      'Restart the service',
      'Implement the feature',
      'Refactor the auth module',
      'Configure the CI pipeline',
      'Execute the migration',
      'Change the port to 8080',
      'Modify the schema',
      'Replace the old logger',
      'Patch the vulnerability',
    ]

    for (const msg of actionMessages) {
      const result = classifier.classify(msg)
      expect(result.executionRequired).toBe(true)
      expect(result.allowedResponseModes).toContain('action')
      expect(result.allowedResponseModes).toContain('blocker')
    }
  })

  // ─── Question patterns → not executionRequired ─────────────────

  it('should mark questions as not executionRequired', () => {
    const questions = [
      'What is the current deployment status?',
      'Explain how the auth module works',
      'Why is the test failing?',
      'How does the caching layer work?',
      'Describe the database schema',
      'Show me the error logs',
      'Tell me about the API design',
      'List all available endpoints',
      'Which file handles authentication?',
      'Where is the config stored?',
      'What are the dependencies?',
      'How do I set up the dev environment?',
      'Can you explain the flow?',
      'Could you explain the error?',
      'What does this function do?',
    ]

    for (const msg of questions) {
      const result = classifier.classify(msg)
      expect(result.executionRequired).toBe(false)
      expect(result.allowedResponseModes).toContain('explanation')
    }
  })

  // ─── Edge cases ────────────────────────────────────────────────

  it('should classify empty message as not actionable', () => {
    const result = classifier.classify('')
    expect(result.executionRequired).toBe(false)
  })

  it('should classify whitespace-only message as not actionable', () => {
    const result = classifier.classify('   ')
    expect(result.executionRequired).toBe(false)
  })

  it('should prioritize question over action verb', () => {
    // "How do I fix the bug?" has both "how do" and "fix"
    const result = classifier.classify('How do I fix the bug?')
    expect(result.executionRequired).toBe(false)
  })

  it('should classify ambiguous messages as not actionable (safe fallback)', () => {
    const result = classifier.classify('the server is down')
    expect(result.executionRequired).toBe(false)
    // ambiguous allows both explanation and action
    expect(result.allowedResponseModes).toContain('explanation')
    expect(result.allowedResponseModes).toContain('action')
  })

  it('should classify messages without verbs or questions as not actionable', () => {
    const result = classifier.classify('authentication module')
    expect(result.executionRequired).toBe(false)
  })
})
