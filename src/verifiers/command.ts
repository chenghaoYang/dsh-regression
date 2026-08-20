import { resolve } from 'node:path'
import { runShell } from '../process.js'
import type { CheckResult, CommandCheck } from '../types.js'

export async function verifyCommand(check: CommandCheck, worktree: string): Promise<CheckResult> {
  const result = await runShell(
    check.run,
    resolve(worktree, check.cwd ?? '.'),
    (check.timeout_seconds ?? 300) * 1000,
  )
  return {
    id: check.id,
    type: check.type,
    passed: result.exitCode === 0,
    message: result.exitCode === 0 ? `command passed: ${check.run}` : `command failed (${result.exitCode ?? result.signal}): ${check.run}`,
    duration_ms: result.durationMs,
    details: { exit_code: result.exitCode, signal: result.signal, stdout: result.stdout, stderr: result.stderr },
  }
}
