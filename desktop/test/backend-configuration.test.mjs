import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import {
  configurationLaunch,
  openBackendConfiguration,
} from '../src/backend-configuration.mjs'
import { backendNames } from '../../shared/backend-catalog.mjs'

test('builds native terminal launches for macOS and Windows', () => {
  assert.equal(
    configurationLaunch('codex', { env: {}, platform: 'darwin' }).command,
    '/usr/bin/osascript',
  )
  const windows = configurationLaunch('codex', { env: {}, platform: 'win32' })
  assert.equal(windows.command, 'cmd.exe')
  assert.ok(windows.args.includes('codex login'))
})

test('maps every backend-owned configuration action on every desktop OS', () => {
  for (const platform of ['darwin', 'linux', 'win32']) {
    for (const id of backendNames()) {
      const launch = configurationLaunch(id, { env: {}, platform })
      if (id === 'acp') {
        assert.equal(launch, null)
        continue
      }
      assert.ok(launch, `${platform}:${id}`)
      assert.equal(launch.action.kind, 'terminal', `${platform}:${id}`)
      assert.ok(launch.action.command, `${platform}:${id}`)
      assert.ok(launch.action.hint, `${platform}:${id}`)
    }
  }
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
