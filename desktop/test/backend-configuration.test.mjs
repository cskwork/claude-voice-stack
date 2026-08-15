import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import {
  configurationLaunch,
  openBackendConfiguration,
} from '../src/backend-configuration.mjs'

test('builds native terminal launches for macOS and Windows', () => {
  assert.equal(
    configurationLaunch('codex', { env: {}, platform: 'darwin' }).command,
    '/usr/bin/osascript',
  )
  const windows = configurationLaunch('codex', { env: {}, platform: 'win32' })
  assert.equal(windows.command, 'cmd.exe')
  assert.ok(windows.args.includes('codex login'))
})

test('falls back across common Linux terminal emulators', async () => {
  const calls = []
  const result = await openBackendConfiguration('codex', {
    env: {},
    platform: 'linux',
    spawnImpl(command) {
      calls.push(command)
      const child = new EventEmitter()
      child.unref = () => {}
      queueMicrotask(() => child.emit(
        command === 'gnome-terminal' ? 'spawn' : 'error',
        new Error('missing'),
      ))
      return child
    },
  })
  assert.equal(result.ok, true)
  assert.deepEqual(calls, ['x-terminal-emulator', 'gnome-terminal'])
})

test('reports a clear Linux error when no terminal exists', async () => {
  await assert.rejects(
    openBackendConfiguration('codex', {
      env: {},
      platform: 'linux',
      spawnImpl() {
        const child = new EventEmitter()
        queueMicrotask(() => child.emit('error', new Error('missing')))
        return child
      },
    }),
    /没有找到可用的终端程序/,
  )
})
