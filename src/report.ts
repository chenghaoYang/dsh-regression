import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { RunResult } from './types.js'

export async function loadRun(file: string): Promise<RunResult> {
  const value: unknown = JSON.parse(await readFile(resolve(file), 'utf8'))
  if (value === null || typeof value !== 'object' || (value as { schema?: unknown }).schema !== 1) {
    throw new Error(`${file} is not a dsh-regression run`)
  }
  return value as RunResult
}

export interface RegressionReport {
  schema: 1
  case: string
  status: 'PASS' | 'FAIL' | 'REGRESSION' | 'IMPROVEMENT' | 'MIXED'
  runs: Array<{ label: string; passed: boolean; passed_trials: number; total_trials: number; file: string }>
  failed_checks: Array<{ run: string; trial: number; check: string; message: string }>
}

export async function buildReport(runFiles: string[]): Promise<RegressionReport> {
  if (runFiles.length === 0) throw new Error('report needs at least one run file')
  const runs = await Promise.all(runFiles.map(loadRun))
  const caseId = runs[0]!.case_id
  if (runs.some(run => run.case_id !== caseId)) throw new Error('all runs in one report must use the same case')
  let status: RegressionReport['status']
  if (runs.length === 1) status = runs[0]!.passed ? 'PASS' : 'FAIL'
  else if (runs[0]!.passed && !runs.at(-1)!.passed) status = 'REGRESSION'
  else if (!runs[0]!.passed && runs.at(-1)!.passed) status = 'IMPROVEMENT'
  else if (runs.every(run => run.passed)) status = 'PASS'
  else status = 'MIXED'
  return {
    schema: 1,
    case: caseId,
    status,
    runs: runs.map((run, index) => ({
      label: run.label,
      passed: run.passed,
      passed_trials: run.passed_trials,
      total_trials: run.total_trials,
      file: resolve(runFiles[index]!),
    })),
    failed_checks: runs.flatMap(run => run.trials.flatMap(trial => trial.checks
      .filter(check => !check.passed)
      .map(check => ({ run: run.label, trial: trial.trial, check: check.id, message: check.message })))),
  }
}

export function renderMarkdown(report: RegressionReport): string {
  const lines = [
    `# Agent Behavior Regression Report`,
    '',
    `**Case:** \`${report.case}\`  `,
    `**Status:** **${report.status}**`,
    '',
    '| Run | Result | Trials |',
    '| --- | --- | ---: |',
    ...report.runs.map(run => `| ${run.label} | ${run.passed ? 'PASS' : 'FAIL'} | ${run.passed_trials}/${run.total_trials} |`),
  ]
  if (report.failed_checks.length > 0) {
    lines.push('', '## Failed checks', '')
    for (const failure of report.failed_checks) {
      lines.push(`- ${failure.run} trial ${failure.trial}, \`${failure.check}\`: ${failure.message}`)
    }
  }
  return `${lines.join('\n')}\n`
}

export async function writeReport(runFiles: string[], format: 'json' | 'markdown', out?: string): Promise<{ report: RegressionReport; text: string }> {
  const report = await buildReport(runFiles)
  const text = format === 'json' ? `${JSON.stringify(report, null, 2)}\n` : renderMarkdown(report)
  if (out !== undefined) await writeFile(resolve(out), text)
  return { report, text }
}
