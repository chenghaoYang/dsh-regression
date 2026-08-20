import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { many, integer, one, parseArgs } from './args.js'
import { captureCase } from './capture.js'
import { findCause } from './cause.js'
import { writeReport } from './report.js'
import { runCase } from './runner.js'

export const help = `dsh-regression 0.1.3

Usage:
  dsh-regression capture --id ID --prompt TEXT [verifier options]
  dsh-regression run CASE [--label NAME] [--profile PROFILE] [--trials N]
  dsh-regression report --run RUN.json [--run RUN.json] [--format markdown|json]
  dsh-regression cause --case CASE --spec cause.yml [--trials N]

Capture verifier options:
  --correction TEXT
  --forbid-path GLOB       repeatable
  --allow-path GLOB        repeatable
  --check-command COMMAND  repeatable
`

export async function executeCli(argv: string[]): Promise<{ exitCode: number; text: string }> {
  const command = argv[0]
  if (command === undefined || command === 'help' || command === '--help' || command === '-h') return { exitCode: 0, text: help }
  const args = parseArgs(argv.slice(1))
  if (command === 'capture') {
    const id = one(args, 'id') ?? args.positionals[0]
    if (id === undefined) throw new Error('capture requires --id')
    const promptFile = one(args, 'prompt-file')
    const prompt = one(args, 'prompt') ?? (promptFile === undefined ? undefined : await readFile(resolve(promptFile), 'utf8'))
    if (prompt === undefined) throw new Error('capture requires --prompt or --prompt-file')
    const correction = one(args, 'correction')
    const output = one(args, 'out')
    const profile = one(args, 'profile')
    const trials = integer(args, 'trials')
    const captured = await captureCase({
      id,
      prompt,
      cwd: resolve(one(args, 'cwd') ?? '.'),
      ...(correction === undefined ? {} : { correction }),
      ...(output === undefined ? {} : { output }),
      ...(profile === undefined ? {} : { profile }),
      ...(trials === undefined ? {} : { trials }),
      forbidPaths: many(args, 'forbid-path'),
      allowPaths: many(args, 'allow-path'),
      commands: many(args, 'check-command'),
    })
    return { exitCode: 0, text: `Created ${captured.file}\n` }
  }
  if (command === 'run') {
    const caseFile = args.positionals[0] ?? one(args, 'case')
    if (caseFile === undefined) throw new Error('run requires a case file')
    const label = one(args, 'label')
    const profile = one(args, 'profile')
    const trials = integer(args, 'trials')
    const outputRoot = one(args, 'output-root')
    const run = await runCase({
      caseFile,
      ...(label === undefined ? {} : { label }),
      ...(profile === undefined ? {} : { profile }),
      ...(trials === undefined ? {} : { trials }),
      ...(outputRoot === undefined ? {} : { outputRoot }),
      keepWorktrees: args.flags.has('keep-worktrees'),
    })
    return {
      exitCode: run.result.passed ? 0 : 1,
      text: `${run.result.case_id}: ${run.result.passed_trials}/${run.result.total_trials} trials passed\n${run.file}\n`,
    }
  }
  if (command === 'report') {
    const runFiles = [...many(args, 'run'), ...args.positionals]
    const format = one(args, 'format') ?? 'markdown'
    if (format !== 'markdown' && format !== 'json') throw new Error('--format must be markdown or json')
    const report = await writeReport(runFiles, format, one(args, 'out'))
    return { exitCode: report.report.status === 'REGRESSION' || report.report.status === 'FAIL' ? 1 : 0, text: report.text }
  }
  if (command === 'cause') {
    const caseFile = one(args, 'case')
    const specFile = one(args, 'spec')
    if (caseFile === undefined || specFile === undefined) throw new Error('cause requires --case and --spec')
    const trials = integer(args, 'trials')
    const output = one(args, 'out')
    const outputRoot = one(args, 'output-root')
    const cause = await findCause({
      caseFile,
      specFile,
      ...(trials === undefined ? {} : { trials }),
      ...(output === undefined ? {} : { output }),
      ...(outputRoot === undefined ? {} : { outputRoot }),
    })
    const ids = cause.result.minimal_set.map(component => component.id).join(', ') || '(none)'
    return { exitCode: cause.result.status === 'confirmed' ? 0 : 1, text: `${cause.result.status}: ${ids}\n${cause.result.explanation}\n${cause.file}\n` }
  }
  throw new Error(`unknown command: ${command}`)
}
