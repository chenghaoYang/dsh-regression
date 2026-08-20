import type { ChangedPath, CheckResult, RegressionCheck } from '../types.js'
import { verifyApiSnapshot } from './api-snapshot.js'
import { verifyCommand } from './command.js'
import { verifyDiffPath } from './diff-path.js'
import { verifyJsonSchema } from './json-schema.js'

export async function verify(check: RegressionCheck, worktree: string, changed: ChangedPath[]): Promise<CheckResult> {
  switch (check.type) {
    case 'command': return verifyCommand(check, worktree)
    case 'diff-path': return verifyDiffPath(check, changed)
    case 'json-schema': return verifyJsonSchema(check, worktree)
    case 'api-snapshot': return verifyApiSnapshot(check, worktree)
  }
}
