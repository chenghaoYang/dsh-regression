import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import YAML from 'yaml'
import { afterEach, describe, expect, it } from 'vitest'
import { changedPaths, createWorktree, diffPatch, removeWorktree } from '../src/git.js'
import { runProcess } from '../src/process.js'
import { runCase } from '../src/runner.js'
import { verifyApiSnapshot } from '../src/verifiers/api-snapshot.js'
import { verifyCommand } from '../src/verifiers/command.js'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function git(root: string, args: string[]) {
  const result = await runProcess('git', args, { cwd: root })
  if (result.exitCode !== 0) throw new Error(result.stderr || result.stdout)
  return result.stdout.trim()
}

async function repository(): Promise<{ root: string; commit: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-regression-observability-'))
  temporaryRoots.push(root)
  await mkdir(join(root, 'src/public'), { recursive: true })
  await mkdir(join(root, 'src/internal'), { recursive: true })
  await writeFile(join(root, 'src/public/api.js'), 'export const stable = true\n')
  await writeFile(join(root, 'src/internal/cache.js'), 'export const version = 1\n')
  await git(root, ['init', '-b', 'main'])
  await git(root, ['config', 'user.email', 'tests@example.com'])
  await git(root, ['config', 'user.name', 'Tests'])
  await git(root, ['add', '--', 'src'])
  await git(root, ['commit', '-m', 'fixture'])
  return { root, commit: await git(root, ['rev-parse', 'HEAD']) }
}

function shellQuote(value: string): string {
  return `"${value.replaceAll('"', '\\"')}"`
}

function hangingScript(): string {
  return 'process.on("SIGTERM", () => process.exit(0)); setTimeout(() => {}, 10000)'
}

describe('observability regressions', () => {
  it('reports committed edits relative to the trial start commit', async () => {
    const fixture = await repository()
    const worktree = await createWorktree(fixture.root, fixture.commit, 'committed-edit')
    try {
      await writeFile(join(worktree.path, 'src/internal/cache.js'), 'export const version = 2\n')
      await git(worktree.path, ['add', '--', 'src/internal/cache.js'])
      await git(worktree.path, ['commit', '-m', 'agent commit'])

      await expect(changedPaths(worktree.path, worktree.commit)).resolves.toContainEqual({
        path: 'src/internal/cache.js',
        status: 'modified',
      })
      await expect(diffPatch(worktree.path, worktree.commit)).resolves.toContain('export const version = 2')
    } finally {
      await removeWorktree(fixture.root, worktree.path)
    }
  })

  it('exposes both sides of a rename so a forbidden old path still matches', async () => {
    const fixture = await repository()
    const worktree = await createWorktree(fixture.root, fixture.commit, 'rename')
    try {
      await git(worktree.path, ['mv', 'src/public/api.js', 'src/internal/api.js'])
      const changed = await changedPaths(worktree.path, worktree.commit)
      expect(changed).toEqual(expect.arrayContaining([
        { path: 'src/public/api.js', status: 'deleted' },
        { path: 'src/internal/api.js', status: 'renamed' },
      ]))
    } finally {
      await removeWorktree(fixture.root, worktree.path)
    }
  })

  it('marks a SIGTERM-trapping process as timed out even when it exits zero', async () => {
    const fixture = await repository()
    const result = await runProcess(process.execPath, ['-e', hangingScript()], {
      cwd: fixture.root,
      timeoutMs: 40,
    })
    expect(result.exitCode).toBe(0)
    expect(result.timedOut).toBe(true)
    expect(result.aborted).toBe(false)
  })

  it('propagates timeout to command and API-snapshot verifiers', async () => {
    const fixture = await repository()
    const script = join(fixture.root, 'hang.mjs')
    await writeFile(script, hangingScript())
    await writeFile(join(fixture.root, 'baseline.txt'), 'stable\n')
    const command = `${shellQuote(process.execPath)} ${shellQuote(script)}`

    const commandResult = await verifyCommand({
      id: 'command-timeout',
      type: 'command',
      run: command,
      timeout_seconds: 1,
    }, fixture.root)
    expect(commandResult.passed).toBe(false)
    expect(commandResult.details).toMatchObject({ timed_out: true })

    const apiResult = await verifyApiSnapshot({
      id: 'api-timeout',
      type: 'api-snapshot',
      run: command,
      baseline: 'baseline.txt',
      timeout_seconds: 1,
    }, fixture.root, { content: 'stable\n' })
    expect(apiResult.passed).toBe(false)
    expect(apiResult.details).toMatchObject({ timed_out: true })
  })

  it('propagates RunOptions.signal and cleans up the aborted worktree', async () => {
    const fixture = await repository()
    const script = join(fixture.root, 'hang.mjs')
    const caseFile = join(fixture.root, 'case.yaml')
    await writeFile(script, hangingScript())
    await writeFile(caseFile, YAML.stringify({
      version: 1,
      id: 'aborted-trial',
      fixture: { repository: '.', git_ref: 'HEAD', cwd: '.' },
      runner: { adapter: 'command', command: process.execPath, args: ['hang.mjs'], timeout_seconds: 30 },
      task: { prompt: 'run the fixture' },
      checks: [{ id: 'no-change', type: 'diff-path', max_files: 1 }],
    }))
    await git(fixture.root, ['add', '--', 'hang.mjs', 'case.yaml'])
    await git(fixture.root, ['commit', '-m', 'add runner fixture'])

    const controller = new AbortController()
    const running = runCase({ caseFile, outputRoot: join(fixture.root, 'runs'), signal: controller.signal })
    setTimeout(() => controller.abort(), 40)
    await expect(running).rejects.toThrow('aborted')
    const worktrees = await git(fixture.root, ['worktree', 'list', '--porcelain'])
    expect(worktrees.match(/^worktree /gmu)).toHaveLength(1)
  })
})
