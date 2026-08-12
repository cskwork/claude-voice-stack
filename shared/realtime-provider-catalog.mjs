import { createHash } from 'node:crypto'

export const DEFAULT_REALTIME_PROVIDER = 'dashscope'
export const DEFAULT_DASHSCOPE_REALTIME_MODEL = 'qwen-audio-3.0-realtime-plus'
export const DEFAULT_DASHSCOPE_REALTIME_VOICE = 'longanqian'
export const DEFAULT_DASHSCOPE_REALTIME_URL = 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime'
export const DEFAULT_SPEECH_TO_SPEECH_REALTIME_URL = 'ws://127.0.0.1:8765/v1/realtime'

export const DASHSCOPE_AUDIO_FLASH_REALTIME_MODEL = 'qwen-audio-3.0-realtime-flash'
export const DASHSCOPE_OMNI_FLASH_REALTIME_MODEL = 'qwen3.5-omni-flash-realtime'
export const DASHSCOPE_OMNI_PLUS_REALTIME_MODEL = 'qwen3.5-omni-plus-realtime'

const OMNI_MODEL_CAPABILITIES = Object.freeze({
  textInput: true,
  audioInput: true,
  imageInput: true,
  videoInput: false,
  textOutput: true,
  audioOutput: true,
  functionCalling: true,
})

const OMNI_TRANSPORT_CAPABILITIES = Object.freeze({
  textInput: true,
  audioInput: true,
  imageInput: false,
  observationInput: false,
  nativeVideoInput: false,
})

const LEGACY_MODEL_CAPABILITIES = Object.freeze({
  textInput: true,
  audioInput: true,
  imageInput: false,
  videoInput: false,
  textOutput: true,
  audioOutput: true,
  functionCalling: true,
})

const LEGACY_TRANSPORT_CAPABILITIES = Object.freeze({
  textInput: true,
  audioInput: true,
  imageInput: false,
  observationInput: false,
  nativeVideoInput: false,
})

const UNKNOWN_MODEL_CAPABILITIES = Object.freeze({
  textInput: false,
  audioInput: false,
  imageInput: false,
  videoInput: false,
  textOutput: false,
  audioOutput: false,
  functionCalling: false,
})

const UNKNOWN_TRANSPORT_CAPABILITIES = Object.freeze({
  textInput: false,
  audioInput: false,
  imageInput: false,
  observationInput: false,
  nativeVideoInput: false,
})

const DASHSCOPE_OMNI_REALTIME_SESSION_DEFAULTS = Object.freeze({
  voice: 'Ethan',
  turnDetection: Object.freeze({ type: 'semantic_vad' }),
})

const DASHSCOPE_AUDIO_REALTIME_SESSION_DEFAULTS = Object.freeze({
  voice: DEFAULT_DASHSCOPE_REALTIME_VOICE,
  turnDetection: Object.freeze({ type: 'smart_turn' }),
})

const UNKNOWN_SESSION_DEFAULTS = Object.freeze({
  voice: null,
  turnDetection: null,
})

export const DASHSCOPE_REALTIME_MODEL_PROFILES = Object.freeze([
  Object.freeze({
    id: DASHSCOPE_OMNI_FLASH_REALTIME_MODEL,
    label: 'Qwen3.5 Omni Flash Realtime',
    family: 'omni',
    sessionDefaults: DASHSCOPE_OMNI_REALTIME_SESSION_DEFAULTS,
    modelCapabilities: OMNI_MODEL_CAPABILITIES,
    transportCapabilities: OMNI_TRANSPORT_CAPABILITIES,
  }),
  Object.freeze({
    id: DASHSCOPE_OMNI_PLUS_REALTIME_MODEL,
    label: 'Qwen3.5 Omni Plus Realtime',
    family: 'omni',
    sessionDefaults: DASHSCOPE_OMNI_REALTIME_SESSION_DEFAULTS,
    modelCapabilities: OMNI_MODEL_CAPABILITIES,
    transportCapabilities: OMNI_TRANSPORT_CAPABILITIES,
  }),
  Object.freeze({
    id: DEFAULT_DASHSCOPE_REALTIME_MODEL,
    label: 'Qwen Audio 3.0 Realtime Plus',
    family: 'audio',
    sessionDefaults: DASHSCOPE_AUDIO_REALTIME_SESSION_DEFAULTS,
    modelCapabilities: LEGACY_MODEL_CAPABILITIES,
    transportCapabilities: LEGACY_TRANSPORT_CAPABILITIES,
  }),
  Object.freeze({
    id: DASHSCOPE_AUDIO_FLASH_REALTIME_MODEL,
    label: 'Qwen Audio 3.0 Realtime Flash',
    family: 'audio',
    sessionDefaults: DASHSCOPE_AUDIO_REALTIME_SESSION_DEFAULTS,
    modelCapabilities: LEGACY_MODEL_CAPABILITIES,
    transportCapabilities: LEGACY_TRANSPORT_CAPABILITIES,
  }),
])

const DASHSCOPE_REALTIME_MODEL_PROFILE_BY_ID = new Map(
  DASHSCOPE_REALTIME_MODEL_PROFILES.map(profile => [profile.id, profile]),
)

const PROVIDERS = Object.freeze({
  dashscope: Object.freeze({
    key: 'dashscope',
    label: 'DashScope',
    aliases: Object.freeze(['qwen']),
  }),
  'speech-to-speech': Object.freeze({
    key: 'speech-to-speech',
    label: 'Hugging Face Speech-to-Speech',
    aliases: Object.freeze(['s2s']),
  }),
})

const PROVIDER_ALIASES = new Map()
for (const provider of Object.values(PROVIDERS)) {
  PROVIDER_ALIASES.set(provider.key, provider.key)
  for (const alias of provider.aliases) {
    PROVIDER_ALIASES.set(alias, provider.key)
  }
}

function clean(value) {
  return String(value || '').trim()
}

function withoutTrailing(value, pattern) {
  return clean(value).replace(pattern, '')
}

export function listDashScopeRealtimeModelProfiles() {
  return DASHSCOPE_REALTIME_MODEL_PROFILES
}

export function resolveDashScopeRealtimeModelProfile(
  model = DEFAULT_DASHSCOPE_REALTIME_MODEL,
) {
  const id = clean(model) || DEFAULT_DASHSCOPE_REALTIME_MODEL
  const profile = DASHSCOPE_REALTIME_MODEL_PROFILE_BY_ID.get(id)
  if (profile) return profile

  return Object.freeze({
    id,
    label: id,
    family: 'unknown',
    sessionDefaults: UNKNOWN_SESSION_DEFAULTS,
    modelCapabilities: UNKNOWN_MODEL_CAPABILITIES,
    transportCapabilities: UNKNOWN_TRANSPORT_CAPABILITIES,
  })
}

export function voiceForDashScopeRealtimeModelSwitch({
  previousModel = DEFAULT_DASHSCOPE_REALTIME_MODEL,
  nextModel = DEFAULT_DASHSCOPE_REALTIME_MODEL,
  currentVoice = '',
} = {}) {
  const voice = clean(currentVoice)
  const previousDefault = resolveDashScopeRealtimeModelProfile(previousModel)
    .sessionDefaults.voice
  const nextDefault = resolveDashScopeRealtimeModelProfile(nextModel)
    .sessionDefaults.voice || DEFAULT_DASHSCOPE_REALTIME_VOICE
  if (!voice || (previousDefault && voice === previousDefault)) {
    return nextDefault
  }
  return voice
}

export function realtimeProviderNames() {
  return Object.keys(PROVIDERS)
}

export function normalizeRealtimeProvider(value, {
  fallback = DEFAULT_REALTIME_PROVIDER,
} = {}) {
  const requested = clean(value || fallback).toLowerCase()
  const provider = PROVIDER_ALIASES.get(requested)
  if (!provider) {
    throw new Error(
      `不支持的 Realtime 前台：${requested || value}`
      + `（可选 ${realtimeProviderNames().join('、')}）`,
    )
  }
  return provider
}

export function realtimeProviderDefinition(value) {
  const key = normalizeRealtimeProvider(value)
  return PROVIDERS[key]
}

export function resolveRealtimeFrontendConfiguration(env = process.env) {
  const provider = normalizeRealtimeProvider(env.QWEN_AUDIO_REALTIME_PROVIDER)
  const dashscopeApiKey = clean(
    env.QWEN_AUDIO_REALTIME_API_KEY || env.DASHSCOPE_API_KEY,
  )
  const dashscopeRealtimeUrl = withoutTrailing(
    env.QWEN_AUDIO_REALTIME_BASE_URL
    || env.QWEN_AUDIO_REALTIME_URL
    || (
      env.DASHSCOPE_WORKSPACE_ID
        ? `wss://${env.DASHSCOPE_WORKSPACE_ID}.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime`
        : DEFAULT_DASHSCOPE_REALTIME_URL
    ),
    /\?+$/,
  )
  const dashscopeModel = clean(env.QWEN_AUDIO_REALTIME_MODEL)
    || DEFAULT_DASHSCOPE_REALTIME_MODEL
  const dashscopeModelProfile = resolveDashScopeRealtimeModelProfile(
    dashscopeModel,
  )
  const dashscopeVoice = clean(env.QWEN_AUDIO_REALTIME_VOICE)
    || dashscopeModelProfile.sessionDefaults.voice
    || DEFAULT_DASHSCOPE_REALTIME_VOICE
  const speechToSpeechRealtimeUrl = withoutTrailing(
    env.SPEECH_TO_SPEECH_REALTIME_URL
    || env.S2S_REALTIME_URL
    || DEFAULT_SPEECH_TO_SPEECH_REALTIME_URL,
    /\/+$/,
  )
  const speechToSpeechAuthToken = clean(
    env.SPEECH_TO_SPEECH_AUTH_TOKEN || env.S2S_API_KEY,
  )
  const speechToSpeechConfigured = Boolean(
    clean(env.SPEECH_TO_SPEECH_REALTIME_URL)
    || clean(env.S2S_REALTIME_URL)
    || provider === 'speech-to-speech'
  )
  const configured = provider === 'dashscope'
    ? Boolean(dashscopeApiKey)
    : speechToSpeechConfigured
  const identity = provider === 'dashscope'
    ? {
        provider,
        endpoint: dashscopeRealtimeUrl,
        model: dashscopeModel,
        voice: dashscopeVoice,
        credential: dashscopeApiKey,
      }
    : {
        provider,
        endpoint: speechToSpeechRealtimeUrl,
        credential: speechToSpeechAuthToken,
      }
  const signature = createHash('sha256')
    .update(JSON.stringify(identity))
    .digest('hex')

  return {
    provider,
    label: PROVIDERS[provider].label,
    configured,
    signature,
    dashscopeApiKey,
    dashscopeRealtimeUrl,
    dashscopeModel,
    dashscopeVoice,
    speechToSpeechRealtimeUrl,
    speechToSpeechAuthToken,
    speechToSpeechConfigured,
    missingConfigurationMessage: provider === 'dashscope'
      ? '缺少 DASHSCOPE_API_KEY。请运行 qwenaudio config 查看配置文件位置。'
      : `无法使用 ${PROVIDERS[provider].label} 前台，请检查其服务地址和配置。`,
  }
}
