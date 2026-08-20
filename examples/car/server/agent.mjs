import OpenAI from 'openai'
import { config } from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { tools, executors } from './tools/index.mjs'
import { builtinSkillCatalog } from './skills/builtin/index.mjs'
import { getMemoryForPrompt } from './memory.mjs'
import { loadHistory, appendToHistory, buildMessages, compactHistory } from './context.mjs'
import { loadCustomSkillCatalog } from './tools/skill-manage.mjs'
import { getSoulPrompt } from './souls.mjs'
import { buildCurrentTimePrompt } from './time-context.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../.env.local') })

const client = new OpenAI({
  apiKey: process.env.DASHSCOPE_API_KEY,
  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
})
const model = process.env.DASHSCOPE_MODEL || 'qwen3.6-plus'

const MAX_ROUNDS = 12
const DEFAULT_AGENT_TOTAL_TIMEOUT_MS = 45000
const DEFAULT_LLM_TIMEOUT_MS = 22000
const DEFAULT_TOOL_TIMEOUT_MS = 15000

function timeoutError(label, timeoutMs) {
  const err = new Error(`${label}超时（${Math.round(timeoutMs / 1000)}秒）`)
  err.code = 'ETIMEDOUT'
  return err
}

function remainingTimeout(deadline, limitMs) {
  return Math.max(1, Math.min(limitMs, deadline - Date.now()))
}

function assertNotTimedOut(deadline, label = '服务端 LLM') {
  if (Date.now() >= deadline) throw timeoutError(label, 0)
}

function withTimeout(promise, timeoutMs, label) {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(timeoutError(label, timeoutMs)), timeoutMs)
    }),
  ]).finally(() => clearTimeout(timer))
}

function agentTimeoutOptions(options = {}) {
  return {
    totalTimeoutMs: options.totalTimeoutMs ?? DEFAULT_AGENT_TOTAL_TIMEOUT_MS,
    llmTimeoutMs: options.llmTimeoutMs ?? DEFAULT_LLM_TIMEOUT_MS,
    toolTimeoutMs: options.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS,
  }
}

function toolChoiceFor(skillName) {
  if (!skillName || !executors[skillName]) return undefined
  return { type: 'function', function: { name: skillName } }
}

function normalizeTriggerText(value) {
  return String(value || '').replace(/\s+/g, '').replace(/[，,。.!！？?：“”"'「」『』（）()【】\[\]]/g, '').toLowerCase()
}

async function inferRequiredCustomSkillForMessage(userMessage, clientId) {
  const text = normalizeTriggerText(userMessage)
  if (!text) return null

  const customSkills = await loadCustomSkillCatalog(clientId)
  const matched = customSkills.some((skill) => {
    const name = normalizeTriggerText(skill.name)
    const description = normalizeTriggerText(skill.description)
    return (name && text.includes(name)) || (description && description.includes(text))
  })

  return matched ? 'skill_run' : null
}

function collectResultActions(result) {
  const actions = []
  if (Array.isArray(result?.actions)) actions.push(...result.actions)
  if (result?.action) actions.push(result.action)
  return actions
}

async function buildSystemPrompt(soul, clientId = 'default') {
  const memoryText = await getMemoryForPrompt(clientId)
  const customSkills = await loadCustomSkillCatalog(clientId)
  const soulPrompt = getSoulPrompt(soul)
  const currentTimePrompt = buildCurrentTimePrompt()

  let prompt = `${soulPrompt}

${currentTimePrompt}

你能帮助用户控制车辆、导航、播放音乐、设置提醒等。

你的行为准则：
- 执行操作前确认关键参数，但不要过度确认简单请求
- 一次可以执行多个操作来完成复合任务
- 如果用户的请求需要多步操作，按顺序依次执行

## 最高优先级规则（必须严格遵守，违反即为严重错误）

你是一个执行者，不是描述者。所有操作必须通过调用工具完成，禁止用文字假装完成了操作。

你当前可以直接调用的“内置技能”（Built-in Skills）如下，它们会在内部调用底层 Atomic Tools：
${builtinSkillCatalog.map((s) => `- ${s.toolName}（${s.name}）：${s.description}${s.atomicTools.length ? `；Atomic Tools: ${s.atomicTools.join(', ')}` : ''}`).join('\n')}

车控请求的唯一正确流程：
- 用户表达任何车窗、天窗、大灯、空调、温度、风量、制冷/制热相关意图 → 必须调用 vehicle_control
- vehicle_control 会在内部先查询车况，再调用车控 Atomic Tools 执行变更
- 禁止直接用文字描述车控行为而不调用 vehicle_control

错误示例（绝对禁止）：
- 用户说"打开车窗"→ 你直接回复"已打开车窗" ← 严重错误！没有调用任何工具
- 用户说"打开车窗"→ 你直接回复"已打开" ← 严重错误！缺少 vehicle_control 调用

正确示例：
- 用户说"打开车窗"→ 调用 vehicle_control(action=open, part=windows) → 回复"已为您打开所有车窗"

音乐播放的唯一正确流程：
- 用户说"我要听歌"、"放首歌"、"播放音乐"等任何音乐意图 → 必须调用 music 技能（action=play）
- 用户说"暂停"、"停止播放" → 必须调用 music 技能（action=pause）
- 用户说"下一首"、"切歌" → 必须调用 music 技能（action=next）
- 用户说"上一首" → 必须调用 music 技能（action=prev）
- 禁止用文字描述播放行为而不调用技能。"正在为您播放..."这种回复如果没有先调用 music 就是严重错误

导航的唯一正确流程：
- 用户表达任何导航、去某地、找路、路线相关意图 → 必须调用 navigation 技能
- 导航是最高优先级任务，应立即响应，不要反复确认

淘宝闪购的唯一正确流程：
- 用户表达任何外卖、奶茶、咖啡、点餐、淘宝闪购、下单相关意图 → 必须调用 flashbuy 技能
- flashbuy 会在内部处理商品搜索、加购、试算订单、确认下单
- 禁止用文字描述“已帮你点了/正在下单”而不调用 flashbuy
- 用户只说“看看/搜一下/有哪些”时，调用 flashbuy(action=search)
- 用户说“帮我点/来一杯/点杯/想喝/想吃”时，优先调用 flashbuy(action=add_to_cart)，让 Skill 搜索、选择候选、加入购物车并给出订单预览，然后询问是否确认下单
- 只有已经给用户播报或展示过订单预览后，用户再次明确说“确认”“下单”“买”“就这个”“可以”等确认意图时，才调用 flashbuy(action=confirm_order, confirmed=true)
- 如果当前还没有订单预览，用户说“确认”“下单吧”时，禁止直接 confirm_order；应先调用 flashbuy(action=add_to_cart 或 preview_order) 生成预览，再询问确认
- 下单前必须让用户听到或看到商品、价格、送达位置和预计送达时间

天气查询的唯一正确流程：
- 用户表达任何天气、气温、下雨、带伞、穿衣、冷不冷、热不热、风力相关意图 → 必须调用 weather 技能
- 用户未指定城市时，默认查询杭州/当前车辆所在城市天气
- 禁止直接凭常识或静态状态栏内容回答天气

联网查询的唯一正确流程：
- 用户表达任何联网、网上查、搜索、最新、最近、新闻、政策、公告、活动、价格、股价、汇率、油价、金价、比赛、赛事、限行、实时信息相关意图 → 必须调用 web_search 技能
- web_search 用于通用实时信息查询；天气优先使用 weather，导航优先使用 navigation，车控优先使用 vehicle_control，闪购优先使用 flashbuy
- 回答联网查询时要简洁，尽量说明信息来源；禁止凭训练知识回答强时效问题

【记忆规则】
- 当用户透露个人信息（姓名、昵称、喜好、习惯、职业等）时，必须调用 memory_write 工具记录
- 当用户表达偏好（喜欢/不喜欢某事物、希望如何称呼等）时，必须调用 memory_write 工具记录
- 当用户表达长期目标、梦想、愿望、理想或“想成为...”时，必须调用 memory_write 工具记录
- 当用户设定互动规则（如"当我说X你要回答Y"、"每次...你就..."）时，必须调用 memory_write 工具记录
- 任何用户希望你"记住"或"以后要"的内容，都必须调用 memory_write 工具，绝对不能仅口头回应
- 记忆内容要简洁明了，例如"用户名字叫张彬彬"、"用户说天王盖地虎时要回答小鸡炖蘑菇"
- 写入新记忆前，必须先调用 memory_read 检查是否已有相关记忆
- 如果第一轮已经调用了 memory_read，并且用户原话包含姓名、昵称、偏好、习惯、职业、住址、公司、梦想、目标、愿望、理想或希望你记住的规则，下一步必须调用 memory_write 或先 memory_delete 再 memory_write，禁止只口头说“已记住”
- 如果已有相关但过时的记忆，先用 memory_delete 删除旧记忆，再用 memory_write 写入新记忆
- memory_read 返回的每条记忆前有 [索引号]，将该索引号传给 memory_delete 即可删除

【技能创建规则】
- 当用户明确说"帮我创建一个技能"或类似表述时，调用 skill_create 创建自定义技能
- 当用户描述条件触发的任务（如"每天下班后帮我..."、"到家时自动..."、"每次...就..."），主动建议为其创建自定义技能，用户确认后调用 skill_create
- skill_id 使用简短的中文名称（如"下班回家"、"午睡模式"）
- instructions 中优先使用内置技能（vehicle_control、navigation、music）编排执行步骤；只有时间、位置、记忆、提醒等基础能力才使用对应系统工具
- 当用户命中可用自定义技能的名称或描述里的触发条件时，必须先调用 skill_run 加载完整指令，再根据指令执行或回复，禁止只凭技能摘要直接回答

`
  if (memoryText) {
    prompt += memoryText + '\n\n'
  }

  if (customSkills.length > 0) {
    prompt += '【可用的自定义技能】（调用 skill_run 加载详情）\n'
    customSkills.forEach((s) => {
      prompt += `- ${s.name}: ${s.description}\n`
    })
    prompt += '\n'
  }

  return prompt
}

export async function chat(userMessage, sessionId = 'default', vehicleState = {}, soul = '聊愈师', strategy = 0, thinking = true, clientId = 'default', options = {}) {
  const startTime = Date.now()
  const timeouts = agentTimeoutOptions(options)
  const deadline = startTime + timeouts.totalTimeoutMs
  const history = await loadHistory(sessionId)
  const systemPrompt = await buildSystemPrompt(soul, clientId)

  const trimmedHistory = buildMessages(history)
  const messages = [
    { role: 'system', content: systemPrompt },
    ...trimmedHistory,
    { role: 'user', content: userMessage },
  ]

  const actions = []
  const requiredSkill = await inferRequiredCustomSkillForMessage(userMessage, clientId)
  const debug = {
    rounds: 0,
    model,
    duration_ms: 0,
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    tool_calls: [],
    thinking: '',
  }
  const context = {
    vehicleState,
    strategy,
    clientId,
    compactHistory: (keepLast) => compactHistory(sessionId, keepLast),
    onProgress: (event) => {},
  }

  for (let round = 0; round < MAX_ROUNDS; round++) {
    assertNotTimedOut(deadline)
    debug.rounds = round + 1

    const reqParams = {
      model,
      messages,
      tools: tools.length > 0 ? tools : undefined,
      tool_choice: toolChoiceFor(round === 0 ? requiredSkill : null) || (tools.length > 0 ? 'auto' : undefined),
      enable_thinking: Boolean(thinking),
    }

    const llmTimeoutMs = remainingTimeout(deadline, timeouts.llmTimeoutMs)
    const completion = await client.chat.completions.create(reqParams, { timeout: llmTimeoutMs, maxRetries: 0 })

    if (completion.usage) {
      debug.usage.prompt_tokens += completion.usage.prompt_tokens || 0
      debug.usage.completion_tokens += completion.usage.completion_tokens || 0
      debug.usage.total_tokens += completion.usage.total_tokens || 0
    }

    const choice = completion.choices[0]
    const msg = choice.message

    if (msg.reasoning_content) {
      debug.thinking += msg.reasoning_content
    }

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      const content = msg.content || ''
      await appendToHistory(sessionId, { role: 'user', content: userMessage }, { role: 'assistant', content })
      debug.duration_ms = Date.now() - startTime
      return { content, actions, debug }
    }

    messages.push({
      role: 'assistant',
      content: msg.content || null,
      tool_calls: msg.tool_calls,
    })

    for (const toolCall of msg.tool_calls) {
      assertNotTimedOut(deadline, '工具执行')
      const fnName = toolCall.function.name
      const fnArgs = JSON.parse(toolCall.function.arguments || '{}')
      const executor = executors[fnName]

      const callStart = Date.now()
      let result
      if (executor) {
        try {
          result = await withTimeout(
            executor(fnArgs, context),
            remainingTimeout(deadline, timeouts.toolTimeoutMs),
            `工具 ${fnName}`,
          )
        } catch (err) {
          result = { result: `执行出错: ${err.message}` }
        }
      } else {
        result = { result: `未知工具: ${fnName}` }
      }
      const callDuration = Date.now() - callStart

      if (result.subCalls?.length) {
        for (const sub of result.subCalls) {
          debug.tool_calls.push({
            name: sub.name,
            arguments: sub.arguments,
            result: sub.result || '',
            duration_ms: sub.duration_ms,
          })
        }
      }

      debug.tool_calls.push({
        name: fnName,
        arguments: fnArgs,
        result: typeof result.result === 'string' ? result.result : JSON.stringify(result.result),
        duration_ms: callDuration,
      })

      actions.push(...collectResultActions(result))

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: typeof result.result === 'string' ? result.result : JSON.stringify(result.result),
      })
    }
  }

  await appendToHistory(
    sessionId,
    { role: 'user', content: userMessage },
    { role: 'assistant', content: '调用次数过多，请重试' },
  )
  debug.duration_ms = Date.now() - startTime
  return { content: '调用次数过多，请重试', actions, debug }
}

export async function chatStream(userMessage, sessionId = 'default', vehicleState = {}, soul = '聊愈师', strategy = 0, thinking = true, clientId = 'default', onEvent, options = {}) {
  const startTime = Date.now()
  const timeouts = agentTimeoutOptions(options)
  const deadline = startTime + timeouts.totalTimeoutMs
  let eventToken = 0
  const emit = (event, token = eventToken) => {
    if (token === eventToken && Date.now() < deadline) onEvent(event)
  }
  const history = await loadHistory(sessionId)
  const systemPrompt = await buildSystemPrompt(soul, clientId)

  const trimmedHistory = buildMessages(history)
  const messages = [
    { role: 'system', content: systemPrompt },
    ...trimmedHistory,
    { role: 'user', content: userMessage },
  ]

  const actions = []
  const requiredSkill = await inferRequiredCustomSkillForMessage(userMessage, clientId)
  const debug = {
    rounds: 0,
    model,
    duration_ms: 0,
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  }
  const context = {
    vehicleState,
    strategy,
    clientId,
    compactHistory: (keepLast) => compactHistory(sessionId, keepLast),
    onSubCall: (info) => emit({ type: 'tool_call', ...info }),
    onMapEvent: (event) => emit({ type: 'map_action', ...event }),
    onProgress: (event) => emit({ type: 'progress', ...event }),
  }

  for (let round = 0; round < MAX_ROUNDS; round++) {
    assertNotTimedOut(deadline)
    debug.rounds = round + 1

    const streamParams = {
      model,
      messages,
      tools: tools.length > 0 ? tools : undefined,
      tool_choice: toolChoiceFor(round === 0 ? requiredSkill : null) || (tools.length > 0 ? 'auto' : undefined),
      stream: true,
      stream_options: { include_usage: true },
      enable_thinking: Boolean(thinking),
    }

    const llmTimeoutMs = remainingTimeout(deadline, timeouts.llmTimeoutMs)
    const stream = await client.chat.completions.create(streamParams, { timeout: llmTimeoutMs, maxRetries: 0 })

    let finishReason = null
    let contentBuf = ''
    const toolCallBufs = {}

    await withTimeout((async () => {
      for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta
      if (chunk.choices?.[0]?.finish_reason) {
        finishReason = chunk.choices[0].finish_reason
      }
      if (chunk.usage) {
        debug.usage.prompt_tokens += chunk.usage.prompt_tokens || 0
        debug.usage.completion_tokens += chunk.usage.completion_tokens || 0
        debug.usage.total_tokens += chunk.usage.total_tokens || 0
      }
      if (!delta) continue

      if (delta.reasoning_content) {
        emit({ type: 'thinking', content: delta.reasoning_content })
      }

      if (delta.content) {
        contentBuf += delta.content
        emit({ type: 'text', content: delta.content })
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index
          if (!toolCallBufs[idx]) {
            toolCallBufs[idx] = { id: tc.id || '', name: tc.function?.name || '', arguments: '' }
          }
          if (tc.id) toolCallBufs[idx].id = tc.id
          if (tc.function?.name) toolCallBufs[idx].name = tc.function.name
          if (tc.function?.arguments) toolCallBufs[idx].arguments += tc.function.arguments
        }
      }
      }
    })(), remainingTimeout(deadline, llmTimeoutMs), '服务端 LLM 流式响应')

    const toolCalls = Object.values(toolCallBufs)

    if (toolCalls.length === 0) {
      await appendToHistory(sessionId, { role: 'user', content: userMessage }, { role: 'assistant', content: contentBuf })
      debug.duration_ms = Date.now() - startTime
      emit({ type: 'done', content: contentBuf, actions, debug })
      return
    }

    messages.push({
      role: 'assistant',
      content: contentBuf || null,
      tool_calls: toolCalls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.arguments } })),
    })

    for (const tc of toolCalls) {
      assertNotTimedOut(deadline, '工具执行')
      const fnName = tc.name
      const fnArgs = JSON.parse(tc.arguments || '{}')
      const executor = executors[fnName]
      const toolToken = ++eventToken
      const toolContext = {
        ...context,
        onSubCall: (info) => emit({ type: 'tool_call', ...info }, toolToken),
        onMapEvent: (event) => emit({ type: 'map_action', ...event }, toolToken),
        onProgress: (event) => emit({ type: 'progress', ...event }, toolToken),
      }

      const callStart = Date.now()
      let result
      if (executor) {
        try {
          result = await withTimeout(
            executor(fnArgs, toolContext),
            remainingTimeout(deadline, timeouts.toolTimeoutMs),
            `工具 ${fnName}`,
          )
        } catch (err) {
          result = { result: `执行出错: ${err.message}` }
        }
      } else {
        result = { result: `未知工具: ${fnName}` }
      }
      eventToken += 1
      const callDuration = Date.now() - callStart

      emit({
        type: 'tool_call',
        name: fnName,
        arguments: fnArgs,
        result: typeof result.result === 'string' ? result.result : JSON.stringify(result.result),
        duration_ms: callDuration,
      })

      const resultActions = collectResultActions(result)
      actions.push(...resultActions)
      for (const action of resultActions) {
        emit({ type: 'action', action })
      }

      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: typeof result.result === 'string' ? result.result : JSON.stringify(result.result),
      })
    }
  }

  debug.duration_ms = Date.now() - startTime
  emit({ type: 'done', content: '调用次数过多，请重试', actions, debug })
}
