import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Ajv } from 'ajv'
import type { CheckResult, JsonSchemaCheck } from '../types.js'

export async function verifyJsonSchema(
  check: JsonSchemaCheck,
  worktree: string,
  schemaSnapshot?: { content?: string; error?: string },
): Promise<CheckResult> {
  if (schemaSnapshot?.error !== undefined) {
    return { id: check.id, type: check.type, passed: false, message: schemaSnapshot.error }
  }
  if (schemaSnapshot?.content !== undefined) {
    try {
      const current = await readFile(resolve(worktree, check.schema), 'utf8')
      if (current !== schemaSnapshot.content) {
        return { id: check.id, type: check.type, passed: false, message: `JSON Schema changed during the trial: ${check.schema}` }
      }
    } catch (error) {
      return { id: check.id, type: check.type, passed: false, message: `JSON Schema became unreadable: ${error instanceof Error ? error.message : String(error)}` }
    }
  }
  try {
    const documentText = await readFile(resolve(worktree, check.file), 'utf8')
    const schemaText = schemaSnapshot?.content ?? await readFile(resolve(worktree, check.schema), 'utf8')
    const document: unknown = JSON.parse(documentText)
    const schema: object = JSON.parse(schemaText) as object
    const ajv = new Ajv({ allErrors: true, strict: false })
    const validate = ajv.compile(schema)
    const passed = validate(document)
    return {
      id: check.id,
      type: check.type,
      passed,
      message: passed ? `${check.file} matches ${check.schema}` : `schema mismatch: ${ajv.errorsText(validate.errors)}`,
      details: { errors: validate.errors ?? [] },
    }
  } catch (error) {
    return {
      id: check.id,
      type: check.type,
      passed: false,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}
