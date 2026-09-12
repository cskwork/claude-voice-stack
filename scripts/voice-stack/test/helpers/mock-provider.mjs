import { createServer } from 'node:http'

export const MOCK_KEY = 'test-key-abcdefgh12345678'

function sse(res, payloads) {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  for (const payload of payloads) res.write(`data: ${JSON.stringify(payload)}\n\n`)
  res.write('data: [DONE]\n\n')
  res.end()
}

export function toolCallStream(name, args) {
  const json = JSON.stringify(args)
  const half = Math.ceil(json.length / 2)
  return [
    { choices: [{ delta: { role: 'assistant', content: '' } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name, arguments: json.slice(0, half) } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: json.slice(half) } }] } }] },
    { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
  ]
}

export function textStream(text) {
  return [...text].map(char => ({ choices: [{ delta: { content: char } }] }))
    .concat([{ choices: [{ delta: {}, finish_reason: 'stop' }] }])
}

/**
 * OpenAI-compatible Chat Completions mock that follows the foreground prompt.
 * `behaviour` knobs make it misbehave so failure paths can be exercised.
 */
export function startMockProvider(behaviour = {}) {
  const seen = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      if (!req.url.endsWith('/chat/completions')) {
        res.writeHead(404); return res.end()
      }
      const request = JSON.parse(body)
      seen.push({ auth: req.headers.authorization, url: req.url, request })
      if (req.headers.authorization !== `Bearer ${MOCK_KEY}`) {
        res.writeHead(401, { 'content-type': 'application/json' })
        return res.end(JSON.stringify({ error: 'unauthorized' }))
      }
      const last = request.messages.at(-1)
      const lastText = typeof last.content === 'string'
        ? last.content
        : (last.content || []).map(part => part.text || '').join(' ')
      const hasTools = Array.isArray(request.tools) && request.tools.length > 0
      if (!request.stream) {
        res.writeHead(200, { 'content-type': 'application/json' })
        return res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: behaviour.basicReply ?? 'OK' } }] }))
      }
      if (!hasTools) return sse(res, textStream('one, two, three, four, five'))
      if (/Cancel the active task/i.test(lastText)) {
        return sse(res, behaviour.cancelStartsTask
          ? toolCallStream('spawn_thinking', { objective: 'Goal: cancel. Mode: inspect.' })
          : toolCallStream('cancel_agent_task', { task_id: 'task_42' }))
      }
      if (/do not edit anything/i.test(lastText)) {
        return sse(res, toolCallStream('spawn_thinking', {
          objective: behaviour.dropConstraint
            ? 'Goal: inspect the bug.'
            : 'Goal: inspect the bug. Mode: inspect. Constraints: do not edit.',
        }))
      }
      if (/inspect/i.test(lastText)) {
        const chunks = toolCallStream('spawn_thinking', {
          objective: `Goal: ${lastText.trim()} Mode: inspect. Constraints: do not edit.`,
        })
        if (behaviour.fakeCompletion) chunks.unshift({ choices: [{ delta: { content: 'I fixed the tests. ' } }] })
        return sse(res, chunks)
      }
      return sse(res, textStream(behaviour.textReply ?? 'Two operations touching shared state in the wrong order.'))
    })
  })
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    seen,
    close: () => new Promise(done => server.close(done)),
  })))
}
