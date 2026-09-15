#!/usr/bin/env node
// claude-voice-stack process manager and diagnostics.
// Commands: setup | doctor | start | stop | status | smoke-glm | help
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, copyFileSync, chmodSync } from 'node:fs'
import { arch, platform, homedir } from 'node:os'
import { resolve } from 'node:path'
import { readEnvFile, resolveVoiceConfig } from './lib/env.mjs'
import { backendHealth, gatewayEnvironment, voiceBackend } from './lib/backend.mjs'
import { formatSmokeResults, runGlmSmoke } from './lib/glm-smoke.mjs'
import {
  aggregateHealth,
  formatBytes,
  formatHealth,
  probeAudioDevices,
  probeBackend,
  probeGateway,
  probeHttp,
  probeSpeechToSpeech,
  processMemoryBytes,
} from './lib/health.mjs'
import { DEFAULT_PROFILE, repoRoot, stackPaths } from './lib/paths.mjs'
import { isRunning, readPid, startDetached, stopProcess, waitFor } from './lib/process-manager.mjs'
import { redactSecrets } from './lib/redact.mjs'
import { buildSpeechToSpeechCommand, buildSupertonicServeCommand } from './lib/s2s-command.mjs'

const paths = stackPaths()
const argv = process.argv.slice(2)
const command = argv[0] && !argv[0].startsWith('-') ? argv.shift() : 'help'
const flags = new Set(argv.filter(arg => arg.startsWith('--')))

function log(line = '') { process.stdout.write(`${line}\n`) }
function fail(message, code = 1) {
  process.stderr.write(`${message}\n`)
  process.exit(code)
}

function loadConfig({ strict = true } = {}) {
  const file = readEnvFile(paths.configPath)
  const merged = { ...file.values, ...process.env }
  const { config, errors } = resolveVoiceConfig(merged)
  if (!file.exists) errors.unshift(`config missing: ${paths.configPath} (run: voice-agent setup)`)
  if (strict && errors.length) {
    fail(`Configuration problems:\n${errors.map(line => `  - ${line}`).join('\n')}`)
  }
  return { config, errors, values: file.values, env: merged }
}

async function collectStatus(config, env) {
  const s2sPid = readPid(paths.pid('speech-to-speech'))
  const gatewayPid = readPid(paths.pid('gateway'))
  const supertonicPid = readPid(paths.pid('supertonic'))
  const [gateway, s2s, backend, audio] = await Promise.all([
    probeGateway(config.gateway.baseUrl),
    probeSpeechToSpeech(config.s2s.httpBaseUrl),
    probeBackend(config.agentProtocol, { env }),
    existsSync(paths.python) ? probeAudioDevices(paths.python) : Promise.resolve({
      microphone: { state: 'failed', detail: 'venv missing' },
      speaker: { state: 'failed', detail: 'venv missing' },
    }),
  ])
  const inProcess = s2s.state === 'ready' || s2s.state === 'degraded'
  const components = {
    gateway: { label: 'Gateway', core: true, ...gateway },
    s2s: { label: 'Speech-to-Speech', core: true, ...s2s },
    stt: {
      label: 'STT',
      state: inProcess ? 'ready' : 'stopped',
      detail: `${config.stt.backend === 'whisper-mlx' ? `Whisper ${config.stt.model}` : config.stt.model.replace(/^mlx-community\//, '')} / MLX (inside speech-to-speech)`,
    },
    llm: {
      label: 'Voice LLM',
      state: inProcess ? 'ready' : 'stopped',
      detail: `${config.llm.model} via ${config.llm.backend}`,
    },
    tts: {
      label: 'TTS',
      state: config.tts.mode === 'supertonic'
        ? (inProcess ? 'ready' : 'stopped')
        : ((await probeHttp(config.tts.baseUrl.replace(/\/v1$/, '') + '/docs')).ok ? 'ready' : 'stopped'),
      detail: config.tts.mode === 'supertonic'
        ? `Supertonic ${config.tts.voice} (inside speech-to-speech)`
        : `Supertonic HTTP ${config.tts.baseUrl}`,
    },
    backend: backendHealth(config.agentProtocol, backend, gateway),
    microphone: { label: 'Microphone', ...audio.microphone, required: false },
    speaker: { label: 'Speaker', ...audio.speaker, required: false },
  }
  const memory = await processMemoryBytes([s2sPid, gatewayPid, supertonicPid])
  return { components, memory, pids: { s2sPid, gatewayPid, supertonicPid } }
}

async function status() {
  const { config, errors, env } = loadConfig({ strict: false })
  const { components, memory } = await collectStatus(config, env)
  if (errors.length) components.config = { label: 'Config', state: 'failed', detail: errors.join('; ') }
  log(formatHealth(components))
  log(`${'Memory'.padEnd(18)}${formatBytes(memory)} managed processes (diagnostic only)`)
  log(`${'Overall'.padEnd(18)}${aggregateHealth(components)}`)
}

async function doctor() {
  const checks = []
  const add = (id, ok, detail, { required = true } = {}) => checks.push({ id, ok, detail, required })
  add('os', platform() === 'darwin' && arch() === 'arm64', `${platform()} ${arch()}`)
  const nodeMajor = Number.parseInt(process.versions.node, 10)
  add('node', nodeMajor >= 22, `node ${process.versions.node}`)
  add('venv', existsSync(paths.python), paths.venv)
  add('speech-to-speech', existsSync(paths.speechToSpeechBin), paths.speechToSpeechBin)
  const { config, errors, values, env } = loadConfig({ strict: false })
  const hfCache = resolve(process.env.HF_HOME || resolve(homedir(), '.cache/huggingface'), 'hub')
  const sttAsset = config.stt.backend === 'whisper-mlx'
    ? resolve(paths.home, 'mlx_models', config.stt.model, 'weights.npz')
    : resolve(hfCache, `models--${config.stt.model.replace('/', '--')}`)
  add('stt-assets', existsSync(sttAsset), `${sttAsset} (downloads on first start otherwise)`, { required: false })
  add('config', errors.length === 0, errors.length ? errors.join('; ') : paths.configPath)
  add('prompt', existsSync(resolve(repoRoot, values.QWEN_AUDIO_AGENT_FRONTEND_PROMPT_DIR || 'config/prompts/foreground-glm', 'PROMPT.md')),
    values.QWEN_AUDIO_AGENT_FRONTEND_PROMPT_DIR || 'config/prompts/foreground-glm')
  const backend = voiceBackend(config.agentProtocol, env)
  const backendProbe = await probeBackend(config.agentProtocol, { env })
  add(config.agentProtocol, backendProbe.state === 'ready', backendProbe.detail)
  if (backend) add(`${backend.id}-acp-launcher`, existsSync(resolve(repoRoot, backend.launcher)),
    `${backend.launcher}; adapter starts on demand, connection not checked here`)
  if (existsSync(paths.python)) {
    const audio = await probeAudioDevices(paths.python)
    add('microphone', audio.microphone.state === 'ready', audio.microphone.detail, { required: false })
    add('speaker', audio.speaker.state === 'ready', audio.speaker.detail, { required: false })
  }
  if (config.llm.remote && config.llm.baseUrl && config.llm.apiKey) {
    const smoke = await runGlmSmoke({
      baseUrl: config.llm.baseUrl,
      apiKey: config.llm.apiKey,
      model: config.llm.model,
    })
    for (const result of smoke.results) {
      add(`glm.${result.id}`, result.ok, `${result.latencyMs} ms ${result.detail}`)
    }
  } else if (config.llm.remote) {
    add('glm', false, 'VOICE_LLM_BASE_URL / VOICE_LLM_API_KEY not set')
  }
  const s2s = await probeSpeechToSpeech(config.s2s.httpBaseUrl)
  add('realtime', s2s.state === 'ready', s2s.state === 'ready' ? config.s2s.realtimeUrl : `not running (${s2s.detail})`, { required: false })
  const gateway = await probeGateway(config.gateway.baseUrl)
  add('gateway', gateway.state === 'ready', gateway.state === 'ready' ? gateway.detail : `not running (${gateway.detail})`, { required: false })

  for (const check of checks) {
    const mark = check.ok ? '✓' : check.required ? '✗' : '!'
    log(`${mark} ${check.id.padEnd(20)} ${redactSecrets(check.detail, values)}`)
  }
  const failed = checks.filter(check => !check.ok && check.required)
  log('')
  if (failed.length) fail(`${failed.length} required check(s) failed.`)
  log('All required checks passed.')
}

async function smokeGlm() {
  const { config, values } = loadConfig()
  if (!config.llm.remote) fail('VOICE_LLM_BACKEND is local (mlx-lm); nothing to smoke-test remotely.')
  log(`GLM compatibility gate: ${config.llm.model} @ ${config.llm.baseUrl}`)
  const smoke = await runGlmSmoke({
    baseUrl: config.llm.baseUrl,
    apiKey: config.llm.apiKey,
    model: config.llm.model,
  })
  log(redactSecrets(formatSmokeResults(smoke.results), values))
  if (!smoke.ok) fail('GLM gate failed.')
}

async function start() {
  const { config, values, env } = loadConfig()
  // A live Gateway retains its backend. Never silently reuse a different agent.
  const existingGateway = await probeGateway(config.gateway.baseUrl)
  if (existingGateway.state === 'ready' && existingGateway.backend?.protocol !== config.agentProtocol) {
    fail(`Gateway uses ${existingGateway.backend?.protocol || 'an unknown backend'}, configured ${config.agentProtocol}. Run voice-agent stop, then start.`)
  }
  const backend = voiceBackend(config.agentProtocol, env)
  const backendProbe = await probeBackend(config.agentProtocol, { env })
  if (backendProbe.state === 'failed') fail(`${backend.label}: ${backendProbe.detail}`)
  log(`Backend: ${backend.label}; ${backendProbe.detail}`)
  mkdirSync(paths.logs, { recursive: true })
  mkdirSync(paths.run, { recursive: true })
  const debugTranscripts = flags.has('--debug-transcripts')
  if (debugTranscripts) log('! transcript logging enabled for this run (--debug-transcripts)')

  if (config.llm.remote && !flags.has('--skip-glm-check')) {
    const smoke = await runGlmSmoke({
      baseUrl: config.llm.baseUrl,
      apiKey: config.llm.apiKey,
      model: config.llm.model,
      checks: ['basic'],
    })
    const result = smoke.results[0]
    if (!result.ok) fail(`GLM unreachable: ${redactSecrets(result.detail, values)}\nThe voice reasoning service is unavailable; not starting.`)
    log(`✓ GLM ${config.llm.model} reachable (${result.latencyMs} ms)`)
  }

  if (config.tts.mode === 'openai-http') {
    const bin = existsSync(paths.supertonicBin) ? paths.supertonicBin : 'supertonic'
    const spec = buildSupertonicServeCommand(config, { bin })
    const started = startDetached({
      ...spec, cwd: repoRoot, logPath: paths.log('supertonic'), pidPath: paths.pid('supertonic'),
    })
    log(`${started.reused ? '=' : '+'} Supertonic HTTP pid ${started.pid}`)
  }

  const s2sSpec = buildSpeechToSpeechCommand(config, { bin: paths.speechToSpeechBin, debugTranscripts })
  // cwd = stack home: lightning-whisper-mlx stores weights under ./mlx_models.
  const s2s = startDetached({
    ...s2sSpec, cwd: paths.home, logPath: paths.log('speech-to-speech'), pidPath: paths.pid('speech-to-speech'),
    captureStdout: debugTranscripts,
  })
  log(`${s2s.reused ? '=' : '+'} speech-to-speech pid ${s2s.pid} (log: ${paths.log('speech-to-speech')})`)
  const s2sReady = await waitFor(async () => {
    if (!isRunning(s2s.pid)) return { ok: false, exited: true }
    const probe = await probeSpeechToSpeech(config.s2s.httpBaseUrl)
    return { ok: probe.state === 'ready' }
  }, {
    timeoutMs: 300_000,
    onTick: (last, elapsed) => {
      if (last?.exited) fail(`speech-to-speech exited; see ${paths.log('speech-to-speech')}`)
      if (elapsed % 15_000 < 1000) log(`  waiting for speech-to-speech (${Math.round(elapsed / 1000)} s; first start downloads models)`)
    },
  })
  if (!s2sReady.ok) fail(`speech-to-speech did not become ready; see ${paths.log('speech-to-speech')}`)
  log(`✓ realtime ${config.s2s.realtimeUrl} (${Math.round(s2sReady.elapsedMs / 1000)} s)`)

  const gateway = startDetached({
    command: process.execPath,
    args: [resolve(repoRoot, 'scripts/start.mjs')],
    env: gatewayEnvironment(config, env),
    cwd: repoRoot,
    logPath: paths.log('gateway'),
    pidPath: paths.pid('gateway'),
  })
  log(`${gateway.reused ? '=' : '+'} gateway pid ${gateway.pid} (log: ${paths.log('gateway')})`)
  const gatewayReady = await waitFor(async () => {
    if (!isRunning(gateway.pid)) return { ok: false, exited: true }
    const probe = await probeGateway(config.gateway.baseUrl)
    return { ok: probe.state === 'ready' }
  }, {
    timeoutMs: 90_000,
    onTick: last => { if (last?.exited) fail(`gateway exited; see ${paths.log('gateway')}`) },
  })
  if (!gatewayReady.ok) fail(`gateway did not become ready; see ${paths.log('gateway')}`)

  log('')
  await status()
  if (flags.has('--tui')) {
    log('\nLaunching TUI (Ctrl+C leaves the services running; use voice-agent stop).')
    const tui = spawn('npm', ['run', 'tui'], { cwd: repoRoot, stdio: 'inherit', env: gatewayEnvironment(config, env) })
    await new Promise(resolvePromise => tui.on('exit', resolvePromise))
  } else {
    log(`\nGateway: ${config.gateway.baseUrl}   TUI: npm run tui   Stop: voice-agent stop`)
  }
}

async function stop() {
  for (const name of ['gateway', 'speech-to-speech', 'supertonic']) {
    const result = await stopProcess(paths.pid(name))
    if (result.wasRunning) log(`${result.stopped ? '✓' : '✗'} ${name} pid ${result.pid} ${result.stopped ? 'stopped' : 'still running'}`)
    else log(`- ${name} not running`)
  }
}

function setup() {
  const script = resolve(repoRoot, 'scripts/voice-stack/bootstrap-macos.sh')
  const child = spawn('bash', [script, ...argv], { cwd: repoRoot, stdio: 'inherit' })
  child.on('exit', code => {
    if (code !== 0) fail(`bootstrap failed (exit ${code})`, code || 1)
    if (!existsSync(paths.configPath)) {
      mkdirSync(paths.home, { recursive: true })
      copyFileSync(resolve(repoRoot, DEFAULT_PROFILE), paths.configPath)
      chmodSync(paths.configPath, 0o600)
    }
    log(`\nConfiguration: ${paths.configPath}`)
    log('Fill in VOICE_LLM_BASE_URL and VOICE_LLM_API_KEY. Select AGENT_PROTOCOL=claude, codex, or pi; then run: voice-agent doctor && voice-agent start')
  })
}

function help() {
  log(`voice-agent <command>

  setup        install the Python voice stack under ${paths.home} and write config.env
  doctor       check OS, Node, venv, config, selected backend, audio devices, GLM gate, services
  start        start speech-to-speech and the Gateway (flags: --tui, --debug-transcripts, --skip-glm-check)
  stop         stop managed processes
  status       component health and managed-process memory
  smoke-glm    run the GLM compatibility gate only

Config: ${paths.configPath}
Backend: AGENT_PROTOCOL=claude (default), codex, or pi. Stop before switching.
Pi runs without permission prompts and does not expose Gateway MCP tools.`)
}

const commands = { setup, doctor, start, stop, status, 'smoke-glm': smokeGlm, help }
if (!commands[command]) fail(`Unknown command: ${command}\n`)
try {
  await commands[command]()
} catch (error) {
  fail(redactSecrets(`voice-agent ${command} failed: ${error.stack || error.message}`, process.env))
}
