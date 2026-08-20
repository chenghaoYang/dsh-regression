import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { runShell } from '../process.js'
import type { ApiSnapshotCheck, CheckResult } from '../types.js'

function normalize(text: string): string {
  return text.replaceAll('\r\n', '\n').trimEnd()
}

export async function verifyApiSnapshot(
  check: ApiSnapshotCheck,
  worktree: string,
  baselineSnapshot?: { content?: string; error?: string },
  signal?: AbortSignal,
): Promise<CheckResult> {
  if (baselineSnapshot?.error !== undefined) {
    return { id: check.id, type: check.type, passed: false, message: baselineSnapshot.error }
  }
  if (baselineSnapshot?.content !== undefined) {
    try {
      const current = await readFile(resolve(worktree, check.baseline), 'utf8')
      if (current !== baselineSnapshot.content) {
        return { id: check.id, type: check.type, passed: false, message: `API baseline changed during the trial: ${check.baseline}` }
      }
    } catch (error) {
      return { id: check.id, type: check.type, passed: false, message: `API baseline became unreadable: ${error instanceof Error ? error.message : String(error)}` }
    }
  }
  const result = await runShell(
    check.run,
    resolve(worktree, check.cwd ?? '.'),
    (check.timeout_seconds ?? 300) * 1000,
    undefined,
    signal,
  )
  if (result.timedOut || result.aborted || result.exitCode !== 0 || result.signal !== null) {
    const reason = result.timedOut
      ? 'timed out'
      : result.aborted
        ? 'aborted'
        : `failed (${result.exitCode ?? result.signal})`
    return {
      id: check.id,
      type: check.type,
      passed: false,
      message: `API snapshot command ${reason}: ${check.run}`,
      duration_ms: result.durationMs,
      details: {
        exit_code: result.exitCode,
        signal: result.signal,
        timed_out: result.timedOut,
        aborted: result.aborted,
        stdout: result.stdout,
        stderr: result.stderr,
      },
    }
  }
  try {
    const expected = normalize(baselineSnapshot?.content ?? await readFile(resolve(worktree, check.baseline), 'utf8'))
    const actual = normalize(result.stdout)
    return {
      id: check.id,
      type: check.type,
      passed: actual === expected,
      message: actual === expected ? 'API surface matches the baseline' : `API surface differs from ${check.baseline}`,
      duration_ms: result.durationMs,
      details: { expected, actual },
    }
  } catch (error) {
    return { id: check.id, type: check.type, passed: false, message: error instanceof Error ? error.message : String(error) }
  }
}
