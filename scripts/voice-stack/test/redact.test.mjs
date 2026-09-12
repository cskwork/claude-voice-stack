import assert from 'node:assert/strict'
import test from 'node:test'
import { isSecretKey, redactSecrets, redactedEnvSummary } from '../lib/redact.mjs'

test('secret-like keys are recognised', () => {
  assert.ok(isSecretKey('VOICE_LLM_API_KEY'))
  assert.ok(isSecretKey('SPEECH_TO_SPEECH_AUTH_TOKEN'))
  assert.ok(!isSecretKey('VOICE_LLM_MODEL'))
})

test('redactSecrets masks env values, bearer tokens and sk- keys, keeps short values', () => {
  const env = { VOICE_LLM_API_KEY: 'abcdefgh12345678', SHORT_TOKEN: 'ab' }
  const text = 'key=abcdefgh12345678 Authorization: Bearer zzzzzzzzzzzz sk-1234567890abcdef short=ab'
  assert.equal(redactSecrets(text, env), 'key=*** Authorization: Bearer *** sk-*** short=ab')
})

test('redactedEnvSummary never echoes secret values', () => {
  assert.deepEqual(redactedEnvSummary({ VOICE_LLM_API_KEY: 'x', VOICE_LLM_MODEL: 'glm' }), {
    VOICE_LLM_API_KEY: '(set)', VOICE_LLM_MODEL: 'glm',
  })
})
