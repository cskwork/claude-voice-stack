import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  parseSettings,
  updateSettingsContent,
} from '../src/settings-config.mjs'

test('reads desktop-owned settings with friendly defaults', () => {
  assert.deepEqual(parseSettings(''), {
    gatewayUrl: 'http://127.0.0.1:3101',
    orbStyle: 'fluid',
  })
})

test('shows effective client settings when user config is empty', () => {
  assert.deepEqual(parseSettings('', {
    QWEN_AUDIO_AGENT_URL: 'http://127.0.0.1:3200',
    QWEN_AUDIO_ORB_STYLE: 'goo',
  }), {
    gatewayUrl: 'http://127.0.0.1:3200',
    orbStyle: 'goo',
  })
})

test('updates client settings without changing Gateway-owned configuration', () => {
  const content = updateSettingsContent([
    '# local settings',
    'CUSTOM_SETTING=keep',
    'DASHSCOPE_API_KEY=secret',
    'QWEN_AUDIO_REALTIME_MODEL=realtime-model',
    'AGENT_PROTOCOL=qoder',
    'QWEN_AUDIO_AGENT_BACKEND_PERMISSION_MODE=full',
    '',
  ].join('\n'), {
    gatewayUrl: 'http://127.0.0.1:3200',
    orbStyle: 'goo',
  })

  assert.match(content, /CUSTOM_SETTING=keep/)
  assert.match(content, /DASHSCOPE_API_KEY=secret/)
  assert.match(content, /QWEN_AUDIO_REALTIME_MODEL=realtime-model/)
  assert.match(content, /AGENT_PROTOCOL=qoder/)
  assert.match(content, /QWEN_AUDIO_AGENT_BACKEND_PERMISSION_MODE=full/)
  assert.match(content, /QWEN_AUDIO_AGENT_URL=http:\/\/127\.0\.0\.1:3200/)
  assert.match(content, /QWEN_AUDIO_ORB_STYLE=goo/)
  assert.deepEqual(parseSettings(content), {
    gatewayUrl: 'http://127.0.0.1:3200',
    orbStyle: 'goo',
  })
})

test('rejects invalid Gateway URLs', () => {
  assert.throws(() => updateSettingsContent('', {
    gatewayUrl: 'file:///tmp/gateway',
    orbStyle: 'fluid',
  }), /只支持 HTTP 或 HTTPS/)
})

test('desktop settings expose Gateway state without editing Gateway ownership', () => {
  const html = readFileSync(
    new URL('../src/settings.html', import.meta.url),
    'utf8',
  )
  assert.match(html, /id="current-realtime"/)
  assert.match(html, /id="current-backend"/)
  for (const id of [
    'api-key',
    'realtime-model',
    'realtime-voice',
    'protocol',
    'backend-permission-mode',
    'backend-url',
    'backend-model',
  ]) {
    assert.doesNotMatch(html, new RegExp(`id="${id}"`))
  }
})
