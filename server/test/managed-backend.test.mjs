import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { resolve } from 'node:path'
import test from 'node:test'
import {
  applyBackendPermissionMode,
  resolveManagedBackend,
  startManagedBackend,
} from '../src/process/managed-backend.mjs'

function childProcess() {
  const child = new EventEmitter()
  child.exitCode = null
  child.signalCode = null
  child.pid = 4242
  child.kill = signal => {
    child.signalCode = signal
  }
  return child
}

test('attaching an existing OpenClaw Gateway does not start another one', async () => {
  let spawned = false
  const env = {
    AGENT_PROTOCOL: 'openclaw',
    OPENCLAW_ATTACH_EXISTING: 'true',
    OPENCLAW_BASE_URL: 'http://127.0.0.1:18789',
  }
  assert.deepEqual(resolveManagedBackend(env), {
    protocol: 'openclaw',
    ownership: 'external',
    permissionMode: 'native',
    baseUrl: 'http://127.0.0.1:18789',
  })
  const runtime = await startManagedBackend({
    root: '/repo',
    env,
    spawnImpl: () => {
      spawned = true
    },
  })
  assert.equal(runtime.ownsProcess, false)
  assert.equal(spawned, false)
})

test('Gateway-owned backend moves away from occupied ports', async () => {
  const env = {
    AGENT_PROTOCOL: 'openclaw',
    OPENCLAW_BASE_URL: 'http://127.0.0.1:18789',
  }
  const calls = []
  const child = childProcess()
  const signals = []
  const runtime = await startManagedBackend({
    root: '/repo',
    env,
    platform: 'darwin',
    isAddressInUse: async () => true,
    findFreeAddress: async () => 'http://127.0.0.1:45678',
    spawnImpl: (...args) => {
      calls.push(args)
      return child
    },
  })
  runtime.killImpl = (pid, signal) => signals.push([pid, signal])
  assert.equal(env.OPENCLAW_BASE_URL, 'http://127.0.0.1:45678')
  assert.equal(env.OPENCLAW_PORT, '45678')
  assert.equal(calls[0][0], resolve('/repo', 'scripts/openclaw-gateway'))
  assert.equal(calls[0][2].env.QWEN_AUDIO_AGENT_ENV_LOADED, '1')
  runtime.close()
  assert.deepEqual(signals, [[-4242, 'SIGTERM']])
})

test('requires an explicit backend selection', () => {
  assert.throws(() => resolveManagedBackend({}), /必须指定后台 Agent/)
})

test('normalizes the selected backend', () => {
  assert.deepEqual(resolveManagedBackend({
    AGENT_PROTOCOL: 'opencode',
    OPENCODE_BASE_URL: 'http://localhost:4096/path',
  }), {
    protocol: 'opencode',
    ownership: 'owned',
    permissionMode: 'native',
    baseUrl: 'http://localhost:4096',
  })
})

test('Qoder is managed inside the Gateway without a separate server', async () => {
  assert.deepEqual(resolveManagedBackend({
    AGENT_PROTOCOL: 'qoder',
  }), {
    protocol: 'qoder',
    ownership: 'owned',
    permissionMode: 'native',
    baseUrl: null,
  })
  const runtime = await startManagedBackend({
    root: '/repo',
    env: { AGENT_PROTOCOL: 'qoder' },
    spawnImpl: () => {
      throw new Error('Qoder must not spawn a separate backend server')
    },
  })
  assert.equal(runtime.ownsProcess, false)
})

test('generic ACP is managed as a Gateway child without a separate server', async () => {
  assert.deepEqual(resolveManagedBackend({
    AGENT_PROTOCOL: 'acp',
  }), {
    protocol: 'acp',
    ownership: 'owned',
    permissionMode: 'native',
    baseUrl: null,
  })
  const runtime = await startManagedBackend({
    root: '/repo',
    env: {
      AGENT_PROTOCOL: 'acp',
      ACP_COMMAND: 'example-agent',
    },
    spawnImpl: () => {
      throw new Error('generic ACP must not spawn a separate backend server')
    },
  })
  assert.equal(runtime.ownsProcess, false)
})

test('additional ACP backends run inside the Gateway without an HTTP server', async () => {
  for (const protocol of ['hermes', 'codebuddy', 'codex', 'claude']) {
    assert.deepEqual(resolveManagedBackend({
      AGENT_PROTOCOL: protocol,
    }), {
      protocol,
      ownership: 'owned',
      permissionMode: 'native',
      baseUrl: null,
    })
    const runtime = await startManagedBackend({
      root: '/repo',
      env: { AGENT_PROTOCOL: protocol },
      spawnImpl: () => {
        throw new Error(`${protocol} must not spawn an HTTP backend server`)
      },
    })
    assert.equal(runtime.ownsProcess, false)
  }
})

test('full permission mode configures managed OpenCode without discarding inline config', () => {
  const env = {
    AGENT_PROTOCOL: 'opencode',
    QWEN_AUDIO_AGENT_BACKEND_PERMISSION_MODE: 'full',
    OPENCODE_COORDINATOR_AGENT: 'custom-coordinator',
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      theme: 'system',
      agent: {
        build: { model: 'provider/model', permission: 'ask' },
      },
    }),
  }
  const backend = resolveManagedBackend(env)
  applyBackendPermissionMode(env, backend)
  const inline = JSON.parse(env.OPENCODE_CONFIG_CONTENT)
  assert.equal(backend.permissionMode, 'full')
  assert.equal(inline.theme, 'system')
  assert.equal(inline.permission, 'allow')
  assert.equal(inline.agent.build.model, 'provider/model')
  assert.equal(inline.agent.build.permission, 'allow')
  assert.equal(
    inline.agent['custom-coordinator'].permission,
    'allow',
  )
  assert.equal(inline.agent['qwen-audio-agent-backend'], undefined)
})

test('full permission mode rejects backends that cannot support it safely', () => {
  assert.throws(() => resolveManagedBackend({
    AGENT_PROTOCOL: 'openclaw',
    OPENCLAW_ATTACH_EXISTING: 'true',
    QWEN_AUDIO_AGENT_BACKEND_PERMISSION_MODE: 'full',
  }), /只支持由 Gateway 启动/)
  assert.throws(() => resolveManagedBackend({
    AGENT_PROTOCOL: 'openclaw',
    QWEN_AUDIO_AGENT_BACKEND_PERMISSION_MODE: 'full',
  }), /OpenClaw/)
})
