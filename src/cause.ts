import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { loadCase, loadCauseSpec } from './schema.js'
import { runCase } from './runner.js'
import type { CauseProbe, CauseResult, HarnessComponent } from './types.js'

function componentEnv(components: HarnessComponent[]): Record<string, string> {
  return Object.assign({}, ...components.map(component => component.env)) as Record<string, string>
}

function chunks<T>(items: T[], count: number): T[][] {
  const size = Math.ceil(items.length / count)
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size))
  return result
}

export async function findCause(options: {
  caseFile: string
  specFile: string
  trials?: number
  output?: string
  outputRoot?: string
}): Promise<{ result: CauseResult; file: string }> {
  const spec = await loadCauseSpec(options.specFile)
  const regressionCase = await loadCase(options.caseFile)
  const probes: CauseProbe[] = []
  const probe = async (components: HarnessComponent[]): Promise<CauseProbe['outcome']> => {
    const { result, file } = await runCase({
      caseFile: options.caseFile,
      label: `cause-${probes.length + 1}`,
      trials: options.trials ?? 3,
      ...(options.outputRoot === undefined ? {} : { outputRoot: options.outputRoot }),
      componentEnv: componentEnv(components),
      components,
    })
    const outcome = result.passed ? 'pass' : result.passed_trials === 0 ? 'fail' : 'inconclusive'
    probes.push({ enabled: components.map(component => component.id), outcome, run_file: file })
    return outcome
  }

  const good = await probe([])
  const bad = await probe(spec.components)
  let status: CauseResult['status'] = 'inconclusive'
  let minimal: HarnessComponent[] = []
  let explanation = ''
  if (good !== 'pass' || bad !== 'fail') {
    explanation = `baseline was ${good}; full candidate was ${bad}`
  } else {
    minimal = [...spec.components]
    let granularity = 2
    while (minimal.length >= 2) {
      let reduced = false
      const partitions = chunks(minimal, granularity)
      for (const subset of partitions) {
        if (await probe(subset) === 'fail') {
          minimal = subset
          granularity = 2
          reduced = true
          break
        }
      }
      if (reduced) continue
      for (const subset of partitions) {
        const ids = new Set(subset.map(component => component.id))
        const complement = minimal.filter(component => !ids.has(component.id))
        if (complement.length > 0 && await probe(complement) === 'fail') {
          minimal = complement
          granularity = Math.max(2, granularity - 1)
          reduced = true
          break
        }
      }
      if (!reduced) {
        if (granularity >= minimal.length) break
        granularity = Math.min(minimal.length, granularity * 2)
      }
    }
    const finalOutcome = await probe(minimal)
    const removals: Array<{ component: HarnessComponent; outcome: CauseProbe['outcome'] }> = []
    for (const component of minimal) {
      removals.push({
        component,
        outcome: await probe(minimal.filter(candidate => candidate.id !== component.id)),
      })
    }
    if (finalOutcome === 'fail' && removals.every(removal => removal.outcome === 'pass')) {
      status = 'confirmed'
      explanation = 'The full candidate fails, the baseline passes, the 1-minimal set reproduces the failure, and removing any member restores a pass.'
    } else if (finalOutcome === 'fail') {
      status = 'probable'
      explanation = 'A reproducible failure-inducing set was found, but at least one reverse check was not a stable pass.'
    } else {
      status = 'inconclusive'
      explanation = 'The minimized set did not reproduce a stable failure.'
    }
  }
  const result: CauseResult = {
    schema: 1,
    case_id: regressionCase.id,
    status,
    minimal_set: minimal,
    probes,
    explanation,
  }
  const file = resolve(options.output ?? resolve(options.outputRoot ?? '.dsh-regression/runs', `cause-${Date.now()}.json`))
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(result, null, 2)}\n`)
  return { result, file }
}
