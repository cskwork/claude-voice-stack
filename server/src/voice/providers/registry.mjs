import { config } from '../../core/config.mjs'
import {
  listDashScopeRealtimeModelProfiles,
  normalizeRealtimeProvider,
} from '../../../../shared/realtime-provider-catalog.mjs'
import { dashscopeProvider } from './dashscope.mjs'
import { s2sProvider } from './s2s.mjs'

const PROVIDER_METHODS = [
  'model',
  'voice',
  'isConfigured',
  'url',
  'headers',
  'classifyError',
  'buildSession',
  'buildSpeakResponse',
  'buildResultInjection',
  'buildPermissionInjection',
]

const PROTOCOL_METHODS = [
  'encodeOutgoing',
  'normalizeIncoming',
  'sessionUpdate',
  'audioAppend',
  'conversationItemId',
  'conversationItemCreate',
  'responseCreate',
  'correlateResponseCreate',
  'responseCorrelationId',
  'responseCancel',
  'userTextItem',
  'functionOutputItem',
]

// Optional behavioural declarations. Providers explicitly opt in to optional
// features and declare departures from the shared protocol baseline. See
// DEFAULT_CAPABILITIES in realtime-provider.mjs for each flag's default.
const CAPABILITY_FLAGS = [
  'acknowledgesSessionUpdate',
  'singleResponseSlot',
  'responseMetadataCorrelation',
  'perResponseInstructions',
]

const MODEL_CAPABILITY_FLAGS = [
  'textInput',
  'audioInput',
  'imageInput',
  'videoInput',
  'textOutput',
  'audioOutput',
  'functionCalling',
]

const TRANSPORT_CAPABILITY_FLAGS = [
  'textInput',
  'audioInput',
  'imageInput',
  'observationInput',
  'nativeVideoInput',
]

function validateCapabilitySet(provider, profile, property, requiredFlags) {
  const capabilities = profile[property]
  if (
    !capabilities
    || typeof capabilities !== 'object'
    || Array.isArray(capabilities)
    || requiredFlags.some(flag => typeof capabilities[flag] !== 'boolean')
    || Object.values(capabilities).some(value => typeof value !== 'boolean')
  ) {
    throw new Error(
      `Realtime Provider ${provider.key} modelProfile.${property} 不完整`,
    )
  }
}

function validateModelProfile(provider) {
  if (provider.modelProfile === undefined) return
  if (typeof provider.modelProfile !== 'function') {
    throw new Error(`Realtime Provider ${provider.key} modelProfile 必须是函数`)
  }
  const profile = provider.modelProfile()
  if (profile === null) return
  if (
    !profile
    || typeof profile !== 'object'
    || Array.isArray(profile)
    || ['id', 'label', 'family'].some(property => (
      typeof profile[property] !== 'string' || !profile[property].trim()
    ))
  ) {
    throw new Error(`Realtime Provider ${provider.key} modelProfile 无效`)
  }
  validateCapabilitySet(
    provider,
    profile,
    'modelCapabilities',
    MODEL_CAPABILITY_FLAGS,
  )
  validateCapabilitySet(
    provider,
    profile,
    'transportCapabilities',
    TRANSPORT_CAPABILITY_FLAGS,
  )
  if (
    !profile.sessionDefaults
    || typeof profile.sessionDefaults !== 'object'
    || (
      profile.sessionDefaults.voice !== null
      && (
        typeof profile.sessionDefaults.voice !== 'string'
        || !profile.sessionDefaults.voice.trim()
      )
    )
    || (
      profile.sessionDefaults.turnDetection !== null
      && (
        typeof profile.sessionDefaults.turnDetection !== 'object'
        || typeof profile.sessionDefaults.turnDetection.type !== 'string'
        || !profile.sessionDefaults.turnDetection.type.trim()
      )
    )
  ) {
    throw new Error(
      `Realtime Provider ${provider.key} modelProfile.sessionDefaults 不完整`,
    )
  }
}

export function validateRealtimeProvider(provider) {
  if (!provider?.key || !provider.label) {
    throw new Error('Realtime Provider 必须定义 key 和 label')
  }
  for (const method of PROVIDER_METHODS) {
    if (typeof provider[method] !== 'function') {
      throw new Error(`Realtime Provider ${provider.key} 缺少 ${method}()`)
    }
  }
  if (!Number.isFinite(provider.inputSampleRate)) {
    throw new Error(`Realtime Provider ${provider.key} 缺少 inputSampleRate`)
  }
  if (!Number.isFinite(provider.outputSampleRate)) {
    throw new Error(`Realtime Provider ${provider.key} 缺少 outputSampleRate`)
  }
  if (
    provider.responseStartTimeoutMs !== undefined
    && (
      !Number.isFinite(provider.responseStartTimeoutMs)
      || provider.responseStartTimeoutMs <= 0
    )
  ) {
    throw new Error(
      `Realtime Provider ${provider.key} 的 responseStartTimeoutMs 必须是正数`,
    )
  }
  for (const method of PROTOCOL_METHODS) {
    if (typeof provider.protocol?.[method] !== 'function') {
      throw new Error(
        `Realtime Provider ${provider.key} protocol 缺少 ${method}()`,
      )
    }
  }
  for (const flag of Object.keys(provider.capabilities || {})) {
    if (!CAPABILITY_FLAGS.includes(flag)) {
      throw new Error(
        `Realtime Provider ${provider.key} 声明了未知能力：${flag}`,
      )
    }
    if (typeof provider.capabilities[flag] !== 'boolean') {
      throw new Error(
        `Realtime Provider ${provider.key} 的能力 ${flag} 必须是布尔值`,
      )
    }
  }
  validateModelProfile(provider)
  return provider
}

validateRealtimeProvider(dashscopeProvider)
validateRealtimeProvider(s2sProvider)

const providers = new Map([
  ['dashscope', dashscopeProvider],
  ['speech-to-speech', s2sProvider],
])

export function resolveRealtimeProvider(requested) {
  const key = normalizeRealtimeProvider(requested || config.audioProvider)
  const provider = providers.get(key)
  return provider
}

export function listRealtimeProviders() {
  return [...providers.values()]
    .filter(provider => provider.isConfigured())
    .map(provider => ({
      key: provider.key,
      label: provider.label,
      model: provider.model(),
      realtimeModelIds: provider.key === 'dashscope'
        ? listDashScopeRealtimeModelProfiles().map(profile => profile.id)
        : null,
      configured: provider.isConfigured(),
    }))
}

export function describeActiveRealtime(requested) {
  const provider = resolveRealtimeProvider(requested)
  const modelProfile = provider.modelProfile?.() || null
  return {
    provider: provider.key,
    label: provider.label,
    model: provider.model(),
    modelProfile,
    modelCapabilities: modelProfile?.modelCapabilities || null,
    transportCapabilities: modelProfile?.transportCapabilities || null,
    modelCatalog: provider.key === 'dashscope'
      ? listDashScopeRealtimeModelProfiles()
      : [],
    voice: provider.voice(),
    inputSampleRate: provider.inputSampleRate,
    configured: provider.isConfigured(),
    configurationSignature: config.realtimeConfigSignature,
    providers: listRealtimeProviders(),
  }
}

/**
 * Exposed for tests and callers that need direct provider access.
 * New code should use resolveRealtimeProvider() instead.
 */
export const REALTIME_PROVIDERS = Object.freeze({
  ...Object.fromEntries(providers),
  // Compatibility aliases for older internal callers. Provider selection is
  // normalized by the shared catalog before registry lookup.
  qwen: dashscopeProvider,
  s2s: s2sProvider,
})
