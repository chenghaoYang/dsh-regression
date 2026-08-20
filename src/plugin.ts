import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandRuntime } from '@deepseek-ai/dsh-commands'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { integer, many, one, parseArgs, shellWords } from './args.js'
import { captureCase } from './capture.js'
import { findCause } from './cause.js'
import { writeReport } from './report.js'
import { runCase } from './runner.js'

export const name = 'dsh-regression'
export const inject = ['commands']

interface Config {
  casesDir?: string
  runsDir?: string
  defaultTrials?: number
}

interface HumanTurn {
  text: string
  turn?: number
}

function humanTurns(agent: Agent): HumanTurn[] {
  const turns: HumanTurn[] = []
  let currentTurn: number | undefined
  for (const event of agent.session.events) {
    if (event.type === 'turn/start') currentTurn = event.data.turn
    if (event.type !== 'user/message' || event.data.source.kind !== 'user') continue
    const text = event.data.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n')
      .trim()
    if (text !== '') turns.push({ text, ...(currentTurn === undefined ? {} : { turn: currentTurn }) })
  }
  return turns
}

function usage(): string {
  return [
    'Usage:',
    '  /regress capture [id] [--forbid-path glob] [--allow-path glob] [--check-command command]',
    '  /regress run case.yml [--label name] [--profile profile] [--trials n]',
    '  /regress report run.json [run.json ...]',
    '  /regress cause --case case.yml --spec cause.yml [--trials n]',
  ].join('\n')
}

export function apply(ctx: Context, config: Config = {}): void {
  const commands = ctx.get('commands') as CommandRuntime | undefined
  if (commands === undefined) throw new Error('dsh-regression requires the commands service')
  ctx.effect(() => commands.register({
    name: 'regress',
    description: 'Capture, run, report, and minimize coding-agent behavior regressions',
    input: { hint: 'capture|run|report|cause …' },
    handler: async ({ agent, rawInput, signal }) => {
      try {
        const words = shellWords(rawInput)
        const action = words[0]
        if (action === undefined || action === 'help') return { kind: 'success', text: usage() }
        const args = parseArgs(words.slice(1))
        const cwd = resolve(agent.session.header.cwd ?? process.cwd())
        if (action === 'capture') {
          const turns = humanTurns(agent)
          const correction = turns.at(-1)
          const original = turns.at(-2)
          if (correction === undefined || original === undefined) {
            return { kind: 'error', text: 'Capture needs an original user task and a later correction in this session.' }
          }
          const id = args.positionals[0] ?? `correction-${correction.turn ?? agent.session.seq}`
          const output = resolve(config.casesDir ?? resolve(cwd, '.dsh-regression', 'cases'), `${id}.yaml`)
          const captured = await captureCase({
            id,
            prompt: original.text,
            correction: correction.text,
            cwd,
            output,
            ...(one(args, 'profile') === undefined ? {} : { profile: one(args, 'profile')! }),
            trials: integer(args, 'trials') ?? config.defaultTrials ?? 3,
            forbidPaths: many(args, 'forbid-path'),
            allowPaths: many(args, 'allow-path'),
            commands: many(args, 'check-command'),
            source: {
              session_id: String(agent.session.id),
              ...(correction.turn === undefined ? {} : { turn_id: correction.turn }),
            },
          })
          return { kind: 'success', text: `Created executable regression case: ${captured.file}` }
        }
        if (action === 'run') {
          const caseFile = args.positionals[0] ?? one(args, 'case')
          if (caseFile === undefined) return { kind: 'error', text: 'Usage: /regress run <case.yml>' }
          const trials = integer(args, 'trials') ?? config.defaultTrials
          const run = await runCase({
            caseFile: resolve(cwd, caseFile),
            ...(one(args, 'label') === undefined ? {} : { label: one(args, 'label')! }),
            ...(one(args, 'profile') === undefined ? {} : { profile: one(args, 'profile')! }),
            ...(trials === undefined ? {} : { trials }),
            outputRoot: resolve(config.runsDir ?? resolve(cwd, '.dsh-regression', 'runs')),
            keepWorktrees: args.flags.has('keep-worktrees'),
            signal,
          })
          return {
            kind: run.result.passed ? 'success' : 'error',
            text: `${run.result.case_id}: ${run.result.passed_trials}/${run.result.total_trials} trials passed\n${run.file}`,
          }
        }
        if (action === 'report') {
          const runFiles = [...many(args, 'run'), ...args.positionals].map(file => resolve(cwd, file))
          const report = await writeReport(runFiles, 'markdown', one(args, 'out'))
          return { kind: report.report.status === 'FAIL' || report.report.status === 'REGRESSION' ? 'error' : 'success', text: report.text }
        }
        if (action === 'cause') {
          const caseFile = one(args, 'case')
          const specFile = one(args, 'spec')
          if (caseFile === undefined || specFile === undefined) return { kind: 'error', text: 'Usage: /regress cause --case case.yml --spec cause.yml' }
          const cause = await findCause({
            caseFile: resolve(cwd, caseFile),
            specFile: resolve(cwd, specFile),
            trials: integer(args, 'trials') ?? config.defaultTrials ?? 3,
            outputRoot: resolve(config.runsDir ?? resolve(cwd, '.dsh-regression', 'runs')),
            signal,
          })
          const ids = cause.result.minimal_set.map(component => component.id).join(', ') || '(none)'
          return {
            kind: cause.result.status === 'confirmed' ? 'success' : 'error',
            text: `${cause.result.status}: ${ids}\n${cause.result.explanation}\n${cause.file}`,
          }
        }
        return { kind: 'error', text: usage() }
      } catch (error) {
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
      }
    },
  }))
}
