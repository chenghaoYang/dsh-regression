import picomatch from 'picomatch'
import type { ChangedPath, CheckResult, DiffPathCheck } from '../types.js'

const dependencyFilePatterns = [
  '**/package.json', '**/package-lock.json', '**/pnpm-lock.yaml', '**/yarn.lock', '**/bun.lock', '**/bun.lockb',
  '**/pyproject.toml', '**/poetry.lock', '**/uv.lock', '**/requirements*.txt', '**/Pipfile', '**/Pipfile.lock',
  '**/Cargo.toml', '**/Cargo.lock', '**/go.mod', '**/go.sum', '**/Gemfile', '**/Gemfile.lock',
  '**/composer.json', '**/composer.lock', '**/pom.xml', '**/build.gradle', '**/build.gradle.kts',
  '**/gradle.lockfile', '**/Package.swift', '**/Package.resolved',
]

const testFilePatterns = [
  '**/test/**', '**/tests/**', '**/*.test.*', '**/*.spec.*', '**/test_*.py', '**/*_test.go',
  '**/Test*.java', '**/*Test.java', '**/*Tests.java',
]

function matches(path: string, patterns: string[]): boolean {
  return patterns.some(pattern => picomatch.isMatch(path, pattern, { dot: true }))
}

export function verifyDiffPath(check: DiffPathCheck, changed: ChangedPath[]): CheckResult {
  const failures: string[] = []
  if (check.forbid !== undefined) {
    const forbidden = changed.filter(item => matches(item.path, check.forbid ?? []))
    if (forbidden.length > 0) failures.push(`forbidden paths changed: ${forbidden.map(item => item.path).join(', ')}`)
  }
  if (check.allow !== undefined) {
    const outside = changed.filter(item => !matches(item.path, check.allow ?? []))
    if (outside.length > 0) failures.push(`paths changed outside allow list: ${outside.map(item => item.path).join(', ')}`)
  }
  if (check.max_files !== undefined && changed.length > check.max_files) {
    failures.push(`${changed.length} files changed; maximum is ${check.max_files}`)
  }
  if (check.forbid_dependency_changes === true) {
    const dependencyChanges = changed.filter(item => matches(item.path, dependencyFilePatterns))
    if (dependencyChanges.length > 0) failures.push(`dependency files changed: ${dependencyChanges.map(item => item.path).join(', ')}`)
  }
  if (check.forbid_test_deletions === true) {
    const deletedTests = changed.filter(item => item.status === 'deleted'
      && picomatch.isMatch(item.path, testFilePatterns))
    if (deletedTests.length > 0) failures.push(`tests deleted: ${deletedTests.map(item => item.path).join(', ')}`)
  }
  return {
    id: check.id,
    type: check.type,
    passed: failures.length === 0,
    message: failures.length === 0 ? `${changed.length} changed path(s) satisfy the boundary` : failures.join('; '),
    details: { changed_paths: changed },
  }
}
