import { randomUUID } from 'node:crypto'
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname } from 'node:path'

const sleepBuffer = new Int32Array(new SharedArrayBuffer(4))

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

function readOwner(lockPath) {
  try {
    return JSON.parse(readFileSync(lockPath, 'utf8'))
  } catch {
    return null
  }
}

function malformedLockIsStale(lockPath, now, staleMs) {
  try {
    return now() - statSync(lockPath).mtimeMs >= staleMs
  } catch {
    return true
  }
}

function reclaim(lockPath, token) {
  const stalePath = `${lockPath}.stale.${token}`
  try {
    renameSync(lockPath, stalePath)
  } catch {
    return false
  }
  try {
    unlinkSync(stalePath)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  return true
}

function acquire(filePath, {
  timeoutMs = 2000,
  retryMs = 10,
  staleMs = 30_000,
  now = Date.now,
} = {}) {
  const lockPath = `${filePath}.lock`
  const token = randomUUID()
  const deadline = now() + timeoutMs
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 })

  while (true) {
    const owner = { token, pid: process.pid, createdAt: now() }
    try {
      const fd = openSync(lockPath, 'wx', 0o600)
      try {
        writeFileSync(fd, `${JSON.stringify(owner)}\n`, 'utf8')
      } finally {
        closeSync(fd)
      }
      return () => {
        const current = readOwner(lockPath)
        if (current?.token !== token) return false
        try {
          unlinkSync(lockPath)
          return true
        } catch (error) {
          if (error?.code === 'ENOENT') return false
          throw error
        }
      }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      const current = readOwner(lockPath)
      const stale = current
        ? !processIsAlive(Number(current.pid))
        : malformedLockIsStale(lockPath, now, staleMs)
      if (stale && reclaim(lockPath, token)) continue
      if (now() >= deadline) {
        const timeout = new Error(`timed out waiting for shared file lock: ${filePath}`)
        timeout.code = 'shared_file_busy'
        throw timeout
      }
      Atomics.wait(sleepBuffer, 0, 0, Math.min(retryMs, Math.max(1, deadline - now())))
    }
  }
}

// Shared profile files are deliberately writable by both the Desktop and CLI
// Gateways. Keep each read-modify-write operation inside one cross-process
// transaction so independent runtimes cannot silently overwrite each other.
export function withFileTransaction(filePath, action, options) {
  if (!filePath) return action()
  const release = acquire(filePath, options)
  try {
    return action()
  } finally {
    release()
  }
}
