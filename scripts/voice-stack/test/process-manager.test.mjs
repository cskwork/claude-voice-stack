import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { isRunning, readPid, startDetached, stopProcess, waitFor } from '../lib/process-manager.mjs'

test('startDetached writes a pid, reuses a live process, and stopProcess terminates it', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'voice-stack-pm-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const pidPath = join(dir, 'svc.pid')
  const logPath = join(dir, 'svc.log')
  const first = startDetached({
    command: process.execPath,
    args: ['-e', 'console.log("hello"); setInterval(() => {}, 1000)'],
    logPath, pidPath,
  })
  t.after(() => stopProcess(pidPath))
  assert.equal(first.reused, false)
  assert.equal(readPid(pidPath), first.pid)
  assert.ok(isRunning(first.pid))
  const second = startDetached({ command: process.execPath, args: ['-e', '1'], logPath, pidPath })
  assert.deepEqual(second, { pid: first.pid, reused: true })
  const logged = await waitFor(async () => ({ ok: readFileSync(logPath, 'utf8').includes('hello') }), { timeoutMs: 5000, intervalMs: 50 })
  assert.ok(logged.ok)
  const stopped = await stopProcess(pidPath, { timeoutMs: 3000 })
  assert.deepEqual(stopped, { pid: first.pid, stopped: true, wasRunning: true })
  assert.ok(!isRunning(first.pid))
  assert.equal(readPid(pidPath), null)
  assert.deepEqual(await stopProcess(pidPath), { pid: null, stopped: false, wasRunning: false })
})

test('waitFor gives up after the timeout', async () => {
  const result = await waitFor(async () => ({ ok: false }), { timeoutMs: 60, intervalMs: 10 })
  assert.equal(result.ok, false)
})
