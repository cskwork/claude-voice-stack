import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import { backendHealth, gatewayEnvironment, voiceBackend } from '../lib/backend.mjs'
import { resolveVoiceConfig } from '../lib/env.mjs'
import { probeBackend } from '../lib/health.mjs'
import { repoRoot } from '../lib/paths.mjs'

const execFileAsync = promisify(execFile)

for (const protocol of ['claude', 'codex', 'pi']) {
  test(`${protocol}: voice settings select the actual Gateway driver and workspace`, async t => {
    const dir = mkdtempSync(join(tmpdir(), 'voice-backend-'))
    t.after(() => rmSync(dir, { recursive: true, force: true }))
    const env = {
      ...process.env,
      AGENT_PROTOCOL: protocol,
      QWAUDIO_CONFIG_DIR: dir,
      QWEN_AUDIO_AGENT_BACKEND_PERMISSION_MODE: 'native',
      [`${protocol === 'claude' ? 'CLAUDE' : protocol.toUpperCase()}_WORKSPACE`]: dir,
      VOICE_LLM_BACKEND: 'mlx-lm', VOICE_LLM_MODEL: 'local-model',
    }
    const { config, errors } = resolveVoiceConfig(env)
    assert.deepEqual(errors, [])
    const script = `
      const { config } = await import('./server/src/core/config.mjs');
      const { createAcpBackendAdapter } = await import('./server/src/backend/adapters/acp/backend-factory.mjs');
      const backend = createAcpBackendAdapter({ sessionStatePath: null });
      console.log(JSON.stringify({ protocol: config.agentProtocol, permission: config.backendPermissionMode,
        directory: config.backends[config.agentProtocol].directory,
        launcher: backend.profile.acpConnection.args[0] }));
    `
    const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: repoRoot, env: gatewayEnvironment(config, env),
    })
    const actual = JSON.parse(stdout.trim().split('\n').pop())
    assert.equal(actual.protocol, protocol)
    assert.equal(actual.permission, protocol === 'pi' ? 'full' : 'native')
    assert.equal(actual.directory, dir)
    assert.equal(actual.launcher, join(repoRoot, voiceBackend(protocol).launcher))
  })
}

test('blank selection forwards Claude defaults, shell selection wins over file', () => {
  const blank = { AGENT_PROTOCOL: '', QWEN_AUDIO_AGENT_BACKEND_PERMISSION_MODE: '' }
  const { config } = resolveVoiceConfig(blank)
  assert.equal(gatewayEnvironment(config, blank).AGENT_PROTOCOL, 'claude')
  assert.equal(gatewayEnvironment(config, blank).QWEN_AUDIO_AGENT_BACKEND_PERMISSION_MODE, 'native')
  const env = { ...{ AGENT_PROTOCOL: 'claude' }, ...{ AGENT_PROTOCOL: 'codex', CODEX_PATH: '/custom/codex' } }
  const merged = gatewayEnvironment(resolveVoiceConfig(env).config, env)
  assert.equal(merged.AGENT_PROTOCOL, 'codex')
  assert.equal(merged.CODEX_PATH, '/custom/codex')
})

test('Claude probes the configured executable and treats a nonzero logged-out result as failure', async () => {
  const env = { CLAUDE_CODE_EXECUTABLE: '/custom/claude', CLAUDE_CONFIG_DIR: '/custom/config' }
  const result = await probeBackend('claude', { env, execFileImpl: async (command, args, options) => {
    assert.equal(command, '/custom/claude')
    assert.equal(options.env, env)
    if (args[0] === '--version') return { stdout: '2.1.270' }
    assert.deepEqual(args, ['auth', 'status'])
    throw Object.assign(new Error('logout'), { stdout: '{"loggedIn":false}' })
  } })
  assert.equal(result.state, 'failed')
  assert.match(result.detail, /not authenticated/)
})

test('Codex parses login status from stderr and keeps unknown status explicit', async () => {
  for (const [output, state, detail] of [
    ['Logged in using ChatGPT', 'ready', /authenticated/],
    ['Not logged in', 'failed', /not authenticated/],
    ['', 'ready', /authentication unverified/],
  ]) {
    const result = await probeBackend('codex', { env: { CODEX_PATH: '/custom/codex' }, execFileImpl: async (command, args) => {
      assert.equal(command, '/custom/codex')
      if (args[0] === '--version') return { stdout: 'codex-cli 0.154.0' }
      assert.deepEqual(args, ['login', 'status'])
      throw Object.assign(new Error('status'), { stderr: output })
    } })
    assert.equal(result.state, state)
    assert.match(result.detail, detail)
  }
})

test('Pi checks its selected provider without refreshing credentials and reports approval limits', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'voice-pi-auth-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ defaultProvider: 'test-provider' }))
  const result = await probeBackend('pi', {
    env: { HOME: dir, PI_CODING_AGENT_DIR: dir, PI_BIN: '/alias/pi', PI_ACP_PI_COMMAND: '/custom/pi' },
    execFileImpl: async (command, args) => {
      assert.equal(command, '/custom/pi')
      if (args[0] === '--version') return { stdout: '0.85.1' }
      assert.deepEqual(args, ['auth', 'check', '--provider', 'test-provider', '--no-refresh', '--json'])
      return { stdout: '{"status":"ready"}' }
    },
  })
  assert.equal(result.state, 'ready')
  assert.match(result.detail, /no permission prompts/)
  assert.match(result.detail, /no Gateway MCP tools/)
})

test('missing and broken executables fail explicitly for all backends', async () => {
  for (const protocol of ['claude', 'codex', 'pi']) {
    for (const code of ['ENOENT', 'EACCES']) {
      const result = await probeBackend(protocol, { env: {}, execFileImpl: async () => {
        throw Object.assign(new Error('failed'), { code })
      } })
      assert.equal(result.state, 'failed')
      assert.match(result.detail, code === 'ENOENT' ? /executable not found/ : /version check failed/)
    }
  }
  assert.equal((await probeBackend('unknown')).state, 'failed')
})

test('health reports actual backend mismatch and never treats absent ok as connected', () => {
  const local = { state: 'ready', detail: 'authenticated' }
  assert.match(backendHealth('pi', local, { state: 'stopped' }).detail, /^Pi;/)
  assert.equal(backendHealth('codex', local, { state: 'ready', backend: { protocol: 'codex', ok: true } }).state, 'ready')
  for (const backend of [{ protocol: 'claude', ok: true }, { protocol: 'codex' }, { ok: true }]) {
    assert.equal(backendHealth('codex', local, { state: 'ready', backend }).state, 'degraded')
  }
  assert.match(backendHealth('codex', local, { state: 'ready', backend: { protocol: 'claude', ok: true } }).detail, /stop, then start/)
  assert.equal(backendHealth('codex', { state: 'failed' }, { state: 'ready', backend: { protocol: 'codex', ok: true } }).state, 'failed')
})

test('CLI start rejects a live Gateway for another backend before launching voice processes', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'voice-switch-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ backend: { protocol: 'claude', ok: true } }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  writeFileSync(join(dir, 'config.env'), 'AGENT_PROTOCOL=codex\nVOICE_LLM_BACKEND=mlx-lm\nVOICE_LLM_MODEL=test-model\n')
  await assert.rejects(execFileAsync(process.execPath, ['scripts/voice-stack/voice-agent.mjs', 'start'], {
    cwd: repoRoot,
    env: {
      PATH: process.env.PATH, HOME: dir, CLAUDE_VOICE_STACK_HOME: dir,
      HOST: '127.0.0.1', PORT: String(server.address().port),
    },
  }), error => {
    assert.equal(error.code, 1)
    assert.match(error.stderr, /Gateway uses claude, configured codex/)
    return true
  })
  assert.equal(existsSync(join(dir, 'run')), false)
})
