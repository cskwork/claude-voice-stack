import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

const launcher = readFileSync(
  resolve(import.meta.dirname, '../../scripts/opencode-server'),
  'utf8',
)

test('inherits the user OpenCode config unless isolation is explicitly enabled', () => {
  assert.doesNotMatch(launcher, /OPENCODE_CONFIG_DIR=/)
  assert.match(
    launcher,
    /QWEN_AUDIO_AGENT_OPENCODE_ISOLATE_USER_CONFIG:-false/,
  )
  assert.match(
    launcher,
    /QWEN_AUDIO_AGENT_OPENCODE_XDG_CONFIG_HOME/,
  )
  assert.match(launcher, /runtime\/opencode-xdg/)
  assert.doesNotMatch(
    launcher,
    /export XDG_CONFIG_HOME=\$\{QWEN_AUDIO_AGENT_OPENCODE_XDG_CONFIG_HOME:-/,
  )
})
