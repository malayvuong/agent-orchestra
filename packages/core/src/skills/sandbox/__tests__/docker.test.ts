import { describe, it, expect, vi } from 'vitest'
import { DockerCli } from '../docker.js'

describe('DockerCli.logs', () => {
  it('uses plain docker logs without unsupported stream flags', async () => {
    const docker = new DockerCli()
    const execSpy = vi
      .spyOn(docker, 'exec')
      .mockResolvedValue({ stdout: 'hello from container', stderr: '', exitCode: 0 })

    const output = await docker.logs('abc123', 'stdout')

    expect(execSpy).toHaveBeenCalledWith(['logs', 'abc123'])
    expect(output).toBe('hello from container')
  })
})
