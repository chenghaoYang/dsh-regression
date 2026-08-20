#!/usr/bin/env node
import { executeCli } from './cli-lib.js'

try {
  const result = await executeCli(process.argv.slice(2))
  process.stdout.write(result.text)
  process.exitCode = result.exitCode
} catch (error) {
  process.stderr.write(`dsh-regression: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 2
}
