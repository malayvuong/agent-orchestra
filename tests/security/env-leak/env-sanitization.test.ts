/**
 * Environment variable sanitization security tests.
 *
 * Verifies that the env sanitizer strips sensitive environment variables
 * (secrets, API keys, tokens) before passing the environment to child
 * processes, while preserving safe variables like PATH and HOME.
 *
 * These tests protect against credential leakage to third-party
 * MCP skill servers spawned via stdio transport.
 */

import { describe, it, expect } from 'vitest'
import { sanitizeEnvironment } from '../../../packages/core/src/skills/executor/transports/env-sanitizer.js'

describe('Environment Sanitization — Secret Stripping', () => {
  it('strips SECRET_KEY from environment', () => {
    const env = {
      SECRET_KEY: 'my-super-secret-key',
      PATH: '/usr/bin',
    }
    const result = sanitizeEnvironment(env)

    expect(result).not.toHaveProperty('SECRET_KEY')
    expect(result).toHaveProperty('PATH', '/usr/bin')
  })

  it('strips API_KEY from environment', () => {
    const env = {
      API_KEY: 'sk-abc123def456',
      HOME: '/home/user',
    }
    const result = sanitizeEnvironment(env)

    expect(result).not.toHaveProperty('API_KEY')
    expect(result).toHaveProperty('HOME', '/home/user')
  })

  it('strips GITHUB_TOKEN from environment', () => {
    const env = {
      GITHUB_TOKEN: 'ghp_abcdefghijklmnop',
      PATH: '/usr/local/bin',
      HOME: '/home/user',
    }
    const result = sanitizeEnvironment(env)

    expect(result).not.toHaveProperty('GITHUB_TOKEN')
    expect(result).toHaveProperty('PATH', '/usr/local/bin')
    expect(result).toHaveProperty('HOME', '/home/user')
  })

  it('keeps PATH in the sanitized environment', () => {
    const env = {
      PATH: '/usr/local/bin:/usr/bin:/bin',
      SECRET_KEY: 'should-be-removed',
      API_KEY: 'should-also-be-removed',
    }
    const result = sanitizeEnvironment(env)

    expect(result).toHaveProperty('PATH', '/usr/local/bin:/usr/bin:/bin')
  })

  it('keeps HOME in the sanitized environment', () => {
    const env = {
      HOME: '/home/testuser',
      TOKEN: 'should-be-removed',
      PASSWORD: 'should-also-be-removed',
    }
    const result = sanitizeEnvironment(env)

    expect(result).toHaveProperty('HOME', '/home/testuser')
  })
})

describe('Environment Sanitization — Comprehensive Secret Patterns', () => {
  it('strips all known secret patterns', () => {
    const env = {
      SECRET_KEY: 'secret',
      SECRET_DB_PASSWORD: 'db-pass',
      API_KEY: 'api-key',
      API_KEY_OPENAI: 'openai-key',
      TOKEN: 'token',
      TOKEN_SECRET: 'token-secret',
      PASSWORD: 'password',
      PASSWORD_DB: 'db-password',
      PRIVATE_KEY: 'private-key',
      AWS_ACCESS_KEY_ID: 'aws-key',
      AWS_SECRET_ACCESS_KEY: 'aws-secret',
      AWS_SESSION_TOKEN: 'aws-session',
      GH_TOKEN: 'gh-token',
      GH_ENTERPRISE_TOKEN: 'gh-enterprise',
      GITHUB_TOKEN: 'github-token',
      // These should be kept
      PATH: '/usr/bin',
      HOME: '/home/user',
      LANG: 'en_US.UTF-8',
      EDITOR: 'vim',
      SHELL: '/bin/bash',
    }

    const result = sanitizeEnvironment(env)

    // All secret patterns removed
    expect(result).not.toHaveProperty('SECRET_KEY')
    expect(result).not.toHaveProperty('SECRET_DB_PASSWORD')
    expect(result).not.toHaveProperty('API_KEY')
    expect(result).not.toHaveProperty('API_KEY_OPENAI')
    expect(result).not.toHaveProperty('TOKEN')
    expect(result).not.toHaveProperty('TOKEN_SECRET')
    expect(result).not.toHaveProperty('PASSWORD')
    expect(result).not.toHaveProperty('PASSWORD_DB')
    expect(result).not.toHaveProperty('PRIVATE_KEY')
    expect(result).not.toHaveProperty('AWS_ACCESS_KEY_ID')
    expect(result).not.toHaveProperty('AWS_SECRET_ACCESS_KEY')
    expect(result).not.toHaveProperty('AWS_SESSION_TOKEN')
    expect(result).not.toHaveProperty('GH_TOKEN')
    expect(result).not.toHaveProperty('GH_ENTERPRISE_TOKEN')
    expect(result).not.toHaveProperty('GITHUB_TOKEN')

    // Safe variables preserved
    expect(result).toHaveProperty('PATH')
    expect(result).toHaveProperty('HOME')
    expect(result).toHaveProperty('LANG')
    expect(result).toHaveProperty('EDITOR')
    expect(result).toHaveProperty('SHELL')
  })
})
