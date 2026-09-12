import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveVoiceConfig } from '../lib/env.mjs'
import { buildSpeechToSpeechCommand, buildSupertonicServeCommand } from '../lib/s2s-command.mjs'

const base = { VOICE_LLM_BASE_URL: 'https://glm.example/v4', VOICE_LLM_API_KEY: 'secret-key-12345678' }

test('default profile: Parakeet + chat-completions + in-process Supertonic, key only in env', () => {
  const { config } = resolveVoiceConfig(base)
  const { command, args, env } = buildSpeechToSpeechCommand(config, { bin: '/venv/bin/speech-to-speech' })
  assert.equal(command, '/venv/bin/speech-to-speech')
  assert.equal(args[0], 'serve')
  const flag = name => args[args.indexOf(name) + 1]
  assert.equal(flag('--stt'), 'parakeet-tdt')
  assert.equal(flag('--llm_backend'), 'chat-completions')
  assert.equal(flag('--model_name'), 'glm-5.3-flash')
  assert.equal(flag('--responses_api_base_url'), 'https://glm.example/v4')
  assert.equal(flag('--tts'), 'supertonic')
  assert.equal(flag('--supertonic_tts_voice'), 'M1')
  assert.equal(flag('--num_pipelines'), '1')
  assert.equal(flag('--chat_size'), '4')
  assert.equal(flag('--host'), '127.0.0.1')
  assert.ok(args.includes('--responses_api_stream'))
  assert.ok(args.includes('--enable_live_transcription'))
  assert.ok(!args.includes('--log_transcripts'))
  assert.ok(!args.includes('--responses_api_api_key'))
  assert.ok(!args.join(' ').includes('secret-key-12345678'))
  assert.equal(env.OPENAI_API_KEY, 'secret-key-12345678')
})

test('openai-http mode targets the external Supertonic server', () => {
  const { config } = resolveVoiceConfig({ ...base, VOICE_TTS_MODE: 'openai-http', SUPERTONIC_LANGUAGE: 'ko' })
  const { args } = buildSpeechToSpeechCommand(config)
  const flag = name => args[args.indexOf(name) + 1]
  assert.equal(flag('--tts'), 'openai')
  assert.equal(flag('--openai_tts_base_url'), 'http://127.0.0.1:7788/v1')
  assert.equal(flag('--openai_tts_model'), 'supertonic-3')
  assert.equal(flag('--openai_tts_language'), 'ko')
  const serve = buildSupertonicServeCommand(config)
  assert.deepEqual(serve.args, ['serve', '--host', '127.0.0.1', '--port', '7788', '--model', 'supertonic-3'])
})

test('debug transcripts, reasoning effort, STT language and stream=false are honoured', () => {
  const { config } = resolveVoiceConfig({
    ...base, VOICE_LLM_REASONING_EFFORT: 'none', VOICE_STT_LANGUAGE: 'ko', VOICE_LLM_STREAM: 'false',
  })
  const { args } = buildSpeechToSpeechCommand(config, { debugTranscripts: true })
  const flag = name => args[args.indexOf(name) + 1]
  assert.ok(args.includes('--log_transcripts'))
  assert.equal(flag('--responses_api_reasoning_effort'), 'none')
  assert.equal(flag('--parakeet_tdt_language'), 'ko')
  assert.ok(args.includes('--no_responses_api_stream'))
})

test('whisper backends receive --language (auto unless pinned)', () => {
  const auto = buildSpeechToSpeechCommand(resolveVoiceConfig({ ...base, VOICE_STT: 'mlx-audio-whisper' }).config).args
  assert.equal(auto[auto.indexOf('--language') + 1], 'auto')
  assert.ok(!auto.includes('--parakeet_tdt_language'))
  const ko = buildSpeechToSpeechCommand(resolveVoiceConfig({ ...base, VOICE_STT: 'mlx-audio-whisper', VOICE_STT_LANGUAGE: 'ko' }).config).args
  assert.equal(ko[ko.indexOf('--language') + 1], 'ko')
})

test('mlx-lm fallback sends no remote flags and no key', () => {
  const { config } = resolveVoiceConfig({ VOICE_LLM_BACKEND: 'mlx-lm', VOICE_LLM_MODEL: 'mlx-community/Qwen3-1.7B-4bit' })
  const { args, env } = buildSpeechToSpeechCommand(config)
  assert.ok(!args.includes('--responses_api_base_url'))
  assert.equal(env.OPENAI_API_KEY, undefined)
})
