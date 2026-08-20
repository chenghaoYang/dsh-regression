import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { executeAgent } from './adapters/command.js'
import { changedPaths, createWorktree, diffPatch, gitRoot, removeWorktree, resolveCommit } from './git.js'
import { loadCase } from './schema.js'
import type { CheckResult, RunManifest, RunOptions, RunResult, TrialResult } from './types.js'
import { snapshotVerifierInputs, verify } from './verifiers/index.js'

function timestamp(): string {
  return new Date().toISOString().replaceAll(':', '').replaceAll('.', '-')
}

export async function runCase(options: RunOptions): Promise<{ result: RunResult; file: string }> {
  const caseFile = resolve(options.caseFile)
  const regressionCase = await loadCase(caseFile)
  const caseDir = dirname(caseFile)
  const repository = await gitRoot(resolve(caseDir, regressionCase.fixture.repository))
  const commit = await resolveCommit(repository, regressionCase.fixture.git_ref)
  const label = options.label ?? options.profile ?? regressionCase.runner.profile ?? 'run'
  const runId = `${label}-${timestamp()}`
  const outputRoot = resolve(options.outputRoot ?? resolve(repository, '.dsh-regression', 'runs'))
  const outputDir = resolve(outputRoot, regressionCase.id, runId)
  await mkdir(outputDir, { recursive: true })
  const startedAt = new Date().toISOString()
  const trials = options.trials ?? regressionCase.run?.trials ?? 1
  const manifest: RunManifest = {
    schema: 1,
    adapter: regressionCase.runner.adapter,
    ...((options.profile ?? regressionCase.runner.profile) === undefined
      ? {}
      : { profile: (options.profile ?? regressionCase.runner.profile)! }),
    repository: { path: repository, git_ref: regressionCase.fixture.git_ref, commit },
    components: options.components ?? [],
    runtime: { platform: process.platform, arch: process.arch, node: process.version },
  }
  const trialResults: TrialResult[] = []
  for (let trial = 1; trial <= trials; trial += 1) {
    const started = Date.now()
    const trialStarted = new Date().toISOString()
    const worktree = await createWorktree(repository, commit, `${regressionCase.id}-${trial}`)
    const trialDir = resolve(outputDir, `trial-${trial}`)
    await mkdir(trialDir, { recursive: true })
    const verifierSnapshots = await snapshotVerifierInputs(regressionCase.checks, worktree.path)
    const executor = await executeAgent(regressionCase, worktree.path, options.profile, options.componentEnv)
    const changed = await changedPaths(worktree.path)
    const checkResults: CheckResult[] = []
    if (executor.exitCode !== 0) {
      checkResults.push({
        id: 'runner',
        type: 'runner',
        passed: false,
        message: `agent runner failed (${executor.exitCode ?? executor.signal})`,
      })
    }
    for (const check of regressionCase.checks) {
      checkResults.push(await verify(check, worktree.path, changed, verifierSnapshots))
    }
    const patch = await diffPatch(worktree.path)
    await Promise.all([
      writeFile(resolve(trialDir, 'stdout.log'), executor.stdout),
      writeFile(resolve(trialDir, 'stderr.log'), executor.stderr),
      writeFile(resolve(trialDir, 'changes.patch'), patch),
    ])
    const result: TrialResult = {
      trial,
      passed: checkResults.every(check => check.passed),
      worktree: worktree.path,
      commit: worktree.commit,
      started_at: trialStarted,
      duration_ms: Date.now() - started,
      executor: {
        command: executor.command,
        exit_code: executor.exitCode,
        signal: executor.signal,
        stdout: resolve(trialDir, 'stdout.log'),
        stderr: resolve(trialDir, 'stderr.log'),
        duration_ms: executor.durationMs,
      },
      changed_paths: changed,
      checks: checkResults,
    }
    trialResults.push(result)
    await writeFile(resolve(trialDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`)
    if (options.keepWorktrees !== true) await removeWorktree(repository, worktree.path)
  }
  const passedTrials = trialResults.filter(trial => trial.passed).length
  const result: RunResult = {
    schema: 1,
    id: runId,
    case_id: regressionCase.id,
    label,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    passed: passedTrials === trials,
    passed_trials: passedTrials,
    total_trials: trials,
    case_file: caseFile,
    output_dir: outputDir,
    manifest,
    trials: trialResults,
  }
  const file = resolve(outputDir, 'run.json')
  await writeFile(file, `${JSON.stringify(result, null, 2)}\n`)
  return { result, file }
}
