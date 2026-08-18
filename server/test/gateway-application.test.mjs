import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'

test('constructs an injectable Gateway without binding a port on import', async () => {
  // 本测试导入真实配置与单例 Agent facade：本地 .env 若配置了后台
  // Agent，构造过程中会拉起常驻后台进程使事件循环无法退出。在动态导入
  // 前强制前端独跑模式，保持测试与环境无关。
  const originalAgentProtocol = process.env.AGENT_PROTOCOL
  process.env.AGENT_PROTOCOL = 'none'
  try {
    const { createGatewayApplication } = await import(
      '../src/app/gateway-application.mjs'
    )
    const { config } = await import('../src/core/config.mjs')
    const inputAssets = { kind: 'test-input-assets' }
    const application = createGatewayApplication({
      config: { ...config, port: 0 },
      parentPort: null,
      autoStart: false,
      inputAssets,
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
    await application.close()
  } finally {
    if (originalAgentProtocol === undefined) delete process.env.AGENT_PROTOCOL
    else process.env.AGENT_PROTOCOL = originalAgentProtocol
  }
})
