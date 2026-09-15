#!/usr/bin/env node
// Opt-in, paid-provider E2E: recorded speech -> real router -> Gateway -> real
// coding agent -> verified file -> spoken result. Never run as an offline test.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import WebSocket from 'ws'
import { GatewayClient } from '../../shared/gateway/client-sdk.mjs'
import { backendDefinition } from '../../shared/backend/catalog.mjs'
import { readEnvFile, resolveVoiceConfig } from './lib/env.mjs'
import { gatewayEnvironment } from './lib/backend.mjs'
import { probeGateway, probeSpeechToSpeech } from './lib/health.mjs'
import { repoRoot, stackPaths } from './lib/paths.mjs'
import { startDetached, stopProcess, isRunning, waitFor } from './lib/process-manager.mjs'
import { buildSpeechToSpeechCommand } from './lib/s2s-command.mjs'
import { redactSecrets } from './lib/redact.mjs'

const exec = promisify(execFile)
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1] }
const paths = stackPaths()
const output = resolve(arg('--output') || mkdtempSync(join(tmpdir(), 'voice-e2e-')))
const selected = arg('--backends', 'claude,codex,pi').split(',')
assert.ok(selected.every(id => ['claude', 'codex', 'pi'].includes(id)))
mkdirSync(output, { recursive: true, mode: 0o700 })
assert.ok(!existsSync(join(output, 'results.json')), 'Use a fresh output directory for each E2E run')
const values = { ...readEnvFile(paths.configPath).values, ...readEnvFile(arg('--config', paths.configPath)).values, ...process.env }
const results = []
const report = () => writeFileSync(join(output, 'results.json'), JSON.stringify({
  testedAt: new Date().toISOString(), router: 'live', input: 'synthetic Korean speech, PCM16 16 kHz',
  output: 'captured PCM16 24 kHz, playback receipts simulated', results,
}, null, 2))
const log = message => console.log(`[${new Date().toISOString()}] ${redactSecrets(message, values)}`)
const pause = ms => new Promise(done => setTimeout(done, ms))
async function freePort() {
  const server = createServer()
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  const port = server.address().port
  await new Promise(done => server.close(done))
  return port
}
async function synthesize(text) {
  const wav = join(output, 'input-ko.wav')
  await exec(paths.supertonicBin, ['tts', text, '-o', wav, '--lang', 'ko'], { timeout: 120000 })
  await exec(paths.python, ['-c', [
    'import sys,numpy as np,soundfile as sf,soxr',
    'a,sr=sf.read(sys.argv[1],dtype="float32")',
    'a=a.mean(axis=1) if a.ndim>1 else a',
    'a=soxr.resample(a,sr,16000)',
    '(np.clip(a,-1,1)*32767).astype("int16").tofile(sys.argv[2])',
  ].join('\n'), wav, join(output, 'input-ko.pcm')], { timeout: 60000 })
  return readFileSync(join(output, 'input-ko.pcm'))
}
function wav(pcm, rate) {
  const header = Buffer.alloc(44)
  header.write('RIFF'); header.writeUInt32LE(pcm.length + 36, 4); header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22)
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28)
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34)
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}
async function adapterEnvironment(id) {
  const definition = backendDefinition(id)
  const setup = definition.setup
  if (values[setup.adapterEnvironment]) return { [setup.adapterEnvironment]: values[setup.adapterEnvironment] }
  const step = definition.lifecycle.installation.steps.find(step => step.component === 'adapter')
  const pkg = values[step.packageEnv] || step.package
  log(`${id}: resolving ${pkg}`)
  const { stdout } = await exec('npm', ['exec', '--cache', join(output, 'npm-cache'), '--yes', `--package=${pkg}`, '--', 'which', setup.adapterCommand], { timeout: 180000 })
  const bin = stdout.trim().split('\n').pop()
  assert.ok(existsSync(bin), `adapter executable missing: ${setup.adapterCommand}`)
  return { [setup.adapterEnvironment]: bin }
}
function safePermission(permission, workspace) {
  const operation = permission?.operation
  const targets = [operation?.path, ...(operation?.locations || []).map(item => item.path)].filter(Boolean)
  // Approve only operations whose concrete locations are inside this fixture.
  // Unknown or shell-only requests remain denied and make the test fail clearly.
  return targets.length > 0 && targets.every(path => {
    try {
      const candidate = resolve(workspace, path)
      const target = existsSync(candidate) ? realpathSync(candidate)
        : join(realpathSync(dirname(candidate)), basename(candidate))
      const root = realpathSync(workspace)
      return target === root || target.startsWith(`${root}/`)
    } catch { return false }
  })
}
async function runAgent(id, pcm, s2sPort) {
  const dir = join(output, id)
  const workspace = join(dir, 'workspace')
  mkdirSync(workspace, { recursive: true })
  const token = `VOICE_E2E_${id.toUpperCase()}_${randomBytes(8).toString('hex')}`
  writeFileSync(join(workspace, 'instructions.txt'), [
    'This is an authorized end-to-end test. Work only in this directory.',
    `Create result.txt containing exactly this token followed by one newline: ${token}`,
    'Read result.txt back to verify it. Report the token in your final response.',
    'Use your file tools. Do not access the network, run git, or modify any other file.',
  ].join('\n'))
  const permissionDecisions = []
  const receipt = { backend: id, passed: false, workspace, startedAt: new Date().toISOString(), permissionDecisions }
  results.push(receipt); report()
  const port = await freePort()
  const env = { ...values, ...await adapterEnvironment(id),
    QWAUDIO_CONFIG_DIR: join(dir, 'gateway-config'),
    AGENT_PROTOCOL: id, HOST: '127.0.0.1', PORT: String(port),
    QWEN_AUDIO_REALTIME_PROVIDER: 'speech-to-speech',
    SPEECH_TO_SPEECH_REALTIME_URL: `ws://127.0.0.1:${s2sPort}/v1/realtime`,
    QWEN_AUDIO_AGENT_BACKEND_PERMISSION_MODE: 'native',
    [`${id === 'claude' ? 'CLAUDE' : id.toUpperCase()}_WORKSPACE`]: workspace,
    QWEN_AUDIO_AGENT_FRONTEND_PROMPT_DIR: join(repoRoot, 'config/prompts/foreground-glm'),
    QWEN_AUDIO_AGENT_ASSISTANT_PROFILE_PATH: join(repoRoot, 'config/prompts/foreground-glm/ASSISTANT.md'),
  }
  const config = resolveVoiceConfig(env).config
  const pidPath = join(dir, 'gateway.pid')
  // Start the actual Gateway application and backend, without the CLI's global
  // skills-installation bootstrap. Keep all Gateway persistence in this run.
  const boot = `const { createGatewayApplication } = await import('./server/src/app/gateway-application.mjs');
    const app = createGatewayApplication();
    const stop = async () => { await app.services.agent.close(); await app.close(); process.exit(0) };
    process.on('SIGTERM', stop); process.on('SIGINT', stop);`
  const proc = startDetached({ command: process.execPath, args: ['--input-type=module', '-e', boot],
    env: gatewayEnvironment(config, env), cwd: repoRoot, logPath: join(dir, 'gateway.log'), pidPath, captureStdout: true })
  let client
  const events = []
  const waiters = new Set()
  const next = (match, timeoutMs = 180000) => {
    const found = events.find(match)
    if (found) return Promise.resolve(found)
    return new Promise((resolveNext, reject) => {
      const waiter = { match, resolve: event => { clearTimeout(timer); waiters.delete(waiter); resolveNext(event) } }
      const timer = setTimeout(() => { waiters.delete(waiter); reject(new Error(`Timed out; last events: ${events.slice(-12).map(e => e.type).join(', ')}`)) }, timeoutMs)
      waiters.add(waiter)
    })
  }
  const audio = new Map()
  const push = event => {
    events.push(event)
    const logged = event.type === 'audio.delta' ? { ...event, audio: `<${Buffer.from(event.audio, 'base64').length} bytes>` } : event
    appendFileSync(join(dir, 'events.jsonl'), JSON.stringify(logged) + '\n')
    if (['transcript.final', 'task.accepted', 'task.completed', 'task.failed', 'error'].includes(event.type)) {
      log(`${id}: ${event.type} ${event.content || event.task?.status || JSON.stringify(event.error || '')}`)
    }
    if (event.type === 'audio.delta') {
      if (!audio.has(event.responseId)) {
        audio.set(event.responseId, [])
        client.send({ type: 'playback.started', responseId: event.responseId, turnId: event.turnId })
      }
      audio.get(event.responseId).push(Buffer.from(event.audio, 'base64'))
    }
    if (event.type === 'audio.done') client.send({ type: 'playback.ended', responseId: event.responseId, turnId: event.turnId })
    if (event.type === 'task.permission.requested') {
      const permission = event.permission || event.task?.authorization
      const allowed = safePermission(permission, workspace)
      permissionDecisions.push({ id: permission?.id, allowed, operation: permission?.operation })
      log(`${id}: permission ${allowed ? 'approved for fixture' : 'denied (outside verified fixture scope)'}`)
      client.request('permission.respond', { permission_id: permission.id, decision: allowed ? 'task' : 'reject' }).catch(error => log(error.message))
    }
    for (const waiter of waiters) if (waiter.match(event)) waiter.resolve(event)
  }
  try {
    const ready = await waitFor(async () => {
      assert.ok(isRunning(proc.pid), 'Gateway process exited; see gateway.log')
      const health = await probeGateway(`http://127.0.0.1:${port}`, { timeoutMs: 20000 })
      return { ok: health.backend?.ok === true && health.backend?.protocol === id, health }
    }, { timeoutMs: 120000, intervalMs: 2000 })
    assert.ok(ready.ok, 'Backend did not connect; see gateway.log')
    receipt.agentInfo = ready.result.health.backend.agentInfo
    log(`${id}: backend connected; opening voice session`)
    client = new GatewayClient({ url: `ws://127.0.0.1:${port}/api/realtime`,
      createSocket: (url, options) => new WebSocket(url, options), clientType: 'voice-e2e',
      clientInstanceId: `voice-e2e-${id}`, locale: 'ko-KR', timeZone: 'Asia/Seoul', reconnect: false,
      capabilities: ['input.audio', 'input.text', 'tasks.commands', 'permissions.respond', 'playback.receipts', 'session.heartbeat'],
      configure: { provider: 'speech-to-speech', voiceEnabled: true, inputEnabled: true, outputEnabled: true, textOnly: false, workingDirectory: workspace },
      onEvent: push, onStatus: status => { if (status.state === 'ready') push({ type: 'client.ready' }) },
    })
    client.start()
    await next(e => e.type === 'voice.ready', 90000)
    for (let offset = 0; offset < pcm.length; offset += 3200) {
      client.send({ type: 'input_audio_buffer.append', audio: pcm.subarray(offset, offset + 3200).toString('base64') })
      await pause(100)
    }
    for (let i = 0; i < 20; i++) {
      client.send({ type: 'input_audio_buffer.append', audio: Buffer.alloc(3200).toString('base64') })
      await pause(100)
    }
    const transcript = await next(e => e.type === 'transcript.final' && e.role === 'user', 90000)
    receipt.transcript = transcript.content
    assert.match(transcript.content, /파일|폴더|지시|작업/)
    const terminal = await next(e => ['task.completed', 'task.failed', 'task.cancelled'].includes(e.type), 240000)
    assert.equal(terminal.type, 'task.completed', `Backend failed: ${JSON.stringify(terminal.task)}`)
    receipt.task = terminal.task
    assert.equal(readFileSync(join(workspace, 'result.txt'), 'utf8'), `${token}\n`)
    assert.ok(JSON.stringify(terminal).includes(token), 'Task result did not contain the file token')
    const completedAt = events.indexOf(terminal)
    const spoken = await next(e => events.indexOf(e) > completedAt
      && e.type === 'transcript.final' && e.role === 'assistant'
      && e.taskId === terminal.task.id && e.origin === 'announcement', 90000)
    await next(e => e.type === 'audio.done' && e.responseId === spoken.responseId, 90000)
    const chunks = audio.get(spoken.responseId) || []
    const finalAudio = Buffer.concat(chunks)
    assert.ok(finalAudio.length > 4800, 'No meaningful result audio received')
    writeFileSync(join(dir, 'response.wav'), wav(finalAudio, 24000))
    receipt.spokenResult = spoken.content
    receipt.responseId = spoken.responseId
    receipt.resultOrigin = spoken.origin
    receipt.audioBytes = finalAudio.length
    receipt.audioSeconds = finalAudio.length / 48000
    receipt.passed = true
    log(`${id}: PASS, file verified, ${receipt.audioSeconds.toFixed(1)} seconds of result audio`)
  } catch (error) {
    receipt.error = redactSecrets(error.message, values)
    log(`${id}: FAIL ${receipt.error}`)
  } finally {
    client?.stop()
    receipt.finishedAt = new Date().toISOString()
    receipt.stopped = (await stopProcess(pidPath)).stopped
    report()
  }
}

const s2sPort = await freePort()
const { config, errors } = resolveVoiceConfig({ ...values, VOICE_S2S_PORT: String(s2sPort) })
assert.deepEqual(errors, [], 'Configure the live voice router before this test')
assert.ok(config.llm.remote, 'This test expects the live remote router')
assert.ok(existsSync(paths.speechToSpeechBin), 'Voice venv missing')
const pidPath = join(output, 's2s.pid')
try {
  if (existsSync(join(paths.home, 'mlx_models'))) symlinkSync(join(paths.home, 'mlx_models'), join(output, 'mlx_models'), 'dir')
  log(`Artifacts: ${output}`)
  const spec = buildSpeechToSpeechCommand(config, { bin: paths.speechToSpeechBin, debugTranscripts: true })
  const proc = startDetached({ ...spec, cwd: output, logPath: join(output, 'speech.log'), pidPath, captureStdout: true })
  let lastReport = 0
  const ready = await waitFor(async () => {
    assert.ok(isRunning(proc.pid), 'Speech service exited; see speech.log')
    return { ok: (await probeSpeechToSpeech(config.s2s.httpBaseUrl)).state === 'ready' }
  }, { timeoutMs: 300000, intervalMs: 2000, onTick: (_result, elapsed) => {
    if (elapsed - lastReport > 15000) { log('Loading local speech models...'); lastReport = elapsed }
  } })
  assert.ok(ready.ok, 'Speech service did not become ready')
  log('Speech service ready; creating Korean input recording')
  const pcm = await synthesize('작업 폴더에 있는 안내 파일을 읽고 그 지시대로 결과 파일을 만들어 주세요.')
  for (const id of selected) {
    try { await runAgent(id, pcm, s2sPort) } catch (error) {
      const receipt = results.find(result => result.backend === id) || { backend: id }
      if (!results.includes(receipt)) results.push(receipt)
      Object.assign(receipt, { passed: false, error: redactSecrets(error.message, values), finishedAt: new Date().toISOString() })
      log(`${id}: FAIL ${receipt.error}`)
      report()
    }
  }
} finally {
  await stopProcess(pidPath)
  report()
}
process.exitCode = results.length === selected.length && results.every(result => result.passed) ? 0 : 1
