export interface CaseSource {
  session_id?: string
  turn_id?: number
  correction?: string
}

export interface FixtureSpec {
  repository: string
  git_ref: string
  cwd?: string
}

export interface RunnerSpec {
  adapter: 'command' | 'dsh'
  command?: string
  args?: string[]
  profile?: string
  timeout_seconds?: number
  env?: Record<string, string>
}

export interface CommandCheck {
  id: string
  type: 'command'
  run: string
  cwd?: string
  timeout_seconds?: number
}

export interface DiffPathCheck {
  id: string
  type: 'diff-path'
  allow?: string[]
  forbid?: string[]
  max_files?: number
  forbid_dependency_changes?: boolean
  forbid_test_deletions?: boolean
}

export interface JsonSchemaCheck {
  id: string
  type: 'json-schema'
  file: string
  schema: string
}

export interface ApiSnapshotCheck {
  id: string
  type: 'api-snapshot'
  run: string
  baseline: string
  cwd?: string
  timeout_seconds?: number
}

export type RegressionCheck = CommandCheck | DiffPathCheck | JsonSchemaCheck | ApiSnapshotCheck

export interface RegressionCase {
  version: 1
  id: string
  title?: string
  description?: string
  source?: CaseSource
  fixture: FixtureSpec
  runner: RunnerSpec
  task: { prompt: string }
  run?: { trials?: number; pass_policy?: 'all' }
  checks: RegressionCheck[]
}

/**
 * The case contract used for comparison. A profile is an execution choice,
 * so it is recorded in the run manifest rather than making two otherwise
 * identical cases incomparable.
 */
export type CaseDefinition = Omit<RegressionCase, 'runner'> & {
  runner: Omit<RunnerSpec, 'profile'>
}

export interface ChangedPath {
  path: string
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked'
}

export interface CheckResult {
  id: string
  type: RegressionCheck['type'] | 'runner'
  passed: boolean
  message: string
  duration_ms?: number
  details?: Record<string, unknown>
}

export interface TrialResult {
  trial: number
  passed: boolean
  worktree: string
  commit: string
  started_at: string
  duration_ms: number
  executor: {
    command: string
    exit_code: number | null
    signal: string | null
    timed_out: boolean
    aborted: boolean
    stdout: string
    stderr: string
    duration_ms: number
  }
  changed_paths: ChangedPath[]
  checks: CheckResult[]
}

export interface HarnessComponent {
  id: string
  kind: 'plugin' | 'profile'
  env: Record<string, string>
  description?: string
}

export interface RunManifest {
  schema: 1
  adapter: RunnerSpec['adapter']
  profile?: string
  repository: { path: string; git_ref: string; commit: string }
  case_definition: CaseDefinition
  components: HarnessComponent[]
  runtime: { platform: NodeJS.Platform; arch: string; node: string }
}

export interface RunResult {
  schema: 1
  id: string
  case_id: string
  label: string
  started_at: string
  completed_at: string
  passed: boolean
  passed_trials: number
  total_trials: number
  case_file: string
  output_dir: string
  manifest: RunManifest
  trials: TrialResult[]
}

export interface CauseSpec {
  version: 1
  components: HarnessComponent[]
}

export interface CauseProbe {
  enabled: string[]
  outcome: 'pass' | 'fail' | 'inconclusive'
  run_file: string
}

export interface CauseResult {
  schema: 1
  case_id: string
  scope: 'environment-overlays'
  scope_note: string
  status: 'confirmed' | 'probable' | 'inconclusive'
  minimal_set: HarnessComponent[]
  probes: CauseProbe[]
  explanation: string
}

export interface RunOptions {
  caseFile: string
  label?: string
  trials?: number
  signal?: AbortSignal
  profile?: string
  outputRoot?: string
  keepWorktrees?: boolean
  componentEnv?: Record<string, string>
  components?: HarnessComponent[]
}
