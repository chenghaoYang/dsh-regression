import { mkdir, writeFile } from 'node:fs/promises'

await mkdir('src/internal', { recursive: true })
await writeFile('src/internal/cache.txt', 'refactored\n')
await mkdir('artifacts', { recursive: true })
await writeFile('artifacts/result.json', `${JSON.stringify({ status: 'ok', value: 42 }, null, 2)}\n`)

if (process.env.DSH_DEMO_BREAK_API === '1') {
  await writeFile('src/public/api.js', 'export const publicName = "broken"\n')
}
if (process.env.DSH_DEMO_ADD_DEPENDENCY === '1') {
  await writeFile('package.json', `${JSON.stringify({ name: 'fixture', dependencies: { leftpad: '1.0.0' } }, null, 2)}\n`)
}
if (process.env.DSH_DEMO_DELETE_TEST === '1') {
  await import('node:fs/promises').then(fs => fs.rm('tests/basic.test.mjs'))
}
