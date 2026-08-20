import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import YAML from 'yaml'
import { gitRoot, resolveCommit } from './git.js'
import type { RegressionCase, RegressionCheck } from './types.js'

export interface CaptureOptions {
  id: string
  prompt: string
  correction?: string
  cwd: string
  output?: string
  profile?: string
  trials?: number
  forbidPaths?: string[]
  allowPaths?: string[]
  commands?: string[]
  source?: { session_id?: string; turn_id?: number }
}

function slug(value: string): string {
  const normalized = value.toLowerCase().trim().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '')
  if (normalized === '') throw new Error('case id must contain letters or digits')
  return normalized
}

function pathHints(correction: string, phrase: RegExp): string[] {
  const matches: string[] = []
  for (const match of correction.matchAll(phrase)) {
    const value = match[1]?.trim()
    if (value !== undefined && /[/*.[\]_-]/u.test(value)) matches.push(value)
  }
  return matches
}

export function inferChecks(correction: string): RegressionCheck[] {
  const checks: RegressionCheck[] = []
  const forbid = pathHints(correction, /(?:do not modify|don't modify|不要修改|禁止修改)\s+[`“"]?([^`”"，。;\n]+)[`”"]?/giu)
  const allow = pathHints(correction, /(?:only modify|只能修改)\s+[`“"]?([^`”"，。;\n]+)[`”"]?/giu)
  const lower = correction.toLowerCase()
  if (/public\s*api|公共\s*api|公开\s*api/u.test(lower)) forbid.push('src/public/**', 'public/**')
  const dependency = /(?:do not|don't|no)\s+(?:add|change).*dependenc|不要(?:新增|修改).*依赖|禁止(?:新增|修改).*依赖/iu.test(correction)
  const testDeletion = /(?:do not|don't|no)\s+delete.*test|不要删除.*测试|禁止删除.*测试/iu.test(correction)
  if (forbid.length > 0 || allow.length > 0 || dependency || testDeletion) {
    checks.push({
      id: 'behavior-boundary',
      type: 'diff-path',
      ...(allow.length === 0 ? {} : { allow: [...new Set(allow)] }),
      ...(forbid.length === 0 ? {} : { forbid: [...new Set(forbid)] }),
      ...(dependency ? { forbid_dependency_changes: true } : {}),
      ...(testDeletion ? { forbid_test_deletions: true } : {}),
    })
  }
  return checks
}

export async function captureCase(options: CaptureOptions): Promise<{ regressionCase: RegressionCase; file: string }> {
  const repository = await gitRoot(options.cwd)
  const commit = await resolveCommit(repository, 'HEAD')
  const id = slug(options.id)
  const file = resolve(options.output ?? resolve(repository, '.dsh-regression', 'cases', `${id}.yaml`))
  const checks: RegressionCheck[] = []
  if (options.correction !== undefined) checks.push(...inferChecks(options.correction))
  if ((options.forbidPaths?.length ?? 0) > 0 || (options.allowPaths?.length ?? 0) > 0) {
    checks.push({
      id: 'path-boundary', type: 'diff-path',
      ...((options.allowPaths?.length ?? 0) === 0 ? {} : { allow: options.allowPaths }),
      ...((options.forbidPaths?.length ?? 0) === 0 ? {} : { forbid: options.forbidPaths }),
    })
  }
  for (const [index, command] of (options.commands ?? []).entries()) {
    checks.push({ id: `command-${index + 1}`, type: 'command', run: command })
  }
  if (checks.length === 0) {
    throw new Error('could not infer a deterministic verifier; add --forbid-path, --allow-path, or --check-command')
  }
  const repoPath = relative(dirname(file), repository).replaceAll('\\', '/') || '.'
  const regressionCase: RegressionCase = {
    version: 1,
    id,
    title: options.correction ?? id,
    ...(options.correction === undefined ? {} : { description: `Captured correction: ${options.correction}` }),
    ...(options.source === undefined && options.correction === undefined ? {} : {
      source: { ...options.source, ...(options.correction === undefined ? {} : { correction: options.correction }) },
    }),
    fixture: { repository: repoPath, git_ref: commit, cwd: '.' },
    runner: { adapter: 'dsh', profile: options.profile ?? 'headless', timeout_seconds: 900 },
    task: { prompt: options.prompt },
    run: { trials: options.trials ?? 3, pass_policy: 'all' },
    checks,
  }
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, YAML.stringify(regressionCase, { lineWidth: 100 }))
  return { regressionCase, file }
}
