import assert from 'node:assert/strict'
import test from 'node:test'

test('PORT=0 binds a random port and reports the origin to the parent host', async () => {
  const originalPort = process.env.PORT
  process.env.PORT = '0'
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
  } finally {
    delete process.parentPort
    if (originalPort === undefined) delete process.env.PORT
    else process.env.PORT = originalPort
    if (server) {
      await new Promise(resolvePromise => server.close(resolvePromise))
    }
  }
})
