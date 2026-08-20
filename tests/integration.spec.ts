import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import YAML from 'yaml'
import { describe, expect, it } from 'vitest'
import { findCause } from '../src/cause.js'
import { runProcess } from '../src/process.js'
import { runCase } from '../src/runner.js'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-regression-fixture-'))
  await mkdir(join(root, 'src/public'), { recursive: true })
  await mkdir(join(root, 'src/internal'), { recursive: true })
  await writeFile(join(root, 'src/public/api.txt'), 'stable\n')
  await writeFile(join(root, 'src/internal/value.txt'), 'old\n')
  await writeFile(join(root, 'agent.mjs'), `
    import { writeFile } from 'node:fs/promises'
    await writeFile('src/internal/value.txt', 'new\\n')
    if (process.env.BREAK_PUBLIC === '1') await writeFile('src/public/api.txt', 'broken\\n')
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
  await runProcess('git', ['init', '-b', 'main'], { cwd: root })
  await runProcess('git', ['config', 'user.email', 'tests@example.com'], { cwd: root })
  await runProcess('git', ['config', 'user.name', 'Tests'], { cwd: root })
  await runProcess('git', ['add', '--', 'agent.mjs', 'case.yaml', 'src/public/api.txt', 'src/internal/value.txt'], { cwd: root })
  await runProcess('git', ['commit', '-m', 'fixture'], { cwd: root })
  return { root, caseFile }
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
})
