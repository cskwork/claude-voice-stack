import assert from 'node:assert/strict'
import test from 'node:test'
import { openAiCompatibleProtocol } from '../src/voice/providers/openai-compatible-protocol.mjs'
import { createQwenRealtimeProvider } from '../src/voice/providers/dashscope.mjs'
import {
  createRealtimeProviderRegistry,
  defineRealtimeProvider,
  validateRealtimeProvider,
  validateRealtimeProtocol,
} from '../src/voice/providers/provider-registry.mjs'

function testProvider(key, overrides = {}) {
  return {
    key,
    label: key,
    inputSampleRate: 16000,
    outputSampleRate: 24000,
    protocol: openAiCompatibleProtocol,
    model: () => 'test-model',
    voice: () => null,
    isConfigured: () => true,
    url: () => 'ws://127.0.0.1/realtime',
    headers: () => ({}),
    classifyError: () => 'other',
    buildSession: () => ({}),
    buildSpeakResponse: () => ({}),
    buildResultInjection: () => ({}),
    buildPermissionInjection: () => ({}),
    ...overrides,
  }
}

test('registers custom providers and resolves their aliases', () => {
  const registry = createRealtimeProviderRegistry({
    providers: [testProvider('custom-provider', { aliases: ['custom'] })],
    defaultProvider: 'custom',
  })

  assert.equal(registry.resolve().key, 'custom-provider')
  assert.equal(registry.resolve('CUSTOM').key, 'custom-provider')
  assert.throws(
    () => registry.register(testProvider('other', { aliases: ['custom'] })),
    /已注册/,
  )
})

test('defines a provider only after validating its extension contract', () => {
  const provider = testProvider('defined')
  assert.equal(defineRealtimeProvider(provider), provider)
  assert.throws(
    () => defineRealtimeProvider({ key: 'broken', label: 'Broken' }),
    /缺少 model\(\)/,
  )
})

test('creates a host-configured Qwen provider without DashScope globals', () => {
  const settings = {
    url: 'wss://private.example/realtime',
    token: 'private-token',
    model: 'qwen-audio-3.0-realtime-plus',
  }
  const provider = createQwenRealtimeProvider({
    key: 'private-qwen',
    visibility: 'gateway-only',
    model: () => settings.model,
    voice: () => 'Cherry',
    isConfigured: () => Boolean(settings.url && settings.token),
    url: () => settings.url,
    headers: () => ({ Authorization: `Bearer ${settings.token}` }),
    createProtocol: () => ({ ...openAiCompatibleProtocol }),
  })

  assert.equal(validateRealtimeProvider(provider), provider)
  assert.equal(provider.url(), settings.url)
  assert.equal(provider.model(), settings.model)
  assert.deepEqual(provider.headers(), {
    Authorization: 'Bearer private-token',
  })
  assert.equal(provider.buildSession({ configured: false }).voice, 'Cherry')
})

test('keeps gateway-only providers out of public provider discovery', () => {
  const publicProvider = testProvider('public-provider')
  const privateProvider = testProvider('private-provider', {
    visibility: 'gateway-only',
  })
  const registry = createRealtimeProviderRegistry({
    providers: [publicProvider, privateProvider],
  })

  assert.deepEqual(registry.list(), [publicProvider])
  assert.deepEqual(
    registry.list({ includeGatewayOnly: true }),
    [publicProvider, privateProvider],
  )
  assert.equal(registry.resolve('private-provider'), privateProvider)
})

test('accepts per-connection protocol factories and validates their result', () => {
  const provider = testProvider('factory-provider', {
    protocol: undefined,
    createProtocol: ({ connectionId }) => ({
      ...openAiCompatibleProtocol,
      connectionMessages: () => [{ type: 'start', connectionId }],
    }),
  })

  assert.equal(validateRealtimeProvider(provider), provider)
  const protocol = provider.createProtocol({ connectionId: 'connection_1' })
  assert.equal(validateRealtimeProtocol(protocol, provider.key), protocol)
  assert.deepEqual(protocol.connectionMessages(), [{
    type: 'start',
    connectionId: 'connection_1',
  }])
  assert.throws(
    () => validateRealtimeProtocol({ connectionMessages: [] }, provider.key),
    /encodeOutgoing/,
  )
})
