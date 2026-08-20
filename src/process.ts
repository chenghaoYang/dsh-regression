import { spawn } from 'node:child_process'

export interface ProcessResult {
  command: string
  exitCode: number | null
  signal: string | null
  timedOut: boolean
  aborted: boolean
  stdout: string
  stderr: string
  durationMs: number
}

export async function runProcess(
  command: string,
  args: string[],
  options: {
    cwd: string
    env?: Record<string, string>
    timeoutMs?: number
    shell?: boolean
    signal?: AbortSignal
  },
): Promise<ProcessResult> {
  const started = Date.now()
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    shell: options.shell ?? false,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })

  let timer: NodeJS.Timeout | undefined
  let killTimer: NodeJS.Timeout | undefined
  let termination: 'timeout' | 'aborted' | undefined
  let settled = false

  const outcome = new Promise<{ exitCode: number | null; signal: string | null }>((resolveResult, reject) => {
    child.once('error', error => {
      settled = true
      reject(error)
    })
    child.once('close', (exitCode, signal) => {
      settled = true
      resolveResult({ exitCode, signal })
    })
  })

  const signalChild = (signal: NodeJS.Signals): void => {
    if (child.pid !== undefined && process.platform !== 'win32') {
      try {
        process.kill(-child.pid, signal)
        return
      } catch {
        // The process may have exited between the check and the group signal.
      }
    }
    child.kill(signal)
  }

  const terminate = (cause: 'timeout' | 'aborted'): void => {
    if (settled || termination !== undefined) return
    termination = cause
    signalChild('SIGTERM')
    killTimer = setTimeout(() => signalChild('SIGKILL'), 100)
  }

  const onAbort = (): void => terminate('aborted')
  if (options.signal !== undefined) {
    if (options.signal.aborted) onAbort()
    else options.signal.addEventListener('abort', onAbort, { once: true })
  }
  if (options.timeoutMs !== undefined) timer = setTimeout(() => terminate('timeout'), options.timeoutMs)

  const settledOutcome = await outcome.finally(() => {
    if (timer !== undefined) clearTimeout(timer)
    if (killTimer !== undefined) clearTimeout(killTimer)
    options.signal?.removeEventListener('abort', onAbort)
  })
  return {
    command: [command, ...args].join(' '),
    ...settledOutcome,
    timedOut: termination === 'timeout',
    aborted: termination === 'aborted',
    stdout,
    stderr,
    durationMs: Date.now() - started,
  }
}

export async function runShell(
  command: string,
  cwd: string,
  timeoutMs?: number,
  env?: Record<string, string>,
  signal?: AbortSignal,
): Promise<ProcessResult> {
  return runProcess(command, [], {
    cwd,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(env === undefined ? {} : { env }),
    ...(signal === undefined ? {} : { signal }),
    shell: true,
  })
}
