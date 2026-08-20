import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import type { CaseDefinition, HarnessComponent, RunManifest, RunResult } from './types.js'

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
  baseline: { repository: string; git_ref: string; commit: string }
  case_definition: CaseDefinition
  comparison_warnings: string[]
  environment: Array<{
    label: string
    profile?: string
    components: HarnessComponent[]
    runtime: RunManifest['runtime']
  }>
  runs: Array<{ label: string; passed: boolean; passed_trials: number; total_trials: number; file: string }>
  failed_checks: Array<{ run: string; trial: number; check: string; message: string }>
}

function profileLabel(profile: string | undefined): string {
  return profile ?? '(default)'
}

function componentsLabel(components: HarnessComponent[]): string {
  return components.length === 0 ? '(none)' : components.map(component => component.id).join(', ')
}

function distinct<T>(values: T[]): T[] {
  return values.filter((value, index) => values.findIndex(candidate => isDeepStrictEqual(candidate, value)) === index)
}

function comparisonWarnings(runs: RunResult[]): string[] {
  const warnings: string[] = []
  const profiles = distinct(runs.map(run => run.manifest.profile))
  if (profiles.length > 1) {
    warnings.push(`runs intentionally compare profiles: ${profiles.map(profileLabel).join(' vs ')}`)
  }
  const components = distinct(runs.map(run => run.manifest.components))
  if (components.length > 1) {
    warnings.push(`runs intentionally compare environment overlays/components: ${components.map(componentsLabel).join(' vs ')}`)
  }
  const runtimes = distinct(runs.map(run => run.manifest.runtime))
  if (runtimes.length > 1) {
    warnings.push('runs use different runtime environments; environment differences may affect the result')
  }
  const refs = distinct(runs.map(run => run.manifest.repository.git_ref))
  if (refs.length > 1) {
    warnings.push(`runs resolve the same baseline commit from different git refs: ${refs.join(' vs ')}`)
  }
  return warnings
}

export async function buildReport(runFiles: string[]): Promise<RegressionReport> {
  if (runFiles.length === 0) throw new Error('report needs at least one run file')
  const runs = await Promise.all(runFiles.map(loadRun))
  const caseId = runs[0]!.case_id
  if (runs.some(run => run.case_id !== caseId)) throw new Error('all runs in one report must use the same case')
  const first = runs[0]!
  if (runs.some(run => run.manifest.case_definition === undefined)) {
    throw new Error('all runs in one report must embed a case definition')
  }
  if (runs.some(run => run.manifest.repository.commit !== first.manifest.repository.commit)) {
    throw new Error('all runs in one report must use the same baseline commit')
  }
  if (runs.some(run => !isDeepStrictEqual(run.manifest.case_definition, first.manifest.case_definition))) {
    throw new Error('all runs in one report must use the same case definition')
  }
  let status: RegressionReport['status']
  if (runs.length === 1) status = runs[0]!.passed ? 'PASS' : 'FAIL'
  else if (runs[0]!.passed) status = runs.slice(1).every(run => run.passed) ? 'PASS' : 'REGRESSION'
  else if (runs.slice(1).every(run => run.passed)) status = 'IMPROVEMENT'
  else if (runs.every(run => !run.passed)) status = 'FAIL'
  else status = 'MIXED'
  return {
    schema: 1,
    case: caseId,
    status,
    baseline: {
      repository: first.manifest.repository.path,
      git_ref: first.manifest.repository.git_ref,
      commit: first.manifest.repository.commit,
    },
    case_definition: first.manifest.case_definition,
    comparison_warnings: comparisonWarnings(runs),
    environment: runs.map(run => ({
      label: run.label,
      ...(run.manifest.profile === undefined ? {} : { profile: run.manifest.profile }),
      components: run.manifest.components,
      runtime: run.manifest.runtime,
    })),
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
    `**Status:** **${report.status}**  `,
    `**Baseline commit:** \`${report.baseline.commit}\``,
    '',
    '| Run | Result | Trials |',
    '| --- | --- | ---: |',
    ...report.runs.map(run => `| ${run.label} | ${run.passed ? 'PASS' : 'FAIL'} | ${run.passed_trials}/${run.total_trials} |`),
  ]
  if (report.comparison_warnings.length > 0) {
    lines.push('', '## Comparison warnings', '', ...report.comparison_warnings.map(warning => `- ${warning}`))
  }
  lines.push(
    '',
    '## Environment',
    '',
    '| Run | Profile | Components | Node | Platform | Arch |',
    '| --- | --- | --- | --- | --- | --- |',
    ...report.environment.map(environment => {
      const values = [
        environment.label,
        profileLabel(environment.profile),
        componentsLabel(environment.components),
        environment.runtime.node,
        environment.runtime.platform,
        environment.runtime.arch,
      ].map(value => String(value).replaceAll('|', '\\|'))
      return `| ${values.join(' | ')} |`
    }),
  )
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
