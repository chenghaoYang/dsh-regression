import { resolve } from 'node:path'
import { runShell } from '../process.js'
import type { CheckResult, CommandCheck } from '../types.js'

export async function verifyCommand(check: CommandCheck, worktree: string, signal?: AbortSignal): Promise<CheckResult> {
  const result = await runShell(
    check.run,
    resolve(worktree, check.cwd ?? '.'),
    (check.timeout_seconds ?? 300) * 1000,
    undefined,
    signal,
  )
  const passed = result.exitCode === 0 && result.signal === null && !result.timedOut && !result.aborted
  const reason = result.timedOut
    ? 'timed out'
    : result.aborted
      ? 'aborted'
      : `failed (${result.exitCode ?? result.signal})`
  return {
    id: check.id,
    type: check.type,
    passed,
    message: passed ? `command passed: ${check.run}` : `command ${reason}: ${check.run}`,
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
