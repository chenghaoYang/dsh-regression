import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import YAML from 'yaml'
import type { CauseSpec, RegressionCase, RegressionCheck } from './types.js'

function record(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object`)
  }
  return value as Record<string, unknown>
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${field} must be a non-empty string`)
  return value
}

function stringList(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || item.trim() === '')) {
    throw new Error(`${field} must be an array of non-empty strings`)
  }
  return value as string[]
}

function positiveInt(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error(`${field} must be a positive integer`)
  return value as number
}

function parseCheck(value: unknown, index: number): RegressionCheck {
  const input = record(value, `checks[${index}]`)
  const type = text(input.type, `checks[${index}].type`)
  const id = text(input.id, `checks[${index}].id`)
  if (type === 'command') {
    return {
      id, type,
      run: text(input.run, `checks[${index}].run`),
      ...(input.cwd === undefined ? {} : { cwd: text(input.cwd, `checks[${index}].cwd`) }),
      ...(positiveInt(input.timeout_seconds, `checks[${index}].timeout_seconds`) === undefined ? {} : { timeout_seconds: input.timeout_seconds as number }),
    }
  }
  if (type === 'diff-path') {
    const allow = stringList(input.allow, `checks[${index}].allow`)
    const forbid = stringList(input.forbid, `checks[${index}].forbid`)
    if (allow === undefined && forbid === undefined && input.max_files === undefined
      && input.forbid_dependency_changes !== true && input.forbid_test_deletions !== true) {
      throw new Error(`checks[${index}] diff-path must define at least one rule`)
    }
    return {
      id, type,
      ...(allow === undefined ? {} : { allow }),
      ...(forbid === undefined ? {} : { forbid }),
      ...(positiveInt(input.max_files, `checks[${index}].max_files`) === undefined ? {} : { max_files: input.max_files as number }),
      ...(input.forbid_dependency_changes === true ? { forbid_dependency_changes: true } : {}),
      ...(input.forbid_test_deletions === true ? { forbid_test_deletions: true } : {}),
    }
  }
  if (type === 'json-schema') {
    return { id, type, file: text(input.file, `checks[${index}].file`), schema: text(input.schema, `checks[${index}].schema`) }
  }
  if (type === 'api-snapshot') {
    return {
      id, type,
      run: text(input.run, `checks[${index}].run`),
      baseline: text(input.baseline, `checks[${index}].baseline`),
      ...(input.cwd === undefined ? {} : { cwd: text(input.cwd, `checks[${index}].cwd`) }),
      ...(positiveInt(input.timeout_seconds, `checks[${index}].timeout_seconds`) === undefined ? {} : { timeout_seconds: input.timeout_seconds as number }),
    }
  }
  throw new Error(`checks[${index}].type is unsupported: ${type}`)
}

export function parseCase(value: unknown): RegressionCase {
  const input = record(value, 'case')
  if (input.version !== 1) throw new Error('version must be 1')
  const fixture = record(input.fixture, 'fixture')
  const runner = record(input.runner, 'runner')
  const task = record(input.task, 'task')
  const adapter = text(runner.adapter, 'runner.adapter')
  if (adapter !== 'command' && adapter !== 'dsh') throw new Error('runner.adapter must be command or dsh')
  const checks = input.checks
  if (!Array.isArray(checks) || checks.length === 0) throw new Error('checks must contain at least one verifier')
  const parsed: RegressionCase = {
    version: 1,
    id: text(input.id, 'id'),
    ...(input.title === undefined ? {} : { title: text(input.title, 'title') }),
    ...(input.description === undefined ? {} : { description: text(input.description, 'description') }),
    fixture: {
      repository: text(fixture.repository, 'fixture.repository'),
      git_ref: text(fixture.git_ref, 'fixture.git_ref'),
      ...(fixture.cwd === undefined ? {} : { cwd: text(fixture.cwd, 'fixture.cwd') }),
    },
    runner: {
      adapter,
      ...(runner.command === undefined ? {} : { command: text(runner.command, 'runner.command') }),
      ...(stringList(runner.args, 'runner.args') === undefined ? {} : { args: runner.args as string[] }),
      ...(runner.profile === undefined ? {} : { profile: text(runner.profile, 'runner.profile') }),
      ...(positiveInt(runner.timeout_seconds, 'runner.timeout_seconds') === undefined ? {} : { timeout_seconds: runner.timeout_seconds as number }),
      ...(runner.env === undefined ? {} : { env: Object.fromEntries(Object.entries(record(runner.env, 'runner.env')).map(([key, val]) => [key, text(val, `runner.env.${key}`)])) }),
    },
    task: { prompt: text(task.prompt, 'task.prompt') },
    checks: checks.map(parseCheck),
  }
  if (input.source !== undefined) parsed.source = record(input.source, 'source') as NonNullable<RegressionCase['source']>
  if (input.run !== undefined) {
    const run = record(input.run, 'run')
    if (run.pass_policy !== undefined && run.pass_policy !== 'all') throw new Error('run.pass_policy must be all')
    parsed.run = { ...(positiveInt(run.trials, 'run.trials') === undefined ? {} : { trials: run.trials as number }), pass_policy: 'all' }
  }
  if (adapter === 'command' && parsed.runner.command === undefined) throw new Error('runner.command is required for command adapter')
  return parsed
}

export async function loadCase(caseFile: string): Promise<RegressionCase> {
  const absolute = resolve(caseFile)
  return parseCase(YAML.parse(await readFile(absolute, 'utf8')))
}

export async function loadCauseSpec(specFile: string): Promise<CauseSpec> {
  const input = record(YAML.parse(await readFile(resolve(specFile), 'utf8')), 'cause spec')
  if (input.version !== 1) throw new Error('cause spec version must be 1')
  if (!Array.isArray(input.components) || input.components.length === 0) throw new Error('cause spec components must not be empty')
  return {
    version: 1,
    components: input.components.map((value, index) => {
      const component = record(value, `components[${index}]`)
      const kind = text(component.kind, `components[${index}].kind`)
      if (kind !== 'plugin' && kind !== 'profile') throw new Error(`components[${index}].kind must be plugin or profile`)
      const env = record(component.env, `components[${index}].env`)
      return {
        id: text(component.id, `components[${index}].id`),
        kind,
        env: Object.fromEntries(Object.entries(env).map(([key, val]) => [key, text(val, `components[${index}].env.${key}`)])),
        ...(component.description === undefined ? {} : { description: text(component.description, `components[${index}].description`) }),
      }
    }),
  }
}
