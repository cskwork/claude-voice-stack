import assert from 'node:assert/strict'
import test from 'node:test'

test('PORT=0 binds a random port and reports the origin to the parent host', async () => {
  const originalPort = process.env.PORT
  const originalApiKey = process.env.DASHSCOPE_API_KEY
  const originalRealtimeUrl = process.env.QWEN_AUDIO_REALTIME_BASE_URL
  const originalModel = process.env.QWEN_AUDIO_REALTIME_MODEL
  process.env.PORT = '0'
  process.env.DASHSCOPE_API_KEY = 'health-secret-api-key'
  process.env.QWEN_AUDIO_REALTIME_BASE_URL = (
    'wss://gateway.example/realtime?token=health-secret-signed-token'
  )
  process.env.QWEN_AUDIO_REALTIME_MODEL = (
    'qwen3.5-omni-flash-realtime-2026-03-15'
  )
  const reported = new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      rejectPromise(new Error('gateway did not report readiness'))
    }, 5000)
    process.parentPort = {
      postMessage: message => {
        clearTimeout(timer)
        resolvePromise(message)
      },
    }
  })
  let server
  try {
    const configModule = await import('../src/core/config.mjs')
    assert.equal(configModule.config.port, 0)
    const bootstrap = await import('../src/app/bootstrap.mjs')
    server = bootstrap.server
    const message = await reported
    assert.equal(message.type, 'qwen-audio-agent:gateway-ready')
    const address = server.address()
    assert.equal(typeof address, 'object')
    assert.ok(address.port > 0)
    assert.equal(message.origin, `http://127.0.0.1:${address.port}`)

    const response = await fetch(`${message.origin}/api/health`)
    const health = await response.json()
    assert.equal(
      health.realtimeModelProfile.id,
      'qwen3.5-omni-flash-realtime-2026-03-15',
    )
    assert.equal(health.realtimeModelProfile.family, 'omni')
    assert.equal(health.realtimeModelProfile.modelCapabilities.imageInput, true)
    assert.equal(health.realtimeModelProfile.transportCapabilities.imageInput, false)
    assert.deepEqual(
      health.realtimeModelCatalog.map(profile => profile.id),
      [
        'qwen3.5-omni-flash-realtime-2026-03-15',
        'qwen3.5-omni-plus-realtime-2026-03-15',
        'qwen-audio-3.0-realtime-plus',
      ],
    )
    for (const profile of health.realtimeModelCatalog) {
      assert.deepEqual(Object.keys(profile).sort(), [
        'family',
        'id',
        'label',
        'modelCapabilities',
        'sessionDefaults',
        'transportCapabilities',
      ])
    }
    const serialized = JSON.stringify(health)
    assert.doesNotMatch(serialized, /health-secret-api-key/)
    assert.doesNotMatch(serialized, /health-secret-signed-token/)
    assert.doesNotMatch(serialized, /gateway\.example/)
  } finally {
    delete process.parentPort
    if (originalPort === undefined) delete process.env.PORT
    else process.env.PORT = originalPort
    if (originalApiKey === undefined) delete process.env.DASHSCOPE_API_KEY
    else process.env.DASHSCOPE_API_KEY = originalApiKey
    if (originalRealtimeUrl === undefined) {
      delete process.env.QWEN_AUDIO_REALTIME_BASE_URL
    } else {
      process.env.QWEN_AUDIO_REALTIME_BASE_URL = originalRealtimeUrl
    }
    if (originalModel === undefined) delete process.env.QWEN_AUDIO_REALTIME_MODEL
    else process.env.QWEN_AUDIO_REALTIME_MODEL = originalModel
    if (server) {
      await new Promise(resolvePromise => server.close(resolvePromise))
    }
  }
})
