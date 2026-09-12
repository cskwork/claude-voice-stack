import { readFileSync } from 'node:fs'

// Minimal dotenv parser: KEY=VALUE, optional quotes, # comments, no expansion.
export function parseEnv(text) {
  const values = {}
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!match) continue
    let value = match[2]
    const quote = value[0]
    if (quote === '"' || quote === "'") {
      const end = value.indexOf(quote, 1)
      value = end > 0 ? value.slice(1, end) : value.slice(1)
    } else {
      const comment = value.indexOf(' #')
      if (comment >= 0) value = value.slice(0, comment)
      value = value.trim()
    }
    values[match[1]] = value
  }
  return values
}

export function readEnvFile(path) {
  try {
    return { exists: true, values: parseEnv(readFileSync(path, 'utf8')) }
  } catch (error) {
    if (error.code === 'ENOENT') return { exists: false, values: {} }
    throw error
  }
}

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback
  return /^(1|true|yes|on)$/i.test(String(value))
}

function int(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function text(value, fallback = '') {
  const trimmed = String(value ?? '').trim()
  return trimmed || fallback
}

export const LLM_BACKENDS = ['chat-completions', 'responses-api', 'mlx-lm']
export const TTS_MODES = ['supertonic', 'openai-http']
export const STT_BACKENDS = ['parakeet-tdt', 'whisper-mlx', 'mlx-audio-whisper']

/**
 * Normalize the VOICE_* profile into one object. Missing values fall back to
 * the default profile; the returned `errors` list names required settings that
 * are still empty so `doctor` and `start` can refuse loudly instead of starting
 * a half-configured stack.
 */
export function resolveVoiceConfig(env = {}) {
  const errors = []
  const llmBackend = text(env.VOICE_LLM_BACKEND, 'chat-completions')
  if (!LLM_BACKENDS.includes(llmBackend)) {
    errors.push(`VOICE_LLM_BACKEND must be one of ${LLM_BACKENDS.join(', ')}`)
  }
  const ttsMode = text(env.VOICE_TTS_MODE, 'supertonic')
  if (!TTS_MODES.includes(ttsMode)) {
    errors.push(`VOICE_TTS_MODE must be one of ${TTS_MODES.join(', ')}`)
  }
  const stt = text(env.VOICE_STT, 'mlx-audio-whisper')
  if (!STT_BACKENDS.includes(stt)) {
    errors.push(`VOICE_STT must be one of ${STT_BACKENDS.join(', ')}`)
  }
  const remoteLlm = llmBackend !== 'mlx-lm'
  const config = {
    realtimeProvider: text(env.QWEN_AUDIO_REALTIME_PROVIDER, 'speech-to-speech'),
    agentProtocol: text(env.AGENT_PROTOCOL, 'claude'),
    permissionMode: text(env.QWEN_AUDIO_AGENT_BACKEND_PERMISSION_MODE, 'native'),
    llm: {
      backend: llmBackend,
      remote: remoteLlm,
      model: text(env.VOICE_LLM_MODEL, remoteLlm ? 'glm-5.3-flash' : ''),
      baseUrl: text(env.VOICE_LLM_BASE_URL).replace(/\/+$/, ''),
      apiKey: text(env.VOICE_LLM_API_KEY),
      stream: bool(env.VOICE_LLM_STREAM, true),
      chatSize: int(env.VOICE_LLM_CHAT_SIZE, 4, { min: 1, max: 64 }),
      reasoningEffort: text(env.VOICE_LLM_REASONING_EFFORT),
    },
    stt: {
      backend: stt,
      language: text(env.VOICE_STT_LANGUAGE),
    },
    tts: {
      mode: ttsMode,
      voice: text(env.SUPERTONIC_VOICE, 'M1'),
      language: text(env.SUPERTONIC_LANGUAGE, 'na'),
      speed: text(env.SUPERTONIC_SPEED, '1.0'),
      baseUrl: text(env.SUPERTONIC_BASE_URL, 'http://127.0.0.1:7788/v1').replace(/\/+$/, ''),
      model: text(env.SUPERTONIC_MODEL, 'supertonic-3'),
    },
    s2s: {
      host: text(env.VOICE_S2S_HOST, '127.0.0.1'),
      port: int(env.VOICE_S2S_PORT, 8765, { min: 1, max: 65535 }),
      pipelines: int(env.VOICE_PIPELINES, 1, { min: 1, max: 8 }),
      liveTranscription: bool(env.VOICE_LIVE_TRANSCRIPTION, true),
      logTranscripts: bool(env.VOICE_LOG_TRANSCRIPTS, false),
      realtimeUrl: text(env.SPEECH_TO_SPEECH_REALTIME_URL, 'ws://127.0.0.1:8765/v1/realtime'),
    },
    gateway: {
      host: text(env.HOST, '127.0.0.1'),
      port: int(env.PORT, 3101, { min: 1, max: 65535 }),
    },
  }
  config.s2s.httpBaseUrl = `http://${config.s2s.host}:${config.s2s.port}`
  config.gateway.baseUrl = `http://${config.gateway.host}:${config.gateway.port}`
  if (config.realtimeProvider !== 'speech-to-speech') {
    errors.push('QWEN_AUDIO_REALTIME_PROVIDER must be speech-to-speech for this profile')
  }
  if (config.agentProtocol !== 'claude') {
    errors.push('AGENT_PROTOCOL must be claude for this profile')
  }
  if (config.permissionMode === 'full') {
    errors.push('QWEN_AUDIO_AGENT_BACKEND_PERMISSION_MODE=full is not allowed by default; use native')
  }
  if (remoteLlm) {
    if (!config.llm.baseUrl) errors.push('VOICE_LLM_BASE_URL is empty')
    if (!config.llm.apiKey) errors.push('VOICE_LLM_API_KEY is empty')
    if (!config.llm.model) errors.push('VOICE_LLM_MODEL is empty')
  } else if (!config.llm.model) {
    errors.push('VOICE_LLM_MODEL is empty (mlx-lm needs a Hugging Face model id)')
  }
  if (!['127.0.0.1', 'localhost', '::1'].includes(config.s2s.host)) {
    errors.push('VOICE_S2S_HOST must stay on loopback (127.0.0.1)')
  }
  return { config, errors }
}
