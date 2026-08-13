import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import {
  configurationLaunch,
  openBackendConfiguration,
} from '../src/backend-configuration.mjs'

test('opens a fixed backend-owned configuration command in Terminal', () => {
  const launch = configurationLaunch('qoder', { env: {}, platform: 'darwin' })
  assert.equal(launch.command, '/usr/bin/osascript')
  assert.match(launch.args.join(' '), /qodercli login/)
  const codebuddy = configurationLaunch('codebuddy', {
    env: {},
    platform: 'darwin',
  })
  assert.match(codebuddy.args.join(' '), /codebuddy/)
})

test('maps the trusted configuration action on Linux and Windows', () => {
  const linux = configurationLaunch('deepseek', {
    env: {},
    platform: 'linux',
  })
  assert.equal(linux.command, 'x-terminal-emulator')
  assert.deepEqual(linux.args.slice(0, 3), ['-e', 'sh', '-lc'])
  assert.match(linux.args[3], /^dsh web;/)

  const windows = configurationLaunch('codex', {
    env: {},
    platform: 'win32',
  })
  assert.equal(windows.command, 'cmd.exe')
  assert.deepEqual(windows.args, [
    '/d', '/c', 'start', '', 'cmd.exe', '/k', 'codex login',
  ])
})

test('launches configuration detached without accepting a renderer command', async () => {
  const calls = []
  let unref = false
  const result = await openBackendConfiguration('codex', {
    env: {},
    platform: 'darwin',
    spawnImpl: (...args) => {
      calls.push(args)
      const child = new EventEmitter()
      child.unref = () => { unref = true }
      queueMicrotask(() => child.emit('spawn'))
      return child
    },
  })
  assert.equal(result.ok, true)
  assert.equal(result.action.kind, 'terminal')
  assert.match(calls[0][1].join(' '), /codex login/)
  assert.equal(calls[0][2].detached, true)
  assert.equal(unref, true)
})

test('reports when the official configuration terminal cannot open', async () => {
  await assert.rejects(openBackendConfiguration('kimi', {
    env: {},
    platform: 'linux',
    spawnImpl: () => {
      const child = new EventEmitter()
      queueMicrotask(() => child.emit('error', new Error('terminal unavailable')))
      return child
    },
  }), /terminal unavailable/)
})
