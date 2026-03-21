import { describe, it, expect } from 'vitest'
import { sanitizeEnvironment } from '../transports/env-sanitizer.js'

// ---------------------------------------------------------------------------
// sanitizeEnvironment
// ---------------------------------------------------------------------------

describe('sanitizeEnvironment', () => {
  it('strips SECRET_* env vars', () => {
    const env = {
      SECRET_KEY: 'super-secret',
      SECRET_API_TOKEN: 'token-value',
      PATH: '/usr/bin',
    }
    const result = sanitizeEnvironment(env)

    expect(result).not.toHaveProperty('SECRET_KEY')
    expect(result).not.toHaveProperty('SECRET_API_TOKEN')
    expect(result).toHaveProperty('PATH', '/usr/bin')
  })

  it('strips API_KEY* env vars', () => {
    const env = {
      API_KEY: 'my-api-key',
      API_KEY_OPENAI: 'openai-key',
      API_KEY_ANTHROPIC: 'anthropic-key',
      HOME: '/home/user',
    }
    const result = sanitizeEnvironment(env)

    expect(result).not.toHaveProperty('API_KEY')
    expect(result).not.toHaveProperty('API_KEY_OPENAI')
    expect(result).not.toHaveProperty('API_KEY_ANTHROPIC')
    expect(result).toHaveProperty('HOME', '/home/user')
  })

  it('strips TOKEN, PASSWORD, and PRIVATE_KEY vars', () => {
    const env = {
      TOKEN: 'my-token',
      TOKEN_SECRET: 'secret-token',
      PASSWORD: 'hunter2',
      PASSWORD_DB: 'db-pass',
      PRIVATE_KEY: 'rsa-key-content',
      PRIVATE_KEY_PATH: '/path/to/key',
      LANG: 'en_US.UTF-8',
    }
    const result = sanitizeEnvironment(env)

    expect(result).not.toHaveProperty('TOKEN')
    expect(result).not.toHaveProperty('TOKEN_SECRET')
    expect(result).not.toHaveProperty('PASSWORD')
    expect(result).not.toHaveProperty('PASSWORD_DB')
    expect(result).not.toHaveProperty('PRIVATE_KEY')
    expect(result).not.toHaveProperty('PRIVATE_KEY_PATH')
    expect(result).toHaveProperty('LANG', 'en_US.UTF-8')
  })

  it('strips AWS_* and GH_* and GITHUB_TOKEN vars', () => {
    const env = {
      AWS_ACCESS_KEY_ID: 'AKIA...',
      AWS_SECRET_ACCESS_KEY: 'wJalr...',
      AWS_SESSION_TOKEN: 'session-token',
      GH_TOKEN: 'ghp_abc123',
      GH_ENTERPRISE_TOKEN: 'ghp_enterprise',
      GITHUB_TOKEN: 'ghp_github123',
      NODE_PATH: '/usr/lib/node',
    }
    const result = sanitizeEnvironment(env)

    expect(result).not.toHaveProperty('AWS_ACCESS_KEY_ID')
    expect(result).not.toHaveProperty('AWS_SECRET_ACCESS_KEY')
    expect(result).not.toHaveProperty('AWS_SESSION_TOKEN')
    expect(result).not.toHaveProperty('GH_TOKEN')
    expect(result).not.toHaveProperty('GH_ENTERPRISE_TOKEN')
    expect(result).not.toHaveProperty('GITHUB_TOKEN')
    expect(result).toHaveProperty('NODE_PATH', '/usr/lib/node')
  })

  it('keeps PATH, HOME, NODE_PATH, and LANG', () => {
    const env = {
      PATH: '/usr/local/bin:/usr/bin',
      HOME: '/home/testuser',
      NODE_PATH: '/usr/lib/node_modules',
      LANG: 'en_US.UTF-8',
      SECRET_KEY: 'should-be-stripped',
    }
    const result = sanitizeEnvironment(env)

    expect(result).toEqual({
      PATH: '/usr/local/bin:/usr/bin',
      HOME: '/home/testuser',
      NODE_PATH: '/usr/lib/node_modules',
      LANG: 'en_US.UTF-8',
    })
  })

  it('handles an empty env object', () => {
    const result = sanitizeEnvironment({})
    expect(result).toEqual({})
  })

  it('performs case-insensitive matching on blocked patterns', () => {
    const env = {
      secret_key: 'lowercase-secret',
      Secret_Value: 'mixed-case-secret',
      api_key: 'lowercase-api-key',
      Api_Key_Test: 'mixed-api',
      token: 'lowercase-token',
      password: 'lowercase-pass',
      private_key: 'lowercase-private',
      aws_region: 'us-east-1',
      gh_token: 'lowercase-gh',
      github_token: 'lowercase-github',
      PATH: '/usr/bin',
    }
    const result = sanitizeEnvironment(env)

    expect(result).not.toHaveProperty('secret_key')
    expect(result).not.toHaveProperty('Secret_Value')
    expect(result).not.toHaveProperty('api_key')
    expect(result).not.toHaveProperty('Api_Key_Test')
    expect(result).not.toHaveProperty('token')
    expect(result).not.toHaveProperty('password')
    expect(result).not.toHaveProperty('private_key')
    expect(result).not.toHaveProperty('aws_region')
    expect(result).not.toHaveProperty('gh_token')
    expect(result).not.toHaveProperty('github_token')
    expect(result).toHaveProperty('PATH', '/usr/bin')
  })

  it('does not strip vars that partially match but are not prefixed', () => {
    const env = {
      MY_SECRET_KEY: 'this-starts-with-MY-not-SECRET',
      NOT_A_TOKEN: 'this-starts-with-NOT',
      PATH: '/usr/bin',
      HOME: '/home/user',
      EDITOR: 'vim',
      SHELL: '/bin/zsh',
      TERM: 'xterm-256color',
    }
    const result = sanitizeEnvironment(env)

    // MY_SECRET_KEY does NOT start with SECRET, API_KEY, TOKEN, etc.
    // so it should be kept (the regex checks the start of the key)
    expect(result).toHaveProperty('MY_SECRET_KEY')
    expect(result).toHaveProperty('NOT_A_TOKEN')
    expect(result).toHaveProperty('PATH')
    expect(result).toHaveProperty('HOME')
    expect(result).toHaveProperty('EDITOR')
    expect(result).toHaveProperty('SHELL')
    expect(result).toHaveProperty('TERM')
  })
})
