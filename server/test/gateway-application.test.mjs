import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import { createGatewayApplication } from '../src/app/gateway-application.mjs'
import { config } from '../src/core/config.mjs'

test('constructs an injectable Gateway without binding a port on import', async () => {
  const application = createGatewayApplication({
    config: { ...config, port: 0 },
    parentPort: null,
    autoStart: false,
  })
  assert.equal(application.server.listening, false)
  assert.equal(application.services.taskManager != null, true)
  assert.equal(application.services.coordinator != null, true)

  application.start()
  if (!application.server.listening) {
    await once(application.server, 'listening')
  }
  assert.equal(application.server.listening, true)
  await application.close()
})
