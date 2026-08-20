import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import YAML from 'yaml'
import { describe, expect, it } from 'vitest'
import { inferChecks } from '../src/capture.js'
import { loadCase, parseCase } from '../src/schema.js'

describe('case schema', () => {
  it('accepts a minimal executable case', () => {
    const value = parseCase({
      version: 1,
      id: 'boundary',
      fixture: { repository: '.', git_ref: 'HEAD' },
      runner: { adapter: 'command', command: 'node', args: ['agent.mjs'] },
      task: { prompt: 'change the implementation' },
      checks: [{ id: 'boundary', type: 'diff-path', forbid: ['src/public/**'] }],
    })
    expect(value.id).toBe('boundary')
  })

  it('rejects a verifier with no executable rule', () => {
    expect(() => parseCase({
      version: 1,
      id: 'empty',
      fixture: { repository: '.', git_ref: 'HEAD' },
      runner: { adapter: 'command', command: 'true' },
      task: { prompt: 'x' },
      checks: [{ id: 'empty', type: 'diff-path' }],
    })).toThrow('must define at least one rule')
  })

  it('turns common explicit corrections into deterministic checks', () => {
    const checks = inferChecks('不要修改 public API，也不要新增依赖，不要删除测试。')
    expect(checks).toEqual([expect.objectContaining({
      type: 'diff-path',
      forbid_dependency_changes: true,
      forbid_test_deletions: true,
      forbid: expect.arrayContaining(['src/public/**']),
    })])
  })

  it('ships a parseable Kimi case and an environment-only credential reference', async () => {
    const kimiCase = await loadCase(resolve('examples/cases/kimi-internal-edit.yaml'))
    expect(kimiCase.runner.adapter).toBe('dsh')
    expect(kimiCase.checks.map(check => check.id)).toEqual(['internal-file-only', 'exact-content'])

    const settingsText = await readFile(resolve('examples/kimi/settings.yaml.example'), 'utf8')
    const settings = YAML.parse(settingsText) as {
      'llm-pi-ai': { providers: { 'kimi-coding': { apiKeyEnv: string } } }
      'agent-default-model': { provider: string; model: string }
    }
    expect(settings).toMatchObject({
      'llm-pi-ai': { providers: { 'kimi-coding': { apiKeyEnv: 'KIMI_API_KEY' } } },
      'agent-default-model': { provider: 'kimi-coding', model: 'kimi-for-coding' },
    })
    expect(settingsText).not.toMatch(/^\s*apiKey:/mu)
  })
})
