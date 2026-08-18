import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clientInputCapabilities,
  supportsComposerInput,
} from '../../shared/client-input-capabilities.mjs'

test('desktop orb remains an audio-only input surface', () => {
  assert.deepEqual(clientInputCapabilities('desktop'), {
    text: false,
    audio: true,
    image: false,
    resource: false,
  })
  assert.equal(supportsComposerInput('desktop'), false)
})
