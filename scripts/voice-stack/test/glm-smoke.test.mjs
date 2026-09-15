import assert from 'node:assert/strict'
import test from 'node:test'
import { formatSmokeResults, routerTools, runGlmSmoke } from '../lib/glm-smoke.mjs'

import { MOCK_KEY as KEY, startMockProvider } from './helpers/mock-provider.mjs'

test('routerTools exposes the real Gateway delegation and control tools', () => {
  assert.deepEqual(routerTools().map(tool => tool.function.name), ['spawn_thinking', 'cancel_agent_task', 'get_agent_task_status'])
  assert.equal(routerTools()[0].function.parameters.required[0], 'objective')
})

test('gate passes against a cooperative provider and never leaks the key', async t => {
  const provider = await startMockProvider()
  t.after(provider.close)
  const smoke = await runGlmSmoke({ baseUrl: provider.baseUrl, apiKey: KEY, model: 'glm-5.3-flash' })
  const printed = formatSmokeResults(smoke.results)
  assert.equal(smoke.ok, true, printed)
  assert.deepEqual(smoke.results.map(result => result.id), ['basic', 'streaming', 'tool_call', 'non_delegation', 'constraint', 'control'])
  assert.ok(!printed.includes(KEY))
  assert.ok(!JSON.stringify(smoke).includes(KEY))
  assert.ok(provider.seen.every(entry => entry.url === '/v1/chat/completions'))
  const toolRequest = provider.seen.find(entry => entry.request.tools)
  assert.equal(toolRequest.request.messages[0].role, 'system')
  assert.match(toolRequest.request.messages[0].content, /configured backend agent/)
  assert.equal(toolRequest.request.tools[0].function.name, 'spawn_thinking')
})

test('gate fails when the provider fakes completion, drops constraints, or starts a task on cancel', async t => {
  const provider = await startMockProvider({ fakeCompletion: true, dropConstraint: true, cancelStartsTask: true, basicReply: 'Sure!' })
  t.after(provider.close)
  const smoke = await runGlmSmoke({ baseUrl: provider.baseUrl, apiKey: KEY, model: 'm' })
  const byId = Object.fromEntries(smoke.results.map(result => [result.id, result]))
  assert.equal(smoke.ok, false)
  assert.equal(byId.basic.ok, false)
  assert.equal(byId.streaming.ok, true)
  assert.match(byId.tool_call.detail, /completion claim/)
  assert.match(byId.constraint.detail, /lost the do-not-edit/)
  assert.match(byId.control.detail, /started a new task/)
})

test('gate reports auth failures without throwing', async t => {
  const provider = await startMockProvider()
  t.after(provider.close)
  const smoke = await runGlmSmoke({ baseUrl: provider.baseUrl, apiKey: 'wrong', model: 'm', checks: ['basic', 'tool_call'] })
  assert.equal(smoke.ok, false)
  assert.match(smoke.results[0].detail, /HTTP 401/)
  assert.match(smoke.results[1].detail, /HTTP 401/)
})

test('gate reports unreachable endpoints as failures', async () => {
  const smoke = await runGlmSmoke({ baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'k', model: 'm', checks: ['basic'], timeoutMs: 2000 })
  assert.equal(smoke.ok, false)
  assert.ok(smoke.results[0].detail.length > 0)
})
