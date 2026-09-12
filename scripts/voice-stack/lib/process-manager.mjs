import { spawn } from 'node:child_process'
import { mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export function readPid(pidPath) {
  try {
    const pid = Number.parseInt(readFileSync(pidPath, 'utf8').trim(), 10)
    return Number.isInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

export function isRunning(pid) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

/**
 * Spawn a long-running service as its own process group, redirect its output
 * to a log file, and record the pid. Callers own log rotation; the file is
 * opened in append mode so restarts keep history.
 *
 * `captureStdout` defaults to false: speech-to-speech writes user/assistant
 * transcripts to stdout (rich console) regardless of `--log_transcripts`, while
 * its diagnostics go to stderr through `logging`. Keeping stdout out of the log
 * is what makes "no transcript logging by default" true on disk.
 */
export function startDetached({ command, args = [], env = {}, cwd, logPath, pidPath, captureStdout = false }) {
  const existing = readPid(pidPath)
  if (existing && isRunning(existing)) return { pid: existing, reused: true }
  mkdirSync(dirname(logPath), { recursive: true })
  mkdirSync(dirname(pidPath), { recursive: true })
  const out = openSync(logPath, 'a')
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    detached: true,
    stdio: ['ignore', captureStdout ? out : 'ignore', out],
  })
  child.unref()
  writeFileSync(pidPath, `${child.pid}\n`, { mode: 0o600 })
  return { pid: child.pid, reused: false }
}

export async function stopProcess(pidPath, { timeoutMs = 10_000 } = {}) {
  const pid = readPid(pidPath)
  if (!pid || !isRunning(pid)) {
    rmSync(pidPath, { force: true })
    return { pid, stopped: false, wasRunning: false }
  }
  const signal = sig => {
    try { process.kill(-pid, sig) } catch { try { process.kill(pid, sig) } catch { /* gone */ } }
  }
  signal('SIGTERM')
  const deadline = Date.now() + timeoutMs
  while (isRunning(pid) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  if (isRunning(pid)) {
    signal('SIGKILL')
    await new Promise(resolve => setTimeout(resolve, 300))
  }
  rmSync(pidPath, { force: true })
  return { pid, stopped: !isRunning(pid), wasRunning: true }
}

export async function waitFor(probe, { timeoutMs = 60_000, intervalMs = 1000, onTick } = {}) {
  const started = Date.now()
  let last
  while (Date.now() - started < timeoutMs) {
    last = await probe()
    if (last?.ok) return { ok: true, elapsedMs: Date.now() - started, result: last }
    onTick?.(last, Date.now() - started)
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
  return { ok: false, elapsedMs: Date.now() - started, result: last }
}
