import assert from 'node:assert/strict'
import test from 'node:test'
import { parseEnv, resolveVoiceConfig } from '../lib/env.mjs'

test('parseEnv handles comments, quotes, blank lines and export prefix', () => {
  const values = parseEnv([
    '# comment',
    '',
    'A=1',
    'B="two words" # trailing',
    "C='x'",
    'export D=plain # note',
    'not a line',
  ].join('\n'))
  assert.deepEqual(values, { A: '1', B: 'two words', C: 'x', D: 'plain' })
})

test('resolveVoiceConfig applies profile defaults and reports missing GLM credentials', () => {
  const { config, errors } = resolveVoiceConfig({})
  assert.equal(config.llm.backend, 'chat-completions')
  assert.equal(config.llm.model, 'glm-5.3-flash')
  assert.equal(config.llm.chatSize, 4)
  assert.equal(config.tts.mode, 'supertonic')
  assert.equal(config.stt.backend, 'mlx-audio-whisper')
  assert.equal(config.s2s.httpBaseUrl, 'http://127.0.0.1:8765')
  assert.equal(config.gateway.baseUrl, 'http://127.0.0.1:3101')
  assert.equal(config.s2s.logTranscripts, false)
  assert.ok(errors.includes('VOICE_LLM_BASE_URL is empty'))
  assert.ok(errors.includes('VOICE_LLM_API_KEY is empty'))
})

test('resolveVoiceConfig accepts a complete remote profile', () => {
  const { config, errors } = resolveVoiceConfig({
    VOICE_LLM_BASE_URL: 'https://api.example.com/v1/',
    VOICE_LLM_API_KEY: 'k',
    VOICE_LLM_CHAT_SIZE: '6',
    VOICE_LOG_TRANSCRIPTS: 'true',
  })
  assert.deepEqual(errors, [])
  assert.equal(config.llm.baseUrl, 'https://api.example.com/v1')
  assert.equal(config.llm.chatSize, 6)
  assert.equal(config.s2s.logTranscripts, true)
})

test('resolveVoiceConfig refuses full permissions, non-loopback hosts and unknown backends', () => {
  const { errors } = resolveVoiceConfig({
    VOICE_LLM_BASE_URL: 'u', VOICE_LLM_API_KEY: 'k',
    QWEN_AUDIO_AGENT_BACKEND_PERMISSION_MODE: 'full',
    VOICE_S2S_HOST: '0.0.0.0',
    VOICE_TTS_MODE: 'bogus',
    AGENT_PROTOCOL: 'codex',
  })
  assert.ok(errors.some(line => line.includes('full')))
  assert.ok(errors.some(line => line.includes('loopback')))
  assert.ok(errors.some(line => line.includes('VOICE_TTS_MODE')))
  assert.ok(errors.some(line => line.includes('AGENT_PROTOCOL')))
})

test('resolveVoiceConfig local mlx-lm profile needs no API key', () => {
  const { config, errors } = resolveVoiceConfig({
    VOICE_LLM_BACKEND: 'mlx-lm', VOICE_LLM_MODEL: 'mlx-community/Qwen3-1.7B-4bit',
  })
  assert.deepEqual(errors, [])
  assert.equal(config.llm.remote, false)
})
