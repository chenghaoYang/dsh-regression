import { describe, expect, it } from 'vitest'
import { inferChecks } from '../src/capture.js'
import { parseCase } from '../src/schema.js'

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
})
