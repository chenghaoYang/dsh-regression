import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import YAML from 'yaml'
import { describe, expect, it } from 'vitest'
import { captureCase } from '../src/capture.js'
import { findCause } from '../src/cause.js'
import { runProcess } from '../src/process.js'
import { runCase } from '../src/runner.js'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-regression-fixture-'))
  await mkdir(join(root, 'src/public'), { recursive: true })
  await mkdir(join(root, 'src/internal'), { recursive: true })
  await writeFile(join(root, 'src/public/api.txt'), 'stable\n')
  await writeFile(join(root, 'src/internal/value.txt'), 'old\n')
  await writeFile(join(root, 'api-baseline.txt'), 'stable\n')
  await writeFile(join(root, 'artifact.json'), '{"status":"ok"}\n')
  await writeFile(join(root, 'artifact.schema.json'), JSON.stringify({
    type: 'object', required: ['status'], properties: { status: { const: 'ok' } },
  }))
  await writeFile(join(root, 'surface.mjs'), `
    import { readFile } from 'node:fs/promises'
    process.stdout.write(await readFile('api-baseline.txt', 'utf8'))
  `)
  await writeFile(join(root, 'agent.mjs'), `
    import { writeFile } from 'node:fs/promises'
    await writeFile('src/internal/value.txt', 'new\\n')
    if (process.env.BREAK_PUBLIC === '1') await writeFile('src/public/api.txt', 'broken\\n')
    if (process.env.TAMPER_CONTRACTS === '1') {
      await writeFile('api-baseline.txt', 'broken\\n')
      await writeFile('artifact.json', '{"status":"broken"}\\n')
      await writeFile('artifact.schema.json', JSON.stringify({ type: 'object', properties: { status: { const: 'broken' } } }))
    }
  `)
  const caseFile = join(root, 'case.yaml')
  await writeFile(caseFile, YAML.stringify({
    version: 1,
    id: 'public-boundary',
    fixture: { repository: '.', git_ref: 'HEAD', cwd: '.' },
    runner: { adapter: 'command', command: 'node', args: ['agent.mjs'], timeout_seconds: 30 },
    task: { prompt: 'change only internal files' },
    run: { trials: 2, pass_policy: 'all' },
    checks: [{ id: 'public', type: 'diff-path', forbid: ['src/public/**'] }],
  }))
  const contractCaseFile = join(root, 'contract-case.yaml')
  await writeFile(contractCaseFile, YAML.stringify({
    version: 1,
    id: 'immutable-contracts',
    fixture: { repository: '.', git_ref: 'HEAD', cwd: '.' },
    runner: { adapter: 'command', command: 'node', args: ['agent.mjs'], env: { TAMPER_CONTRACTS: '1' } },
    task: { prompt: 'change the implementation' },
    checks: [
      { id: 'api', type: 'api-snapshot', run: 'node surface.mjs', baseline: 'api-baseline.txt' },
      { id: 'schema', type: 'json-schema', file: 'artifact.json', schema: 'artifact.schema.json' },
    ],
  }))
  await runProcess('git', ['init', '-b', 'main'], { cwd: root })
  await runProcess('git', ['config', 'user.email', 'tests@example.com'], { cwd: root })
  await runProcess('git', ['config', 'user.name', 'Tests'], { cwd: root })
  await runProcess('git', ['add', '--',
    'agent.mjs', 'surface.mjs', 'case.yaml', 'contract-case.yaml',
    'api-baseline.txt', 'artifact.json', 'artifact.schema.json',
    'src/public/api.txt', 'src/internal/value.txt'], { cwd: root })
  await runProcess('git', ['commit', '-m', 'fixture'], { cwd: root })
  return { root, caseFile, contractCaseFile }
}

describe('isolated runner and cause minimization', () => {
  it('runs trials in worktrees without changing the source checkout', async () => {
    const test = await fixture()
    const run = await runCase({ caseFile: test.caseFile, outputRoot: join(test.root, 'runs') })
    expect(run.result.passed_trials).toBe(2)
    expect(await readFile(join(test.root, 'src/internal/value.txt'), 'utf8')).toBe('old\n')
  })

  it('finds the one failure-inducing component and verifies its removal', async () => {
    const test = await fixture()
    const specFile = join(test.root, 'cause.yaml')
    await writeFile(specFile, YAML.stringify({
      version: 1,
      components: [{ id: 'plugin:breaker', kind: 'plugin', env: { BREAK_PUBLIC: '1' } }],
    }))
    const cause = await findCause({
      caseFile: test.caseFile,
      specFile,
      trials: 1,
      outputRoot: join(test.root, 'cause-runs'),
      output: join(test.root, 'cause-result.json'),
    })
    expect(cause.result.status).toBe('confirmed')
    expect(cause.result.minimal_set.map(component => component.id)).toEqual(['plugin:breaker'])
  })

  it('does not let an agent rewrite API and schema baselines to make itself pass', async () => {
    const test = await fixture()
    const run = await runCase({ caseFile: test.contractCaseFile, trials: 1, outputRoot: join(test.root, 'contract-runs') })
    expect(run.result.passed).toBe(false)
    expect(run.result.trials[0]!.checks.map(check => [check.id, check.passed])).toEqual([
      ['api', false],
      ['schema', false],
    ])
    expect(await readFile(join(test.root, 'api-baseline.txt'), 'utf8')).toBe('stable\n')
  })

  it('omits an empty allow list when capture only receives forbid paths', async () => {
    const test = await fixture()
    const captured = await captureCase({
      id: 'forbid-only',
      prompt: 'change internal code',
      cwd: test.root,
      output: join(test.root, 'captured.yaml'),
      forbidPaths: ['src/public/**'],
      allowPaths: [],
    })
    expect(captured.regressionCase.checks).toEqual([{
      id: 'path-boundary', type: 'diff-path', forbid: ['src/public/**'],
    }])
  })
})
