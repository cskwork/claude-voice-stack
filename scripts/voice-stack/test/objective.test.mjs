import assert from 'node:assert/strict'
import test from 'node:test'
import { extractConstraints, objectiveMode } from '../lib/objective.mjs'

test('structured objective keeps inspect-only, commit and production restrictions', () => {
  const objective = 'Goal: find why login returns 500. Mode: inspect. Constraints: do not edit, do not commit, do not use production data, ask before destructive actions.'
  assert.deepEqual(extractConstraints(objective), ['do_not_edit', 'do_not_commit', 'no_production_data', 'ask_before_destructive'])
  assert.equal(objectiveMode(objective), 'inspect')
})

test('natural-language objectives still surface the restriction', () => {
  assert.ok(extractConstraints("Inspect the auth bug but don't change any files.").includes('do_not_edit'))
  assert.ok(extractConstraints('Read-only review of the failing test.').includes('do_not_edit'))
  assert.ok(extractConstraints('로그인 버그를 조사하되 파일은 수정하지 마.').includes('do_not_edit'))
  assert.deepEqual(extractConstraints('Fix the failing authentication test and run the relevant tests.'), [])
  assert.equal(objectiveMode('Fix the failing test.'), 'unknown')
})
