import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { runProcess } from './process.js'
import type { ChangedPath } from './types.js'

async function git(args: string[], cwd: string) {
  const result = await runProcess('git', args, { cwd })
  if (result.exitCode !== 0) throw new Error(`git ${args[0] ?? ''} failed: ${result.stderr.trim() || result.stdout.trim()}`)
  return result.stdout
}

export async function gitRoot(path: string): Promise<string> {
  return (await git(['rev-parse', '--show-toplevel'], resolve(path))).trim()
}

export async function resolveCommit(repository: string, ref: string): Promise<string> {
  return (await git(['rev-parse', `${ref}^{commit}`], repository)).trim()
}

export async function createWorktree(repository: string, ref: string, label: string): Promise<{ path: string; commit: string }> {
  const commit = await resolveCommit(repository, ref)
  const parent = await mkdtemp(join(tmpdir(), 'dsh-regression-'))
  const path = join(parent, `${basename(repository)}-${label}`)
  await git(['worktree', 'add', '--detach', path, commit], repository)
  return { path, commit }
}

export async function removeWorktree(repository: string, path: string): Promise<void> {
  await git(['worktree', 'remove', '--force', path], repository)
  await rm(dirname(path), { recursive: true, force: true })
}

export async function diffPatch(worktree: string, initialCommit: string): Promise<string> {
  const tracked = await git(['diff', '--binary', initialCommit], worktree)
  const untracked = (await git(['ls-files', '--others', '--exclude-standard'], worktree))
    .split('\n').filter(Boolean)
  return tracked + (untracked.length === 0 ? '' : `\nUntracked files:\n${untracked.join('\n')}\n`)
}

function parseNameStatus(raw: string): ChangedPath[] {
  const parts = raw.split('\0').filter(Boolean)
  const changed: ChangedPath[] = []
  for (let index = 0; index < parts.length;) {
    const status = parts[index++] ?? ''
    if (status.startsWith('R')) {
      const source = parts[index++]
      const target = parts[index++]
      if (source !== undefined) changed.push({ path: source, status: 'deleted' })
      if (target !== undefined) changed.push({ path: target, status: 'renamed' })
      continue
    }
    const path = parts[index++]
    if (path === undefined) continue
    changed.push({
      path,
      status: status === 'A' ? 'added' : status === 'D' ? 'deleted' : 'modified',
    })
  }
  return changed
}

export async function changedPaths(worktree: string, initialCommit: string): Promise<ChangedPath[]> {
  const tracked = parseNameStatus(await git(['diff', '--find-renames', '--name-status', '-z', initialCommit], worktree))
  const untracked = (await git(['ls-files', '--others', '--exclude-standard', '-z'], worktree))
    .split('\0').filter(Boolean).map(path => ({ path, status: 'untracked' as const }))
  return [...tracked, ...untracked].sort((a, b) => a.path.localeCompare(b.path))
}
