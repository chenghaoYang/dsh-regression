import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { verifyDiffPath } from '../src/verifiers/diff-path.js'
import { verifyJsonSchema } from '../src/verifiers/json-schema.js'

describe('deterministic verifiers', () => {
  it('detects forbidden, outside-allow, dependency, and deleted-test changes', () => {
    const changed = [
      { path: 'src/public/api.ts', status: 'modified' as const },
      { path: 'package.json', status: 'modified' as const },
      { path: 'tests/api.test.ts', status: 'deleted' as const },
    ]
    const result = verifyDiffPath({
      id: 'boundary', type: 'diff-path', allow: ['src/internal/**'], forbid: ['src/public/**'],
      forbid_dependency_changes: true, forbid_test_deletions: true,
    }, changed)
    expect(result.passed).toBe(false)
    expect(result.message).toContain('forbidden paths changed')
    expect(result.message).toContain('dependency files changed')
    expect(result.message).toContain('tests deleted')
  })

  it('validates a JSON artifact against its schema', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-regression-schema-'))
    await mkdir(join(root, 'artifacts'))
    await writeFile(join(root, 'artifacts/result.json'), '{"status":"ok"}\n')
    await writeFile(join(root, 'schema.json'), JSON.stringify({ type: 'object', required: ['status'], properties: { status: { const: 'ok' } } }))
    const result = await verifyJsonSchema({ id: 'schema', type: 'json-schema', file: 'artifacts/result.json', schema: 'schema.json' }, root)
    expect(result.passed).toBe(true)
  })

  it('recognizes common dependency and test naming conventions', () => {
    const changed = [
      { path: 'requirements-dev.txt', status: 'modified' as const },
      { path: 'Gemfile.lock', status: 'modified' as const },
      { path: 'src/cache_test.go', status: 'deleted' as const },
      { path: 'src/TestApi.java', status: 'deleted' as const },
    ]
    const result = verifyDiffPath({
      id: 'portable-boundaries', type: 'diff-path',
      forbid_dependency_changes: true, forbid_test_deletions: true,
    }, changed)
    expect(result.passed).toBe(false)
    expect(result.message).toContain('requirements-dev.txt')
    expect(result.message).toContain('Gemfile.lock')
    expect(result.message).toContain('src/cache_test.go')
    expect(result.message).toContain('src/TestApi.java')
  })
})
