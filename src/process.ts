import { spawn } from 'node:child_process'

export interface ProcessResult {
  command: string
  exitCode: number | null
  signal: string | null
  stdout: string
  stderr: string
  durationMs: number
}

export async function runProcess(
  command: string,
  args: string[],
  options: { cwd: string; env?: Record<string, string>; timeoutMs?: number; shell?: boolean },
): Promise<ProcessResult> {
  const started = Date.now()
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    shell: options.shell ?? false,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  let timer: NodeJS.Timeout | undefined
  if (options.timeoutMs !== undefined) timer = setTimeout(() => child.kill('SIGTERM'), options.timeoutMs)
  const outcome = await new Promise<{ exitCode: number | null; signal: string | null }>((resolveResult, reject) => {
    child.once('error', reject)
    child.once('close', (exitCode, signal) => resolveResult({ exitCode, signal }))
  }).finally(() => { if (timer !== undefined) clearTimeout(timer) })
  return { command: [command, ...args].join(' '), ...outcome, stdout, stderr, durationMs: Date.now() - started }
}

export async function runShell(command: string, cwd: string, timeoutMs?: number, env?: Record<string, string>): Promise<ProcessResult> {
  return runProcess(command, [], {
    cwd,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(env === undefined ? {} : { env }),
    shell: true,
  })
}
