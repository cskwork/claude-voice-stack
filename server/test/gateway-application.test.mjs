import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import { createGatewayApplication } from '../src/app/gateway-application.mjs'
import { config } from '../src/core/config.mjs'
import { createQwenRealtimeProvider } from '../src/voice/providers/dashscope.mjs'
import { createRealtimeProviderRegistry } from '../src/voice/providers/provider-registry.mjs'

test('constructs an injectable Gateway without binding a port on import', async () => {
  const inputAssets = { kind: 'test-input-assets' }
  const privateProvider = createQwenRealtimeProvider({
    key: 'private-realtime',
    visibility: 'gateway-only',
    isConfigured: () => true,
  })
  const realtimeProviderRegistry = createRealtimeProviderRegistry({
    providers: [privateProvider],
  })
  const application = createGatewayApplication({
    config: { ...config, port: 0 },
    parentPort: null,
    autoStart: false,
    inputAssets,
    realtimeProviderRegistry,
    realtimeProvider: privateProvider.key,
  })
  assert.equal(application.server.listening, false)
  assert.equal(application.services.taskManager != null, true)
  assert.equal(application.services.coordinator != null, true)
  assert.equal(application.services.inputAssets, inputAssets)

  application.start()
  if (!application.server.listening) {
    await once(application.server, 'listening')
  }
  assert.equal(application.server.listening, true)
  const address = application.server.address()
  const health = await fetch(`http://127.0.0.1:${address.port}/api/health`)
    .then(response => response.json())
  assert.equal(health.realtimeProvider, privateProvider.key)
  assert.equal(
    health.realtimeProviders.some(provider => provider.key === privateProvider.key),
    false,
  )
  await application.close()
})
