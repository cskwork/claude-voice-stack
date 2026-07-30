import WebSocket from 'ws'
import { randomUUID } from 'crypto'
import { config, realtimeUrl } from '../core/config.mjs'
import {
  buildFrontendContext,
  loadFrontendPrompt,
} from '../conversation/frontend-agent-context.mjs'

export const SPAWN_THINKING_TOOL_NAME = 'spawn_thinking'
export const DELEGATE_TOOL_NAME = SPAWN_THINKING_TOOL_NAME
export const CANCEL_AGENT_TASK_TOOL_NAME = 'cancel_agent_task'
export const GET_AGENT_TASK_STATUS_TOOL_NAME = 'get_agent_task_status'
export const GET_CURRENT_TIME_TOOL_NAME = 'get_current_time'
export const USER_MEMORY_TOOL_NAME = 'user_memory'
export const RESPOND_AGENT_PERMISSION_TOOL_NAME = 'respond_agent_permission'

const delegateTool = {
  type: 'function',
  function: {
    name: DELEGATE_TOOL_NAME,
    description: '把明确的新执行或调查要求交给后台 Agent。需要当前信息、搜索、检查、工具、文件、屏幕、应用、代码、创作，或要求继续、修改已有工作时调用；询问此前工作的状态、进度、阶段产物或已经发现了什么统一改用 get_agent_task_status。缺少不可推断的核心目标时先问一个必要问题。可以按需先说一句具体行动预告，不要使用“好的、收到”等通用承接语。返回 accepted 只表示已受理；结合本轮已有发言判断是否还需回应，不重复确认或声称完成。',
    parameters: {
      type: 'object',
      properties: {
        objective: {
          type: 'string',
          description: '必须是已经可以执行的目标，忠实保留本轮用户要求并写明对象、动作、约束和期望结果，不得用“待用户说明主题”等占位内容启动空执行。仅在当前对话已经明确时消解“它、刚才那个”等指代；不要猜测或补造事实。后台 Agent 会同时收到近期对话和后台执行状态，因此这里是意图交接，不是对历史的替代。',
        },
      },
      required: ['objective'],
      additionalProperties: false,
    },
  },
}

const cancelAgentTaskTool = {
  type: 'function',
  function: {
    name: CANCEL_AGENT_TASK_TOOL_NAME,
    description: '取消用户此前交给后台、目前仍在排队或执行的工作。用户明确说取消、停止、别做了、不要继续，或要求取消“刚才那个任务”时必须调用，不要只口头说忽略结果。能够从运行上下文确定 work_id 时传入；用户泛指刚才的工作时可省略，系统会取消最近提交且仍活跃的工作。',
    parameters: {
      type: 'object',
      properties: {
        work_id: {
          type: 'string',
          description: '要取消的 work_id。仅在运行上下文已明确给出时填写；不得猜造。省略则取消当前语音会话最近提交且仍活跃的工作。',
        },
      },
      additionalProperties: false,
    },
  },
}

const getAgentTaskStatusTool = {
  type: 'function',
  function: {
    name: GET_AGENT_TASK_STATUS_TOOL_NAME,
    description: '查询此前交给后台工作的状态、进度或阶段性结果。用户询问“刚才那个怎么样了、还在做吗、做到哪一步、已经发现了什么、是否完成”时统一调用，不要自行判断普通任务或第三层任务，也不要改用 spawn_thinking。系统会直接回答普通任务，并自动查询第三层任务。能够从运行上下文确定 work_id 时传入；省略时查询当前语音会话最近的工作。',
    parameters: {
      type: 'object',
      properties: {
        work_id: {
          type: 'string',
          description: '要查询的 work_id。仅在运行上下文已明确给出时填写，不得猜造；省略则查询当前语音会话最近的工作。',
        },
        question: {
          type: 'string',
          description: '用户本轮对任务状态、进度或阶段结果的原始问题。尽量忠实保留，不要自行改写成另一项任务；省略时系统会使用本轮语音转写。',
        },
      },
      additionalProperties: false,
    },
  },
}

const getCurrentTimeTool = {
  type: 'function',
  function: {
    name: GET_CURRENT_TIME_TOOL_NAME,
    description: '获取用户本地时区中的准确当前日期、时间和星期。用户询问当前时间、今天日期、星期或相对日期判断时调用；不用于创建提醒。',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
}

const userMemoryTool = {
  type: 'function',
  function: {
    name: USER_MEMORY_TOOL_NAME,
    description: '管理千问Audio前台持有的用户记忆。profile 用于称呼、时区、语言和稳定交互偏好；long_term 用于用户明确希望跨会话保留的个人事实、喜好、目标和约定；不要保存项目执行历史或后台工作细节。使用 recall 回忆，remember 新增，replace 用新事实替换明确相关的旧记录，forget 遗忘。',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['recall', 'remember', 'replace', 'forget'],
          description: '要执行的记忆操作。',
        },
        scope: {
          type: 'string',
          enum: ['profile', 'long_term', 'all'],
          description: '记忆范围。remember 和 replace 必须使用 profile 或 long_term；recall 和 forget 可以使用 all。',
        },
        content: {
          type: 'string',
          description: 'remember 或 replace 时要保存的完整、简洁事实。',
        },
        query: {
          type: 'string',
          description: 'recall 或 forget 时用于匹配记忆的自然语言查询。',
        },
        memory_ids: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 20,
          description: 'replace 时要被新事实取代的旧记忆 ID；必须来自本轮 recall 结果，不得猜造。',
        },
        all: {
          type: 'boolean',
          description: '仅用于 forget；用户明确要求清空所选范围时设为 true。',
        },
      },
      required: ['action', 'scope'],
      additionalProperties: false,
    },
  },
}

const respondAgentPermissionTool = {
  type: 'function',
  function: {
    name: RESPOND_AGENT_PERMISSION_TOOL_NAME,
    description: '回复当前正在等待用户决定的后台权限请求。由你结合刚提出的具体权限问题和用户本轮自然表达，智能判断为本会话自动允许、拒绝或尚不明确；不要依赖固定关键词。用户回答“可以”“行”“好”“允许”“同意”“没问题”等自然肯定表达就是明确同意，应调用 always，不得要求复述固定口令。明确拒绝时调用 reject，不明确时不要调用并继续询问。',
    parameters: {
      type: 'object',
      properties: {
        authorization_id: {
          type: 'string',
          description: '待确认请求的 authorization_id，必须来自当前运行上下文，不得猜造。',
        },
        decision: {
          type: 'string',
          enum: ['always', 'reject'],
          description: 'always 表示允许当前操作，并由 Gateway 在本次前台会话中自动允许后续权限请求；reject 表示拒绝当前操作，后续请求仍继续询问。',
        },
      },
      required: ['authorization_id', 'decision'],
      additionalProperties: false,
    },
  },
}

const TOOLS = [
  delegateTool,
  cancelAgentTaskTool,
  getAgentTaskStatusTool,
  getCurrentTimeTool,
  userMemoryTool,
  respondAgentPermissionTool,
]

const resultResponseInstructions = [
  '这是先前提交工作的最终结果，不是用户的新请求。',
  '把 result 当作事实材料，结合当前对话自然回应；可以按语境概括、合并、承接或询问必要信息，避免重复已经表达过的内容。',
  '输入包含多个 event 时，必须覆盖每个 event 的实质结果；不得只说其中一个，也不得让过程性或状态性内容掩盖真正完成的工作。',
  '开头直接说实际结果、关键发现、阻塞或必要问题，不用“好的、收到、任务完成了”等空泛承接语。',
  '不要朗读协议前缀、字段、执行 ID、路径、URL 或不适合口语的长内容。',
  '不要调用工具，不要添加事件中没有的事实，也不要把未完成说成完成。',
].join(' ')

function speakResponseInstructions(content) {
  return `请以自然口语传达下面的信息，保持事实一致，不调用工具：\n${content}`
}

const permissionResponseInstructions = [
  '这是后台 Agent 的权限请求。',
  '自然、简短地说明操作，并询问用户是否同意授权。',
  '不要规定具体回答方式，也不要提供或要求复述固定口令。',
  '不要调用工具或朗读内部字段，等待用户回答。',
].join(' ')

export function buildFrontendInstructions(agentContext = {}) {
  return `${loadFrontendPrompt()}\n\n${buildFrontendContext(agentContext)}`
}

function responseId(event) {
  return event.response_id || event.response?.id || ''
}

function eventId() {
  return `event_${randomUUID().replaceAll('-', '')}`
}

const dashscopeRealtimeProvider = {
    key: 'dashscope',
    label: 'Qwen-Audio-Realtime',
    model: () => config.audioModel,
    voice: () => config.audioVoice,
    inputSampleRate: 16000,
    apiKey: () => config.dashscopeApiKey,
    missingKeyMessage: '请先配置 DASHSCOPE_API_KEY',
    connectTimeoutMessage: '连接 Qwen Audio Realtime 超时',
    url: () => realtimeUrl(config.audioRealtimeBaseUrl, config.audioModel),
    headers: apiKey => ({ Authorization: `Bearer ${apiKey}` }),
    buildSession: ({ configured, agentContext }) => {
      const textOnly = agentContext?.textOnly === true
      const session = {
        instructions: buildFrontendInstructions(agentContext),
        tools: TOOLS,
      }
      if (!configured) {
        session.modalities = textOnly ? ['text'] : ['text', 'audio']
        session.voice = config.audioVoice
        session.input_audio_format = 'pcm'
        session.output_audio_format = 'pcm'
        session.turn_detection = textOnly ? null : { type: 'smart_turn' }
      }
      return session
    },
    buildSpeakResponse: (content, { textOnly = false } = {}) => ({
      conversation: 'none',
      modalities: textOnly ? ['text'] : ['text', 'audio'],
      instructions: speakResponseInstructions(content),
    }),
    buildResultInjection: (content, { textOnly = false } = {}) => ({
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: content }],
      },
      response: {
        modalities: textOnly ? ['text'] : ['text', 'audio'],
        tool_choice: 'none',
        instructions: resultResponseInstructions,
      },
    }),
    buildPermissionInjection: (permission, { textOnly = false } = {}) => ({
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
        modalities: textOnly ? ['text'] : ['text', 'audio'],
        tool_choice: 'none',
        instructions: permissionResponseInstructions,
      },
    }),
}

export const REALTIME_PROVIDERS = {
  dashscope: dashscopeRealtimeProvider,
  // Compatibility alias for internal callers while provider selection moves
  // to stable external names.
  qwen: dashscopeRealtimeProvider,
}

export function resolveRealtimeProvider() {
  const provider = REALTIME_PROVIDERS[
    config.audioProvider === 'qwen' ? 'dashscope' : config.audioProvider
  ]
  if (!provider) {
    throw new Error(`不支持的 Realtime 供应商：${config.audioProvider}`)
  }
  return provider
}

export function describeActiveRealtime() {
  const provider = resolveRealtimeProvider()
  return {
    provider: provider.key,
    label: provider.label,
    model: provider.model(),
    voice: provider.voice(),
    inputSampleRate: provider.inputSampleRate,
    configured: Boolean(provider.apiKey()),
  }
}

export class RealtimeFrontend {
  constructor({
    provider = resolveRealtimeProvider(),
    onEvent,
    onError,
    onClose,
    agentContext = {},
    responseStartTimeoutMs = 30000,
    responseCompletionTimeoutMs = 120000,
  } = {}) {
    this.provider = provider
    this.onEvent = onEvent
    this.onError = onError
    this.onClose = onClose
    this.agentContext = agentContext
    this.ws = null
    this.ready = false
    this.sessionConfigured = false
    this.activeResponses = new Set()
    this.pendingResponses = []
    this.responseWaiters = new Map()
    this.conversationItemWaiters = new Map()
    this.idleWaiters = []
    this.outputQueue = Promise.resolve()
    this.responseQueueGeneration = 0
    this.responseStartTimeoutMs = responseStartTimeoutMs
    this.responseCompletionTimeoutMs = responseCompletionTimeoutMs
  }

  connect() {
    const apiKey = this.provider.apiKey()
    if (!apiKey) return Promise.reject(new Error(this.provider.missingKeyMessage))
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.provider.url(), {
        headers: this.provider.headers(apiKey),
      })
      this.ws = ws
      let settled = false
      const timeout = setTimeout(() => {
        const error = new Error(this.provider.connectTimeoutMessage)
        finish(error)
        ws.terminate()
      }, 25000)
      const finish = error => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        if (error) reject(error)
        else resolve()
      }
      ws.on('error', error => {
        this.onError?.(error)
        finish(error)
      })
      ws.on('close', () => {
        this.ready = false
        this.sessionConfigured = false
        this.resetResponses()
        finish(new Error(`${this.provider.label} 连接已关闭`))
        this.onClose?.()
      })
      ws.on('message', raw => {
        let event
        try {
          event = JSON.parse(raw.toString())
        } catch {
          return
        }
        if (event.type === 'session.created') this.updateSession()
        if (event.type === 'session.updated') {
          this.ready = true
          this.sessionConfigured = true
          finish()
        }
        this.handleLifecycle(event)
        this.onEvent?.(event)
      })
    })
  }

  updateSession() {
    const session = this.provider.buildSession({
      configured: this.sessionConfigured,
      agentContext: this.agentContext,
    })
    this.send({ type: 'session.update', session })
  }

  updateAgentContext(patch = {}) {
    this.agentContext = { ...this.agentContext, ...patch }
    if (!this.ready) return
    const refresh = async () => {
      await this.whenIdle()
      if (this.ready) this.updateSession()
    }
    this.outputQueue = this.outputQueue.then(refresh, refresh)
  }

  appendAudio(audio) {
    this.send({ type: 'input_audio_buffer.append', audio })
  }

  sendUserText(text, context = {}, { modalities } = {}) {
    const content = String(text || '').trim()
    if (!content) return Promise.resolve()
    return this.enqueueResponse('model', context, async () => {
      await this.createConversationItem({
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: content }],
      })
      this.send({
        type: 'response.create',
        ...(modalities ? { response: { modalities } } : {}),
      })
    })
  }

  ensureResponse(context = {}, { shouldCreate } = {}) {
    return this.enqueueResponse('agent', context, () => {
      if (shouldCreate && !shouldCreate()) return false
      this.send({ type: 'response.create' })
    })
  }

  sendFunctionOutput(callId, output, context = {}, {
    createResponse = true,
    response,
  } = {}) {
    const sendOutput = () => this.createConversationItem({
      type: 'function_call_output',
      call_id: callId,
      output: JSON.stringify(output),
    })
    if (!createResponse) return this.enqueueAction(sendOutput)
    return this.enqueueResponse('agent', context, async () => {
      await sendOutput()
      this.send({
        type: 'response.create',
        ...(response ? { response } : {}),
      })
    })
  }

  createConversationItem(item) {
    const id = item.id || `item_${randomUUID().replaceAll('-', '')}`
    return new Promise((resolve, reject) => {
      const waiter = {
        id,
        resolve,
        reject,
        timer: setTimeout(() => {
          if (this.conversationItemWaiters.get(id) !== waiter) return
          this.conversationItemWaiters.delete(id)
          reject(new Error(`Qwen 未确认对话项 ${id}`))
        }, this.responseStartTimeoutMs),
      }
      this.conversationItemWaiters.set(id, waiter)
      this.send({
        type: 'conversation.item.create',
        item: { id, ...item },
      })
    })
  }

  speak(text, origin = 'agent', context = {}, {
    shouldSpeak,
  } = {}) {
    const content = String(text || '').trim()
    if (!content) return Promise.resolve()
    return this.enqueueResponse(origin, context, () => {
      if (shouldSpeak && !shouldSpeak()) return false
      this.send({
        type: 'response.create',
        response: this.provider.buildSpeakResponse(content, {
          textOnly: this.agentContext.textOnly === true,
        }),
      })
    })
  }

  async injectResult(
    text,
    origin = 'announcement',
    context = {},
    { injectContext = true } = {},
  ) {
    const content = String(text || '').trim()
    if (!content) return
    const injection = this.provider.buildResultInjection(content, {
      textOnly: this.agentContext.textOnly === true,
    })
    let contextInjected = false
    const outcome = await this.enqueueResponse(origin, context, async () => {
      if (injectContext) {
        await this.createConversationItem(injection.item)
        contextInjected = true
      }
      this.send({
        type: 'response.create',
        response: injection.response,
      })
    })
    return {
      ...(outcome || {}),
      contextInjected,
    }
  }

  async injectPermission(permission, context = {}, {
    shouldSpeak,
  } = {}) {
    if (!permission?.id || !permission?.summary) return
    const injection = this.provider.buildPermissionInjection(permission, {
      textOnly: this.agentContext.textOnly === true,
    })
    // Make the permission identity available to the model immediately. The
    // spoken question may wait behind an active response, while the user can
    // already see the actionable permission event in TUI/WebUI and answer it.
    await this.createConversationItem(injection.item)
    return this.enqueueResponse('permission', context, pending => {
      if (pending.settled || (shouldSpeak && !shouldSpeak())) return false
      this.send({
        type: 'response.create',
        response: injection.response,
      })
    })
  }

  cancel() {
    this.responseQueueGeneration += 1
    const hasResponse = this.activeResponses.size || this.pendingResponses.length
    this.pendingResponses.forEach(item => {
      this.settlePending(item, { cancelled: true, phase: 'start' })
    })
    this.pendingResponses = []
    this.rejectConversationItemWaiters(new Error('Realtime 请求已取消'))
    if (hasResponse) this.send({ type: 'response.cancel' })
  }

  cancelResponses(predicate) {
    const matches = pending => {
      try {
        return predicate?.(pending.context, pending.origin) === true
      } catch {
        return false
      }
    }
    const retained = []
    for (const pending of this.pendingResponses) {
      if (!matches(pending)) {
        retained.push(pending)
        continue
      }
      this.settlePending(pending, { cancelled: true, phase: 'start' })
    }
    this.pendingResponses = retained
    let cancelledActive = false
    for (const pending of this.responseWaiters.values()) {
      if (!matches(pending)) continue
      cancelledActive = true
      this.settlePending(pending, {
        cancelled: true,
        phase: 'completion',
      })
    }
    if (cancelledActive) this.send({ type: 'response.cancel' })
    return cancelledActive
  }

  enqueueAction(action) {
    const generation = this.responseQueueGeneration
    const run = async () => {
      await this.whenIdle()
      if (!this.ready || generation !== this.responseQueueGeneration) return
      await action()
    }
    this.outputQueue = this.outputQueue.then(run, run)
    return this.outputQueue
  }

  enqueueResponse(origin, context, create) {
    const generation = this.responseQueueGeneration
    const run = async () => {
      await this.whenIdle()
      if (!this.ready || generation !== this.responseQueueGeneration) return
      let resolveOutcome
      const outcome = new Promise(resolve => {
        resolveOutcome = resolve
      })
      const pending = {
        origin,
        context,
        resolve: resolveOutcome,
        settled: false,
        timer: null,
      }
      if (this.pendingResponses.length) {
        const error = new Error(
          'Realtime 响应关联冲突：已有响应正在等待 response.created',
        )
        this.settlePending(pending, {
          failed: true,
          phase: 'correlation',
          error: error.message,
        })
        this.onError?.(error)
        return outcome
      }
      this.pendingResponses.push(pending)
      try {
        const created = await create(pending)
        if (created === false) {
          const index = this.pendingResponses.indexOf(pending)
          if (index >= 0) this.pendingResponses.splice(index, 1)
          this.settlePending(pending, {
            skipped: true,
            phase: 'deduplicated',
          })
          return outcome
        }
      } catch (error) {
        const index = this.pendingResponses.indexOf(pending)
        if (index >= 0) this.pendingResponses.splice(index, 1)
        this.settlePending(pending, {
          failed: true,
          phase: 'input',
          error: error.message,
        })
        if (!error.realtimeEvent) this.onError?.(error)
        return outcome
      }
      if (!pending.settled) {
        pending.timer = setTimeout(() => {
          const index = this.pendingResponses.indexOf(pending)
          if (index >= 0) this.pendingResponses.splice(index, 1)
          this.settlePending(pending, { timedOut: true, phase: 'start' })
        }, this.responseStartTimeoutMs)
      }
      return outcome
    }
    this.outputQueue = this.outputQueue.then(run, run)
    return this.outputQueue
  }

  handleLifecycle(event) {
    if (event.type === 'conversation.item.created') {
      const id = event.item?.id
      const waiter = this.conversationItemWaiters.get(id)
      if (waiter) {
        clearTimeout(waiter.timer)
        this.conversationItemWaiters.delete(id)
        waiter.resolve(event.item)
      }
    }
    if (event.type === 'error' && this.conversationItemWaiters.size) {
      const waiter = this.conversationItemWaiters.values().next().value
      clearTimeout(waiter.timer)
      this.conversationItemWaiters.delete(waiter.id)
      const error = new Error(event.error?.message || 'Qwen 创建对话项失败')
      error.realtimeEvent = true
      waiter.reject(error)
      return
    }
    if (event.type === 'response.created') {
      const id = responseId(event)
      const pending = this.pendingResponses.shift()
      clearTimeout(pending?.timer)
      event.__voiceOrigin = pending?.origin || 'model'
      event.__voiceContext = pending?.context || {}
      if (id) {
        this.activeResponses.add(id)
        if (pending) {
          pending.timer = setTimeout(() => {
            if (this.responseWaiters.get(id) !== pending) return
            this.send({ type: 'response.cancel' })
            this.settlePending(pending, {
              timedOut: true,
              phase: 'completion',
              responseId: id,
            })
            const recoveryTimer = setTimeout(() => {
              if (this.responseWaiters.get(id) !== pending) return
              this.responseWaiters.delete(id)
              this.activeResponses.delete(id)
              this.resolveIdle()
            }, 1000)
            recoveryTimer.unref?.()
          }, this.responseCompletionTimeoutMs)
          this.responseWaiters.set(id, pending)
        }
      }
    }
    if (event.type === 'response.done' || event.type === 'error') {
      let id = responseId(event)
      let pending = this.responseWaiters.get(id)
      if (event.type === 'error' && !pending && !id && this.pendingResponses.length) {
        pending = this.pendingResponses.shift()
      }
      if (event.type === 'error' && !pending && this.responseWaiters.size === 1) {
        const first = this.responseWaiters.entries().next().value
        id = first[0]
        pending = first[1]
      }
      event.__voiceOrigin = pending?.origin || event.__voiceOrigin
      event.__voiceContext = pending?.context || event.__voiceContext || {}
      if (id) {
        this.activeResponses.delete(id)
        this.responseWaiters.delete(id)
      }
      const status = event.response?.status
      const completed = event.type === 'response.done'
        && !['failed', 'cancelled', 'incomplete'].includes(status)
      this.settlePending(pending, completed
        ? { completed: true, responseId: id }
        : { failed: true, responseId: id, status })
      this.resolveIdle()
    }
  }

  settlePending(pending, outcome) {
    if (!pending || pending.settled) return
    pending.settled = true
    clearTimeout(pending.timer)
    pending.resolve(outcome)
  }

  whenIdle() {
    if (!this.activeResponses.size) return Promise.resolve()
    return new Promise(resolve => this.idleWaiters.push(resolve))
  }

  resolveIdle() {
    if (this.activeResponses.size) return
    while (this.idleWaiters.length) this.idleWaiters.shift()?.()
  }

  resetResponses() {
    this.responseQueueGeneration += 1
    this.activeResponses.clear()
    this.rejectConversationItemWaiters(new Error('Realtime 会话已重置'))
    this.pendingResponses.forEach(item => this.settlePending(item, { cancelled: true }))
    this.responseWaiters.forEach(item => this.settlePending(item, { cancelled: true }))
    this.pendingResponses = []
    this.responseWaiters.clear()
    this.resolveIdle()
  }

  rejectConversationItemWaiters(error) {
    this.conversationItemWaiters.forEach(waiter => {
      clearTimeout(waiter.timer)
      waiter.reject(error)
    })
    this.conversationItemWaiters.clear()
  }

  close() {
    this.ws?.close()
    this.ws = null
    this.ready = false
    this.resetResponses()
  }

  send(payload) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        event_id: eventId(),
        ...payload,
      }))
    }
  }
}

export function createRealtimeFrontend(options = {}) {
  return new RealtimeFrontend({ ...options, provider: resolveRealtimeProvider() })
}
