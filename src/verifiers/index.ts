import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { ChangedPath, CheckResult, RegressionCheck } from '../types.js'
import { verifyApiSnapshot } from './api-snapshot.js'
import { verifyCommand } from './command.js'
import { verifyDiffPath } from './diff-path.js'
import { verifyJsonSchema } from './json-schema.js'

export interface VerifierSnapshot {
  content?: string
  error?: string
}

export type VerifierSnapshots = Map<string, VerifierSnapshot>

function snapshotKey(check: RegressionCheck): string {
  return `${check.type}:${check.id}`
}

export async function snapshotVerifierInputs(checks: RegressionCheck[], worktree: string): Promise<VerifierSnapshots> {
  const snapshots: VerifierSnapshots = new Map()
  for (const check of checks) {
    const file = check.type === 'api-snapshot' ? check.baseline : check.type === 'json-schema' ? check.schema : undefined
    if (file === undefined) continue
    try {
      snapshots.set(snapshotKey(check), { content: await readFile(resolve(worktree, file), 'utf8') })
    } catch (error) {
      snapshots.set(snapshotKey(check), {
        error: `could not snapshot ${file} before the trial: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }
  return snapshots
}

export async function verify(
  check: RegressionCheck,
  worktree: string,
  changed: ChangedPath[],
  snapshots?: VerifierSnapshots,
  signal?: AbortSignal,
): Promise<CheckResult> {
  const snapshot = snapshots?.get(snapshotKey(check))
  switch (check.type) {
    case 'command': return verifyCommand(check, worktree, signal)
    case 'diff-path': return verifyDiffPath(check, changed)
    case 'json-schema': return verifyJsonSchema(check, worktree, snapshot)
    case 'api-snapshot': return verifyApiSnapshot(check, worktree, snapshot, signal)
  }
}
