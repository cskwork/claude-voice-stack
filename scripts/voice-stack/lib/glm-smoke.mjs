import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { agentTaskToolEntries } from '../../../server/src/frontend/tools/features/agent-task-tools.mjs'
import { extractConstraints } from './objective.mjs'
import { repoRoot } from './paths.mjs'

const PROMPT_PATH = resolve(repoRoot, 'config/prompts/foreground-glm/PROMPT.md')

export function foregroundPrompt() {
  return readFileSync(PROMPT_PATH, 'utf8').trim()
}

// The real Gateway tools, in Chat Completions shape. GLM is tested against the
// same schema the Gateway sends, not a stand-in.
export function routerTools() {
  return agentTaskToolEntries
    .map(entry => entry.definition)
    .filter(tool => ['spawn_thinking', 'cancel_agent_task', 'get_agent_task_status']
      .includes(tool.function.name))
}

function withTimeout(ms) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return { signal: controller.signal, clear: () => clearTimeout(timer) }
}

async function chatRequest({ baseUrl, apiKey, fetchImpl, timeoutMs }, body) {
  const { signal, clear } = withTimeout(timeoutMs)
  try {
    const response = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    })
    return response
  } finally {
    clear()
  }
}

async function readSse(response) {
  const chunks = []
  let sawDone = false
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let index
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') { sawDone = true; continue }
      try { chunks.push(JSON.parse(data)) } catch { chunks.push({ malformed: data }) }
    }
  }
  return { chunks, sawDone }
}

function assembleStream(chunks) {
  let content = ''
  const toolCalls = new Map()
  let finishReason = null
  for (const chunk of chunks) {
    const choice = chunk.choices?.[0]
    if (!choice) continue
    if (choice.finish_reason) finishReason = choice.finish_reason
    const delta = choice.delta || {}
    if (typeof delta.content === 'string') content += delta.content
    for (const call of delta.tool_calls || []) {
      const key = call.index ?? 0
      const current = toolCalls.get(key) || { name: '', arguments: '' }
      if (call.function?.name) current.name += call.function.name
      if (call.function?.arguments) current.arguments += call.function.arguments
      toolCalls.set(key, current)
    }
  }
  return { content, toolCalls: [...toolCalls.values()], finishReason }
}

function assembleMessage(message) {
  return {
    content: typeof message?.content === 'string' ? message.content : '',
    toolCalls: (message?.tool_calls || []).map(call => ({
      name: call.function?.name || '',
      arguments: call.function?.arguments || '',
    })),
  }
}

const COMPLETION_CLAIM = /\b(fixed|completed|done|finished|found the (cause|issue|bug|problem)|tests? (now )?pass)/i

/**
 * Run the GLM compatibility gate (PRD §25). Returns one entry per check; each
 * entry never contains the API key, so the whole result can be printed.
 */
export async function runGlmSmoke({
  baseUrl,
  apiKey,
  model,
  fetchImpl = fetch,
  timeoutMs = 30_000,
  systemPrompt = foregroundPrompt(),
  tools = routerTools(),
  checks = ['basic', 'streaming', 'tool_call', 'non_delegation', 'constraint', 'control'],
} = {}) {
  const ctx = { baseUrl: String(baseUrl || '').replace(/\/+$/, ''), apiKey, fetchImpl, timeoutMs }
  const results = []
  const run = async (id, fn) => {
    if (!checks.includes(id)) return
    const started = Date.now()
    try {
      const outcome = await fn()
      results.push({ id, ok: outcome.ok, detail: outcome.detail, latencyMs: Date.now() - started })
    } catch (error) {
      results.push({ id, ok: false, detail: error.name === 'AbortError' ? 'timeout' : error.message, latencyMs: Date.now() - started })
    }
  }
  const httpFailure = async response => `HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`

  const streamedTurn = async (messages, { toolChoice = 'auto' } = {}) => {
    const response = await chatRequest(ctx, {
      model,
      stream: true,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      tools,
      tool_choice: toolChoice,
    })
    if (!response.ok) throw new Error(await httpFailure(response))
    const { chunks, sawDone } = await readSse(response)
    const malformed = chunks.filter(chunk => chunk.malformed).length
    return { ...assembleStream(chunks), chunkCount: chunks.length, sawDone, malformed }
  }

  await run('basic', async () => {
    const response = await chatRequest(ctx, {
      model,
      stream: false,
      messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
    })
    if (!response.ok) return { ok: false, detail: await httpFailure(response) }
    const body = await response.json()
    const { content } = assembleMessage(body.choices?.[0]?.message)
    const normalized = content.trim().replace(/[.!"'`]/g, '')
    return { ok: normalized.toUpperCase() === 'OK', detail: `reply="${content.trim().slice(0, 40)}"` }
  })

  await run('streaming', async () => {
    const response = await chatRequest(ctx, {
      model,
      stream: true,
      messages: [{ role: 'user', content: 'Count from one to five in words, separated by commas.' }],
    })
    if (!response.ok) return { ok: false, detail: await httpFailure(response) }
    const { chunks, sawDone } = await readSse(response)
    const malformed = chunks.filter(chunk => chunk.malformed).length
    const { content } = assembleStream(chunks)
    const ok = chunks.length >= 2 && sawDone && malformed === 0 && content.trim().length > 0
    return { ok, detail: `${chunks.length} chunks, done=${sawDone}, malformed=${malformed}` }
  })

  await run('tool_call', async () => {
    const turn = await streamedTurn([
      { role: 'user', content: 'Inspect the repository and find why tests fail.' },
    ])
    const call = turn.toolCalls[0]
    if (!call) return { ok: false, detail: `no tool call; content="${turn.content.trim().slice(0, 60)}"` }
    if (call.name !== 'spawn_thinking') return { ok: false, detail: `unexpected tool ${call.name}` }
    let args
    try { args = JSON.parse(call.arguments) } catch { return { ok: false, detail: 'tool arguments are not valid JSON' } }
    if (typeof args.objective !== 'string' || !args.objective.trim()) {
      return { ok: false, detail: 'objective missing' }
    }
    if (COMPLETION_CLAIM.test(turn.content)) {
      return { ok: false, detail: 'spoke a completion claim before the backend ran' }
    }
    return { ok: true, detail: `spawn_thinking objective ${args.objective.length} chars, streamed done=${turn.sawDone}` }
  })

  await run('non_delegation', async () => {
    const turn = await streamedTurn([
      { role: 'user', content: 'Explain what a race condition is in one sentence.' },
      { role: 'assistant', content: 'A race condition happens when two operations touch shared state in an order the code did not intend.' },
      { role: 'user', content: 'Repeat the last sentence more briefly.' },
    ])
    if (turn.toolCalls.length) return { ok: false, detail: `unexpected tool call ${turn.toolCalls[0].name}` }
    return { ok: turn.content.trim().length > 0, detail: `reply ${turn.content.trim().length} chars, no tool call` }
  })

  await run('constraint', async () => {
    const turn = await streamedTurn([
      { role: 'user', content: 'Inspect the bug with the configured backend, but do not edit anything.' },
    ])
    const call = turn.toolCalls.find(candidate => candidate.name === 'spawn_thinking')
    if (!call) return { ok: false, detail: 'no spawn_thinking call' }
    let args
    try { args = JSON.parse(call.arguments) } catch { return { ok: false, detail: 'tool arguments are not valid JSON' } }
    const constraints = extractConstraints(args.objective)
    return {
      ok: constraints.includes('do_not_edit'),
      detail: constraints.length ? `constraints ${constraints.join(',')}` : 'objective lost the do-not-edit restriction',
    }
  })

  await run('control', async () => {
    const turn = await streamedTurn([
      {
        role: 'user',
        content: '<runtime_context>\nactive_task_id=task_42\nactive_task_status=running\nactive_task_goal=find why tests fail\n</runtime_context>\nCancel the active task.',
      },
    ])
    const names = turn.toolCalls.map(call => call.name)
    if (names.includes('spawn_thinking')) return { ok: false, detail: 'started a new task instead of cancelling' }
    if (!names.includes('cancel_agent_task')) return { ok: false, detail: `no cancel call (tools: ${names.join(',') || 'none'})` }
    return { ok: true, detail: 'cancel_agent_task called' }
  })

  return { ok: results.every(result => result.ok), results }
}

export function formatSmokeResults(results) {
  return results.map(result => (
    `${result.ok ? '✓' : '✗'} ${result.id.padEnd(15)} ${String(result.latencyMs).padStart(5)} ms  ${result.detail}`
  )).join('\n')
}
