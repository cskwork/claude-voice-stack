import { config, realtimeUrl } from '../../core/config.mjs'
import {
  listDashScopeRealtimeModelProfiles,
  resolveDashScopeRealtimeModelProfile,
} from '../../../../shared/realtime-provider-catalog.mjs'
import {
  buildFrontendInstructions,
  frontendTools,
  resultResponseInstructions,
  speakResponseInstructions,
  permissionResponseInstructions,
} from '../frontend-tools.mjs'
import { isRecoverableRealtimeInactivityError } from '../realtime-errors.mjs'
import { openAiCompatibleProtocol } from './openai-compatible-protocol.mjs'

function classifyError(message) {
  if (isRecoverableRealtimeInactivityError(message)) return 'inactivity'
  if (/user is speaking/i.test(message)) return 'input_busy'
  if (/no active response/i.test(message)) return 'no_active_response'
  if (
    /invalid[_ -]?api[_ -]?key|incorrect api key|authentication failed|unauthorized|unexpected server response: (?:401|403)/i
      .test(message)
    || /\barrearage\b|account is not in good standing/i.test(message)
    || /allocationquota\.freetieronly|free allocated quota exceeded|free tier .* exhausted/i
      .test(message)
    || /model(?:\.|_)?accessdenied|model[_ -]?not[_ -]?found/i.test(message)
  ) return 'fatal'
  return 'other'
}

function responseModalities(profile) {
  const capabilities = profile.modelCapabilities
  return [
    capabilities.textOutput ? 'text' : null,
    capabilities.audioOutput ? 'audio' : null,
  ].filter(Boolean)
}

export function createQwenRealtimeProvider({
  key = 'dashscope',
  label = 'Qwen-Audio-Realtime',
  aliases = ['qwen'],
  visibility = 'public',
  inputSampleRate = 16000,
  outputSampleRate = 24000,
  protocol = openAiCompatibleProtocol,
  createProtocol,
  model = () => config.audioModel,
  voice,
  isConfigured = () => Boolean(config.dashscopeApiKey),
  url = () => realtimeUrl(config.audioRealtimeBaseUrl, model()),
  headers = () => ({ Authorization: `Bearer ${config.dashscopeApiKey}` }),
  classifyProviderError = classifyError,
  configurationSignature,
  missingConfigurationMessage = '请先配置 DASHSCOPE_API_KEY',
  connectTimeoutMessage = '连接 Qwen Audio Realtime 超时',
} = {}) {
  const activeModelProfile = () => (
    resolveDashScopeRealtimeModelProfile(model())
  )
  const resolveVoice = voice || (() => (
    config.audioVoice || activeModelProfile().sessionDefaults.voice
  ))
  const provider = {
    key,
    label,
    aliases,
    visibility,
    inputSampleRate,
    outputSampleRate,
    protocol,

    get capabilities() {
      return {
        perResponseInstructions: true,
        conversationItemIdEcho: activeModelProfile().family !== 'omni',
      }
    },

    model,
    modelCatalog: listDashScopeRealtimeModelProfiles,
    modelProfile: activeModelProfile,
    voice: resolveVoice,
    isConfigured,
    missingConfigurationMessage,
    connectTimeoutMessage,

    url,
    headers,
    classifyError: classifyProviderError,

    buildSession: ({ configured, agentContext }) => {
      const profile = activeModelProfile()
      const session = {
        instructions: buildFrontendInstructions(agentContext),
      }
      if (profile.modelCapabilities.functionCalling) {
        session.tools = frontendTools(agentContext)
      }
      if (!configured) {
        session.modalities = responseModalities(profile)
        if (profile.modelCapabilities.audioOutput) {
          session.voice = provider.voice()
          session.output_audio_format = 'pcm'
        }
        if (profile.transportCapabilities.audioInput) {
          session.input_audio_format = 'pcm'
        }
        session.turn_detection = profile.transportCapabilities.audioInput
          ? profile.sessionDefaults.turnDetection
          : null
      }
      return session
    },

    buildSpeakResponse: content => ({
      conversation: 'none',
      modalities: responseModalities(activeModelProfile()),
      instructions: speakResponseInstructions(content),
    }),

    buildResultInjection: content => ({
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: content }],
      },
      response: {
        modalities: responseModalities(activeModelProfile()),
        tool_choice: 'none',
        instructions: resultResponseInstructions,
      },
    }),

    buildPermissionInjection: permission => ({
      item: {
        type: 'message',
        role: 'user',
        content: [{
          type: 'input_text',
          text: [
            '<backend_permission_request>',
            `authorization_id=${permission.id}`,
            `operation=${permission.summary}`,
            '</backend_permission_request>',
          ].join('\n'),
        }],
      },
      response: {
        modalities: responseModalities(activeModelProfile()),
        tool_choice: 'none',
        instructions: permissionResponseInstructions,
      },
    }),
  }
  if (configurationSignature) {
    provider.configurationSignature = configurationSignature
  }
  if (createProtocol) {
    delete provider.protocol
    provider.createProtocol = createProtocol
  }
  return provider
}

export const dashscopeProvider = createQwenRealtimeProvider()
