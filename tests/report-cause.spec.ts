import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import YAML from 'yaml'
import { afterEach, describe, expect, it } from 'vitest'
import { findCause } from '../src/cause.js'
import { runProcess } from '../src/process.js'
import { buildReport, renderMarkdown } from '../src/report.js'
import type { CaseDefinition, HarnessComponent, RunResult } from '../src/types.js'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

const definition: CaseDefinition = {
  version: 1,
  id: 'case-under-test',
  fixture: { repository: 'fixture', git_ref: 'HEAD', cwd: '.' },
  runner: { adapter: 'command', command: 'node', args: ['agent.mjs'], timeout_seconds: 30 },
  task: { prompt: 'run the fixture' },
  checks: [{ id: 'boundary', type: 'diff-path', forbid: ['public.txt'] }],
}

function makeRun(overrides: {
  label?: string
  commit?: string
  caseDefinition?: CaseDefinition
  profile?: string
  components?: HarnessComponent[]
  runtime?: { platform: NodeJS.Platform; arch: string; node: string }
  passed?: boolean
} = {}): RunResult {
  const commit = overrides.commit ?? 'commit-a'
  const caseDefinition = overrides.caseDefinition ?? definition
  const passed = overrides.passed ?? true
  const profile = overrides.profile
  return {
    schema: 1,
    id: `${overrides.label ?? 'run'}-id`,
    case_id: caseDefinition.id,
    label: overrides.label ?? 'run',
    started_at: '2026-08-20T00:00:00.000Z',
    completed_at: '2026-08-20T00:00:01.000Z',
    passed,
    passed_trials: passed ? 1 : 0,
    total_trials: 1,
    case_file: '/tmp/case.yaml',
    output_dir: '/tmp/run',
    manifest: {
      schema: 1,
      adapter: caseDefinition.runner.adapter,
      ...(profile === undefined ? {} : { profile }),
      repository: { path: '/tmp/fixture', git_ref: 'HEAD', commit },
      case_definition: caseDefinition,
      components: overrides.components ?? [],
      runtime: overrides.runtime ?? { platform: 'darwin', arch: 'arm64', node: 'v24.19.0' },
    },
    trials: [{
      trial: 1,
      passed,
      worktree: '/tmp/worktree',
      commit,
      started_at: '2026-08-20T00:00:00.000Z',
      duration_ms: 1,
      executor: {
        command: 'true',
        exit_code: 0,
        signal: null,
        timed_out: false,
        aborted: false,
        stdout: '/tmp/stdout.log',
        stderr: '/tmp/stderr.log',
        duration_ms: 1,
      },
      changed_paths: [],
      checks: [],
    }],
  }
}

async function writeRun(root: string, name: string, run: RunResult): Promise<string> {
  const file = join(root, `${name}.json`)
  await writeFile(file, `${JSON.stringify(run, null, 2)}\n`)
  return file
}

async function git(root: string, args: string[]): Promise<void> {
  const result = await runProcess('git', args, { cwd: root })
  if (result.exitCode !== 0) throw new Error(result.stderr || result.stdout)
}

describe('report comparison and cause scope', () => {
  it('rejects runs resolved from different baseline commits', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-regression-report-'))
    temporaryRoots.push(root)
    const first = await writeRun(root, 'first', makeRun({ label: 'baseline' }))
    const second = await writeRun(root, 'second', makeRun({ label: 'candidate', commit: 'commit-b' }))

    await expect(buildReport([first, second])).rejects.toThrow('same baseline commit')
  })

  it('rejects different case definitions but reports deliberate environment comparisons', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-regression-report-'))
    temporaryRoots.push(root)
    const component: HarnessComponent = {
      id: 'plugin:experimental',
      kind: 'plugin',
      env: { DSH_EXPERIMENTAL: '1' },
    }
    const first = await writeRun(root, 'first', makeRun({ label: 'baseline', profile: 'headless' }))
    const second = await writeRun(root, 'second', makeRun({
      label: 'candidate',
      profile: 'experimental',
      components: [component],
      runtime: { platform: 'linux', arch: 'x64', node: 'v24.19.0' },
    }))
    const report = await buildReport([first, second])
    expect(report.baseline.commit).toBe('commit-a')
    expect(report.comparison_warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('profiles'),
      expect.stringContaining('environment overlays/components'),
      expect.stringContaining('runtime environments'),
    ]))
    expect(report.environment[1]).toMatchObject({ label: 'candidate', profile: 'experimental', components: [component] })
    expect(renderMarkdown(report)).toContain('## Comparison warnings')
    expect(renderMarkdown(report)).toContain('| candidate | experimental | plugin:experimental |')

    const changedDefinition: CaseDefinition = {
      ...definition,
      task: { prompt: 'a different task' },
    }
    const different = await writeRun(root, 'different', makeRun({ caseDefinition: changedDefinition }))
    await expect(buildReport([first, different])).rejects.toThrow('same case definition')
  })

  it('does not hide a failing middle candidate in a multi-run report', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-regression-report-'))
    temporaryRoots.push(root)
    const baseline = await writeRun(root, 'baseline', makeRun({ label: 'baseline' }))
    const failing = await writeRun(root, 'failing', makeRun({ label: 'candidate-a', passed: false }))
    const passing = await writeRun(root, 'passing', makeRun({ label: 'candidate-b' }))

    const report = await buildReport([baseline, failing, passing])
    expect(report.status).toBe('REGRESSION')
  })

  it('states that cause minimization covers declared overlays, not plugin/profile installation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-regression-cause-'))
    temporaryRoots.push(root)
    await writeFile(join(root, 'agent.mjs'), `
      import { writeFile } from 'node:fs/promises'
      if (process.env.BREAK_PUBLIC === '1') await writeFile('public.txt', 'broken\\n')
    `)
    await writeFile(join(root, 'case.yaml'), YAML.stringify({
      version: 1,
      id: 'overlay-cause',
      fixture: { repository: '.', git_ref: 'HEAD', cwd: '.' },
      runner: { adapter: 'command', command: 'node', args: ['agent.mjs'], timeout_seconds: 30 },
      task: { prompt: 'run the fixture' },
      checks: [{ id: 'public-boundary', type: 'diff-path', forbid: ['public.txt'] }],
    }))
    await writeFile(join(root, 'cause.yaml'), YAML.stringify({
      version: 1,
      components: [{ id: 'plugin:breaker', kind: 'plugin', env: { BREAK_PUBLIC: '1' } }],
    }))
    await git(root, ['init', '-b', 'main'])
    await git(root, ['config', 'user.email', 'tests@example.com'])
    await git(root, ['config', 'user.name', 'Tests'])
    await git(root, ['add', '--', 'agent.mjs', 'case.yaml', 'cause.yaml'])
    await git(root, ['commit', '-m', 'fixture'])

    const cause = await findCause({
      caseFile: join(root, 'case.yaml'),
      specFile: join(root, 'cause.yaml'),
      trials: 1,
      outputRoot: join(root, 'runs'),
      output: join(root, 'cause-result.json'),
    })
    expect(cause.result.status).toBe('confirmed')
    expect(cause.result.scope).toBe('environment-overlays')
    expect(cause.result.scope_note).toContain('user-declared environment overlays')
    expect(cause.result.scope_note).toContain('does not install, uninstall, or verify DSH plugins or profiles')
    expect(cause.result.explanation).toContain('environment overlays')
    expect(cause.result.explanation).not.toContain('installed DSH plugin')

    const probeRun = JSON.parse(await readFile(cause.result.probes[0]!.run_file, 'utf8')) as RunResult
    expect(probeRun.manifest.case_definition).toBeDefined()
    expect('profile' in probeRun.manifest.case_definition.runner).toBe(false)
  })
})
