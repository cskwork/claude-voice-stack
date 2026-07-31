import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadRuntimeEnvironment } from '../../shared/runtime-environment.mjs'
import { startManagedBackend } from './process/managed-backend.mjs'

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const root = process.env.QWEN_AUDIO_AGENT_RUNTIME_ROOT || sourceRoot
loadRuntimeEnvironment({ root })

let backendRuntime
let agentClient
let stopPromise
let exitTimer

function stop(signal = 'SIGTERM') {
  if (stopPromise) return stopPromise
  stopPromise = Promise.all([
    backendRuntime?.stop(signal),
    agentClient?.close(),
  ]).catch(error => {
    process.stderr.write(`后台 Agent 停止失败：${error.message}\n`)
  })
  return stopPromise
}

function stopAndExit(signal) {
  if (!exitTimer) {
    exitTimer = setTimeout(() => process.exit(0), 2000)
  }
  stop(signal).finally(() => process.exit(0))
}

try {
  backendRuntime = await startManagedBackend({ root })
  const managedBackend = backendRuntime.child
  const onManagedBackendExit = (code, signal) => {
    if (stopPromise) return
    const reason = signal || code || 'unknown'
    process.stderr.write(`后台 Agent 意外退出：${reason}\n`)
    stopPromise = Promise.resolve(agentClient?.close()).catch(error => {
      process.stderr.write(`后台 Agent 停止失败：${error.message}\n`)
    })
    stopPromise.finally(() => process.exit(1))
  }
  if (managedBackend?.exitCode != null || managedBackend?.signalCode != null) {
    onManagedBackendExit(
      managedBackend.exitCode,
      managedBackend.signalCode,
    )
  } else {
    managedBackend?.once('exit', onManagedBackendExit)
  }
  const agentModule = await import('./agent/agent-client.mjs')
  agentClient = agentModule.agent
  process.once('SIGINT', () => {
    stopAndExit('SIGINT')
  })
  process.once('SIGTERM', () => {
    stopAndExit('SIGTERM')
  })
  if (process.connected) {
    process.once('disconnect', () => {
      stopAndExit('SIGTERM')
    })
  }
  process.once('exit', () => {
    backendRuntime?.close()
    agentClient?.close()
  })
  await import('./app/bootstrap.mjs')
} catch (error) {
  stop()
  process.stderr.write(`Gateway 启动失败：${error.message}\n`)
  process.exitCode = 1
}
