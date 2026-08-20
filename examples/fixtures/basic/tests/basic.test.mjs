import test from 'node:test'
import assert from 'node:assert/strict'
import { publicName } from '../src/public/api.js'

test('public API remains stable', () => {
  assert.equal(publicName, 'stable')
})
