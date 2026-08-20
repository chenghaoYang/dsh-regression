import { resolve } from 'node:path'
import { runProcess } from '../process.js'
import type { RegressionCase, RunnerSpec } from '../types.js'

function render(value: string, prompt: string, worktree: string, profile?: string): string {
  return value
    .replaceAll('{prompt}', prompt)
    .replaceAll('{worktree}', worktree)
    .replaceAll('{profile}', profile ?? '')
}

export async function executeAgent(
  regressionCase: RegressionCase,
  worktree: string,
  profileOverride?: string,
  componentEnv?: Record<string, string>,
) {
  const runner: RunnerSpec = regressionCase.runner
  const profile = profileOverride ?? runner.profile ?? 'headless'
  const command = runner.adapter === 'dsh' ? (runner.command ?? 'dsh') : runner.command!
  const defaultArgs = runner.adapter === 'dsh' ? ['--profile', profile, '{prompt}'] : []
  const args = (runner.args ?? defaultArgs).map(value => render(value, regressionCase.task.prompt, worktree, profile))
  return runProcess(command, args, {
    cwd: resolve(worktree, regressionCase.fixture.cwd ?? '.'),
    timeoutMs: (runner.timeout_seconds ?? 900) * 1000,
    env: {
      ...runner.env,
      ...componentEnv,
      DSH_REGRESSION_CASE_ID: regressionCase.id,
      DSH_REGRESSION_WORKTREE: worktree,
    },
  })
}
