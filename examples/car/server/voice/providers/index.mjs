import {
  CAR_AGENT_TOOL_NAME,
  DashScopeRealtimeProvider,
  QWEN_AUDIO_REALTIME_PROVIDER_ID,
  normalizeRealtimeProviderId,
} from './dashscope-realtime.mjs'

export { CAR_AGENT_TOOL_NAME }
export { QWEN_AUDIO_REALTIME_PROVIDER_ID, normalizeRealtimeProviderId }

export const DEFAULT_REALTIME_PROVIDER_ID = QWEN_AUDIO_REALTIME_PROVIDER_ID

export function createRealtimeProvider(providerId = DEFAULT_REALTIME_PROVIDER_ID, options = {}) {
  return new DashScopeRealtimeProvider(normalizeRealtimeProviderId(providerId), options)
}
