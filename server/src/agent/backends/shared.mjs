import { createConnection } from 'node:net'

export function clean(value) {
  return String(value || '').trim()
}

export function processAcpConnection({
  command,
  args = [],
  cwd,
  env = process.env,
}) {
  return {
    kind: 'process',
    command,
    args,
    cwd,
    env,
  }
}

export function endpointAvailable(value, timeoutMs = 300) {
  let target
  try {
    target = new URL(value)
  } catch {
    return Promise.resolve(false)
  }
  const port = Number(
    target.port || (target.protocol === 'https:' ? 443 : 80),
  )
  return new Promise(resolvePromise => {
    const socket = createConnection({
      host: target.hostname,
      port,
    })
    const finish = available => {
      socket.destroy()
      resolvePromise(available)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

export function baseEnvironment(configDirectory = '') {
  return {
    ...process.env,
    QWEN_AUDIO_AGENT_ENV_LOADED: '1',
    QWEN_AUDIO_AGENT_NODE: process.execPath,
    ...(configDirectory ? { QODER_CONFIG_DIR: configDirectory } : {}),
  }
}

export function websocketUrl(httpUrl) {
  const url = new URL(httpUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString().replace(/\/+$/, '')
}
