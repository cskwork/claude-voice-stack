import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { inspectBackendAuthentication } from '../../../shared/backend/auth-status.mjs'
import { voiceBackend } from './backend.mjs'

const execFileAsync = promisify(execFile)

export const STATES = Object.freeze(['starting', 'ready', 'degraded', 'failed', 'stopped'])

/**
 * Fold component states into one product state. A required component that
 * failed fails the stack; an optional failure or any degraded component only
 * degrades it. `stopped` is neutral so `status` can describe a stack that was
 * never started without calling it broken.
 */
export function aggregateHealth(components) {
  const list = Object.values(components || {})
  if (!list.length) return 'stopped'
  if (list.some(c => c.state === 'failed' && c.required !== false)) return 'failed'
  if (list.some(c => c.state === 'starting')) return 'starting'
  if (list.some(c => c.state === 'failed' || c.state === 'degraded')) return 'degraded'
  // A stopped core service (Gateway, speech pipeline) means the stack is not
  // running, even if independent components such as Claude Code look fine.
  if (list.some(c => c.state === 'stopped' && c.core)) return 'stopped'
  if (list.every(c => c.state === 'stopped')) return 'stopped'
  return 'ready'
}

export function formatHealth(components, { title = 'Voice Agent' } = {}) {
  const rows = Object.values(components).map(c => [c.label, c.state, c.detail || ''])
  const width = Math.max(...rows.map(r => r[0].length), 8)
  const lines = [title, '']
  for (const [label, state, detail] of rows) {
    lines.push(`${label.padEnd(width + 2)}${state.padEnd(9)}${detail}`.trimEnd())
  }
  return lines.join('\n')
}

export async function probeHttp(url, { timeoutMs = 3000, fetchImpl = fetch, headers = {} } = {}) {
  const controller = new AbortController()
  let timer
  // Race explicitly: a fetch implementation that ignores the signal must
  // still resolve the probe within the timeout.
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(Object.assign(new Error('timeout'), { name: 'AbortError' }))
    }, timeoutMs)
  })
  try {
    const response = await Promise.race([fetchImpl(url, { signal: controller.signal, headers }), timeout])
    let body = null
    const type = response.headers.get('content-type') || ''
    if (type.includes('json')) body = await response.json().catch(() => null)
    else await response.text().catch(() => '')
    return { ok: response.ok, status: response.status, body }
  } catch (error) {
    const error_ = error.name === 'AbortError' ? 'timeout'
      : /fetch failed|ECONNREFUSED/.test(error.message) ? 'not reachable' : error.message
    return { ok: false, status: 0, error: error_ }
  } finally {
    clearTimeout(timer)
  }
}

export async function probeGateway(baseUrl, options) {
  const result = await probeHttp(`${baseUrl}/api/health`, options)
  if (!result.ok) return { state: 'stopped', detail: result.error || `HTTP ${result.status}` }
  const backend = result.body?.backend
  const voice = result.body?.voice || result.body?.realtime
  return {
    state: 'ready',
    detail: `${baseUrl}`,
    backend,
    voice,
    body: result.body,
  }
}

export async function probeSpeechToSpeech(httpBaseUrl, options) {
  const result = await probeHttp(`${httpBaseUrl}/v1/pool`, options)
  if (!result.ok) return { state: 'stopped', detail: result.error || `HTTP ${result.status}` }
  const size = result.body?.size
  const inUse = result.body?.in_use
  const stuck = Array.isArray(result.body?.units)
    && result.body.units.some(unit => unit.state === 'stuck')
  return {
    state: stuck ? 'degraded' : 'ready',
    detail: `pipelines ${inUse ?? '?'}/${size ?? '?'} in use${stuck ? ', stuck unit' : ''}`,
  }
}

export async function probeBackend(protocol, { env = process.env, execFileImpl = execFileAsync } = {}) {
  const backend = voiceBackend(protocol, env)
  if (!backend) return { state: 'failed', detail: `unsupported backend: ${protocol}` }
  const options = { timeout: 10_000, env }
  const run = async (command, args) => {
    try {
      const result = await execFileImpl(command, args, options)
      return { ok: true, output: `${result.stdout || ''}\n${result.stderr || ''}`.trim() }
    } catch (error) {
      return { ok: false, output: `${error.stdout || ''}\n${error.stderr || ''}`.trim() }
    }
  }
  try {
    const { stdout } = await execFileImpl(backend.executable, ['--version'], options)
    const version = stdout.trim().split('\n')[0]
    let status = 'unknown'
    if (protocol === 'claude') {
      const auth = await run(backend.executable, ['auth', 'status'])
      try {
        const parsed = JSON.parse(auth.output)
        if (parsed.loggedIn === true) status = 'authenticated'
        if (parsed.loggedIn === false) status = 'unauthenticated'
      } catch { /* An unsupported status command is not proof of missing login. */ }
    } else {
      const authentication = await inspectBackendAuthentication(protocol, {
        command: backend.executable, env, run,
      })
      status = authentication.status
    }
    if (status === 'unauthenticated') return { state: 'failed', detail: `${version}; not authenticated` }
    const permissionNote = backend.permissions ? '' : '; no permission prompts; no Gateway MCP tools'
    return {
      state: 'ready',
      detail: `${version}; ${status === 'authenticated' ? 'authenticated' : 'authentication unverified'}${permissionNote}`,
    }
  } catch (error) {
    return { state: 'failed', detail: `${backend.executable}: ${error.code === 'ENOENT' ? 'executable not found' : 'version check failed'}` }
  }
}

export async function probeAudioDevices(python, { execFileImpl = execFileAsync } = {}) {
  const script = [
    'import json, sounddevice as sd',
    'i = sd.query_devices(kind="input"); o = sd.query_devices(kind="output")',
    'print(json.dumps({"input": i["name"], "output": o["name"]}))',
  ].join('; ')
  try {
    const { stdout } = await execFileImpl(python, ['-c', script], { timeout: 20_000 })
    const devices = JSON.parse(stdout.trim().split('\n').pop())
    return {
      microphone: { state: 'ready', detail: devices.input },
      speaker: { state: 'ready', detail: devices.output },
    }
  } catch (error) {
    const detail = /No Default Input/i.test(error.message) ? 'no default input device' : 'audio query failed'
    return {
      microphone: { state: 'failed', detail },
      speaker: { state: 'failed', detail },
    }
  }
}

export async function processMemoryBytes(pids, { execFileImpl = execFileAsync } = {}) {
  const live = pids.filter(pid => Number.isInteger(pid) && pid > 0)
  if (!live.length) return 0
  try {
    const { stdout } = await execFileImpl('ps', ['-o', 'rss=', '-p', live.join(',')])
    return stdout.trim().split('\n')
      .map(line => Number.parseInt(line, 10) || 0)
      .reduce((sum, kb) => sum + kb * 1024, 0)
  } catch {
    return 0
  }
}

export function formatBytes(bytes) {
  if (!bytes) return '0 B'
  const gb = bytes / 1024 ** 3
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  return `${Math.round(bytes / 1024 ** 2)} MB`
}
