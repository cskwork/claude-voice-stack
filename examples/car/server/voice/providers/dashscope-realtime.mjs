import WebSocket from 'ws'
import { randomUUID } from 'crypto'
import { buildCurrentTimePrompt } from '../../time-context.mjs'
import {
  DEFAULT_DASHSCOPE_REALTIME_MODEL,
  DEFAULT_DASHSCOPE_REALTIME_URL,
  DEFAULT_DASHSCOPE_REALTIME_VOICE,
  resolveDashScopeRealtimeModelProfile,
  resolveDashScopeRealtimeVoiceOverride,
} from '../../../../../shared/realtime-provider-catalog.mjs'

export const QWEN_AUDIO_REALTIME_PROVIDER_ID = 'qwen-audio-realtime'

export const CAR_AGENT_TOOL_NAME = 'route_to_car_agent'

const ROUTE_TOOL = {
  type: 'function',
  function: {
    name: CAR_AGENT_TOOL_NAME,
    description: '当用户请求涉及车控、导航、音乐、天气、联网/最新/实时查询、淘宝闪购/外卖/奶茶/点餐/购物车/下单/订单确认、车辆状态、记忆、自定义技能、提醒、时间相关任务或座舱任务编排时调用。如果最近正在执行某个座舱任务，用户用“第一个/第一杯/就这个/确认/下单/可以/取消”等短句继续选择或确认，也必须调用。用户自报姓名/昵称/偏好/习惯/梦想/目标/愿望，或说“记住”“以后叫我”“我叫...”时，也必须调用。调用前必须先用中文口头说一句很短的等待提示，例如“我看一下”“稍等哦”“我查查”，然后立刻调用本工具。闲聊、百科、一般问候不要调用。',
    parameters: {
      type: 'object',
      properties: {
        utterance: {
          type: 'string',
          description: '用户完整原话，保留口语表达。',
        },
        reason: {
          type: 'string',
          description: '为什么需要交给车载 Agent 处理。',
        },
      },
      required: ['utterance'],
    },
  },
}

function realtimeUrl(baseUrl, model) {
  const url = String(baseUrl || '').trim()
  if (!model || url.includes('model=')) return url
  return `${url}${url.includes('?') ? '&' : '?'}model=${encodeURIComponent(model)}`
}

function clean(value) {
  return String(value || '').trim()
}

function realtimeModel() {
  return clean(process.env.QWEN_AUDIO_REALTIME_MODEL)
    || DEFAULT_DASHSCOPE_REALTIME_MODEL
}

function activeModelProfile() {
  return resolveDashScopeRealtimeModelProfile(realtimeModel())
}

function responseModalities(profile) {
  const capabilities = profile.modelCapabilities
  return [
    capabilities.textOutput ? 'text' : null,
    capabilities.audioOutput ? 'audio' : null,
  ].filter(Boolean)
}

function eventId() {
  return `event_${randomUUID().replaceAll('-', '')}`
}

export function normalizeRealtimeProviderId(providerId) {
  // The car example exposes one DashScope realtime provider. The selected
  // concrete model is configured through QWEN_AUDIO_REALTIME_MODEL, matching
  // the main qwen-audio-agent runtime.
  void providerId
  return QWEN_AUDIO_REALTIME_PROVIDER_ID
}

const QWEN_AUDIO_REALTIME_PROVIDER = {
  label: 'Qwen-Audio-Realtime',
  modelProfile: activeModelProfile,
  url: () => realtimeUrl(
    clean(process.env.QWEN_AUDIO_REALTIME_BASE_URL)
      || clean(process.env.QWEN_AUDIO_REALTIME_URL)
      || (
        clean(process.env.DASHSCOPE_WORKSPACE_ID)
      ? `wss://${clean(process.env.DASHSCOPE_WORKSPACE_ID)}.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime`
      : ''
      )
      || DEFAULT_DASHSCOPE_REALTIME_URL,
    realtimeModel(),
  ),
  apiKey: () => clean(process.env.QWEN_AUDIO_REALTIME_API_KEY)
    || clean(process.env.DASHSCOPE_API_KEY),
  keyName: 'QWEN_AUDIO_REALTIME_API_KEY or DASHSCOPE_API_KEY',
  voice: () => clean(process.env.QWEN_AUDIO_REALTIME_VOICE)
    || resolveDashScopeRealtimeVoiceOverride(realtimeModel())
    || activeModelProfile().sessionDefaults.voice
    || DEFAULT_DASHSCOPE_REALTIME_VOICE,
  headers: () => ({
    'x-dashscope-dataInspection': 'disable',
  }),
}

function realtimeProviderConfig(providerId) {
  normalizeRealtimeProviderId(providerId)
  return QWEN_AUDIO_REALTIME_PROVIDER
}

function buildInstructions(config = {}) {
  const soul = config.soul || '聊愈师'
  const currentTimePrompt = buildCurrentTimePrompt()
  const voiceContextPrompt = String(config.voiceContextPrompt || '').trim()
  const contextBlock = voiceContextPrompt ? `
以下是你在本次语音会话中可参考的用户上下文。它用于保持称呼、偏好、语气和最近话题的连续性；涉及车控、导航、音乐、记忆、自定义技能或其他座舱任务时，仍必须调用 ${CAR_AGENT_TOOL_NAME}，不能直接用文字假装执行。

${voiceContextPrompt}
` : ''

  return `你是 Qwen Audio Agent Car 的端到端语音入口，当前角色是${soul}。
${currentTimePrompt}
${contextBlock}

如果用户只是闲聊、问候、开玩笑、询问普通常识，并且不需要车辆能力，直接用自然中文语音回复。

如果用户请求涉及以下任一内容，必须调用 ${CAR_AGENT_TOOL_NAME}：
- 车窗、天窗、大灯、空调、车辆状态
- 导航、路线、目的地、途经点、停止导航
- 音乐播放、暂停、切歌、搜索歌曲
- 淘宝闪购、外卖、奶茶、咖啡、点餐、购物车、订单预览、确认下单、取消订单
- 天气、气温、带伞、穿衣建议
- 联网、网上查、最新、实时、新闻、政策、价格、限行等强时效查询
- 用户记忆、偏好、提醒、自定义技能
- 用户自报姓名、昵称、偏好、习惯、职业、梦想、目标、愿望，或说“记住”“以后叫我”“我叫...”
- 时间相关任务，例如“提醒我十分钟后”“今天几号”“明天早上”
- 多步骤座舱任务，例如“下班回家”“送老婆到公司”

如果最近对话正在进行一个座舱任务，用户用很短的话继续选择、确认、修改或取消，也必须调用 ${CAR_AGENT_TOOL_NAME}，不能直接口头承诺执行。典型短句包括：
- “第一个”“第一杯”“就这个”“换第二个”
- “确认”“下单”“可以买”“可以”“不要了”“取消”
- “少糖”“热的”“大杯”“改一下”

如果上方上下文列出了可用自定义技能，用户原话命中技能名称、触发条件或描述中的关键词时，也必须调用 ${CAR_AGENT_TOOL_NAME}。例如上下文里有“天王盖地虎: 当用户说天王盖地虎时...”，用户说“天王盖地虎”时必须调用工具，不能当作闲聊自行回答。

在调用 ${CAR_AGENT_TOOL_NAME} 前，必须先用中文自然说一句很短的等待提示，然后立刻调用工具。等待提示只能表达“正在处理”，不要承诺结果，不要解释过程，不要超过 6 个汉字。
可根据场景选择或轻微变化：
- 车控：我来处理 / 稍等哦
- 导航：我查查 / 我看一下
- 音乐：我找找 / 我看看
- 其他座舱任务：我看一下 / 稍等哦
不要连续多轮重复同一句等待提示。

调用 ${CAR_AGENT_TOOL_NAME} 后，等待工具结果，再把结果用简短自然的中文播报给用户。不要自己编造车控、导航或音乐执行结果。`
}

export class DashScopeRealtimeProvider {
  constructor(providerId = QWEN_AUDIO_REALTIME_PROVIDER_ID, { onEvent, onClose, onError } = {}) {
    this.providerId = normalizeRealtimeProviderId(providerId)
    this.provider = realtimeProviderConfig(this.providerId)
    this.ws = null
    this.ready = false
    this.onEvent = onEvent
    this.onClose = onClose
    this.onError = onError
    this.responseWaiters = []
    this.responseOrigins = []
    this.sessionConfigured = false
  }

  connect(config = {}) {
    const profile = this.provider.modelProfile()
    if (profile.family === 'unknown') {
      return Promise.reject(new Error(`不支持的 Realtime 模型：${profile.id}`))
    }
    const apiKey = this.provider.apiKey()
    if (!apiKey) {
      return Promise.reject(new Error(`${this.provider.keyName} is required`))
    }

    if (this.ready && this.ws?.readyState === WebSocket.OPEN) {
      this.updateSession(config)
      return Promise.resolve()
    }

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.provider.url(), {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...this.provider.headers(),
        },
      })
      this.ws = ws
      let settled = false

      const fail = (err) => {
        if (settled) return
        settled = true
        this.onError?.(err)
        reject(err)
      }

      const timeout = setTimeout(() => {
        fail(new Error(`Timed out waiting for ${this.provider.label} realtime provider`))
        ws.close()
      }, 30000)

      const finish = () => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        ws.off('error', fail)
        this.ready = true
        resolve()
      }

      ws.once('error', fail)
      ws.on('error', (err) => this.onError?.(err))
      ws.on('close', () => {
        this.ready = false
        this.sessionConfigured = false
        this.resolveResponseWaiters()
        clearTimeout(timeout)
        this.onClose?.()
      })
      ws.on('message', (raw) => {
        let event
        try {
          event = JSON.parse(raw.toString())
        } catch {
          return
        }
        if (event.type === 'session.created') {
          this.updateSession(config)
        } else if (event.type === 'session.updated') {
          this.sessionConfigured = true
          finish()
        } else if (event.type === 'response.created') {
          event.__voiceOrigin = this.responseOrigins.shift() || 'model'
        }
        this.onEvent?.(event)
        if (event.type === 'response.done' || event.type === 'error') {
          this.resolveResponseWaiter()
        }
      })
    })
  }

  updateSession(config = {}) {
    const profile = this.provider.modelProfile()
    const session = {
      instructions: buildInstructions(config),
    }
    if (profile.modelCapabilities.functionCalling) {
      session.tools = [ROUTE_TOOL]
    }
    if (!this.sessionConfigured) {
      session.modalities = responseModalities(profile)
      if (profile.modelCapabilities.audioOutput) {
        session.voice = this.provider.voice()
        session.output_audio_format = 'pcm'
      }
      if (profile.transportCapabilities.audioInput) {
        session.input_audio_format = 'pcm'
      }
      session.turn_detection = profile.transportCapabilities.audioInput
        ? profile.sessionDefaults.turnDetection
        : null
    }

    this.send({
      event_id: eventId(),
      type: 'session.update',
      session,
    })
  }

  appendAudio(audio) {
    this.send({ event_id: eventId(), type: 'input_audio_buffer.append', audio })
  }

  sendFunctionOutput(callId, output, { createResponse = true } = {}) {
    this.send({
      event_id: eventId(),
      type: 'conversation.item.create',
      item: {
        id: `item_${randomUUID().replaceAll('-', '')}`,
        type: 'function_call_output',
        call_id: callId,
        output,
      },
    })
    if (!createResponse) return
    this.responseOrigins.push('main')
    this.send({ event_id: eventId(), type: 'response.create' })
  }

  cancelResponse() {
    this.responseOrigins = []
    this.send({ event_id: eventId(), type: 'response.cancel' })
  }

  speakProgress(message) {
    const text = String(message || '').trim()
    if (!text || this.ws?.readyState !== WebSocket.OPEN) return Promise.resolve()

    let waiter
    const responseDone = new Promise((resolve) => {
      const finish = () => {
        clearTimeout(waiter.timeout)
        this.responseWaiters = this.responseWaiters.filter(item => item !== waiter)
        resolve()
      }
      waiter = {
        finish,
        timeout: setTimeout(finish, 30000),
      }
      this.responseWaiters.push(waiter)
    })
    this.responseOrigins.push('progress')
    this.send({
      event_id: eventId(),
      type: 'response.create',
      response: {
        conversation: 'none',
        modalities: ['text', 'audio'],
        instructions: `只自然播报这句中文短进度，不要添加任何其他内容，不要调用工具：${text}`,
      },
    })
    return responseDone
  }

  resolveResponseWaiter() {
    const waiter = this.responseWaiters.shift()
    waiter?.finish()
  }

  resolveResponseWaiters() {
    const waiters = this.responseWaiters
    this.responseWaiters = []
    waiters.forEach(waiter => waiter.finish())
  }

  send(event) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(event))
    }
  }

  close() {
    this.ready = false
    this.sessionConfigured = false
    this.resolveResponseWaiters()
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
      this.ws.close()
    }
    this.ws = null
  }
}

export class QwenAudioRealtimeProvider extends DashScopeRealtimeProvider {
  constructor(options) {
    super(QWEN_AUDIO_REALTIME_PROVIDER_ID, options)
  }
}
