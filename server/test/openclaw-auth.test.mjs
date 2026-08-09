import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  isPortableOpenClawCredential,
  prepareIsolatedOpenClawState,
  seedPortableOpenClawAuthProfiles,
} from '../src/process/backend-drivers/openclaw-auth.mjs'

function stateFixture(t, agents = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'qwen-audio-agent-openclaw-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const userState = join(directory, 'user-state')
  const runtimeState = join(directory, 'runtime-state')
  mkdirSync(runtimeState, { recursive: true })
  for (const [agentId, store] of Object.entries(agents)) {
    const agentDir = join(userState, 'agents', agentId, 'agent')
    mkdirSync(agentDir, { recursive: true })
    writeFileSync(join(agentDir, 'auth-profiles.json'), JSON.stringify(store))
  }
  return { directory, userState, runtimeState }
}

test('classifies credential portability with the OpenClaw agent-copy policy', () => {
  assert.equal(isPortableOpenClawCredential({ type: 'api_key', provider: 'qwen', key: 'k' }), true)
  assert.equal(isPortableOpenClawCredential({ type: 'token', provider: 'qwen', token: 't' }), true)
  // Explicit opt-out always wins.
  assert.equal(
    isPortableOpenClawCredential({ type: 'api_key', provider: 'qwen', copyToAgents: false }),
    false,
  )
  // OAuth refresh material is not portable by default.
  assert.equal(
    isPortableOpenClawCredential({
      type: 'oauth', provider: 'qwen', access: 'a', refresh: 'r',
    }),
    false,
  )
  // Provider opt-in only counts with inline access/refresh material.
  assert.equal(
    isPortableOpenClawCredential({
      type: 'oauth', provider: 'qwen', access: 'a', refresh: 'r', copyToAgents: true,
    }),
    true,
  )
  assert.equal(
    isPortableOpenClawCredential({ type: 'oauth', provider: 'qwen', copyToAgents: true }),
    false,
  )
  // Unknown types, missing providers and non-objects never travel.
  assert.equal(isPortableOpenClawCredential({ type: 'aws-sdk', provider: 'aws' }), false)
  assert.equal(isPortableOpenClawCredential({ type: 'api_key' }), false)
  assert.equal(isPortableOpenClawCredential(null), false)
})

test('seeds only portable credentials into the isolated agent store', t => {
  const { userState, runtimeState } = stateFixture(t, {
    main: {
      version: 2,
      profiles: {
        'qwen:default': { type: 'api_key', provider: 'qwen', key: 'sk-static' },
        'openai:oauth': { type: 'oauth', provider: 'openai', access: 'a', refresh: 'r' },
        'optout:key': { type: 'api_key', provider: 'x', key: 'k', copyToAgents: false },
      },
    },
  })

  const result = seedPortableOpenClawAuthProfiles({
    userStateDirectory: userState,
    runtimeStateDirectory: runtimeState,
  })

  assert.deepEqual(result, { seeded: ['main'], skipped: [] })
  const targetPath = join(runtimeState, 'agents/main/agent/auth-profiles.json')
  const store = JSON.parse(readFileSync(targetPath, 'utf8'))
  assert.equal(store.version, 2)
  assert.deepEqual(Object.keys(store.profiles), ['qwen:default'])
  if (process.platform !== 'win32') {
    assert.equal(statSync(targetPath).mode & 0o777, 0o600)
  }
})

test('keeps the legacy flat store shape when seeding', t => {
  const { userState, runtimeState } = stateFixture(t, {
    main: {
      'qwen:default': { type: 'token', provider: 'qwen', token: 'static' },
      'oauth:one': { type: 'oauth', provider: 'openai', access: 'a', refresh: 'r' },
    },
  })

  seedPortableOpenClawAuthProfiles({
    userStateDirectory: userState,
    runtimeStateDirectory: runtimeState,
  })

  const store = JSON.parse(readFileSync(
    join(runtimeState, 'agents/main/agent/auth-profiles.json'),
    'utf8',
  ))
  assert.deepEqual(Object.keys(store), ['qwen:default'])
  assert.equal(store['qwen:default'].token, 'static')
})

test('never overwrites credentials the isolated instance already owns', t => {
  const { userState, runtimeState } = stateFixture(t, {
    main: {
      profiles: { 'qwen:default': { type: 'api_key', provider: 'qwen', key: 'user' } },
    },
  })
  const targetDir = join(runtimeState, 'agents/main/agent')
  mkdirSync(targetDir, { recursive: true })
  writeFileSync(
    join(targetDir, 'auth-profiles.json'),
    JSON.stringify({ profiles: { own: { type: 'api_key', provider: 'own', key: 'mine' } } }),
  )

  const result = seedPortableOpenClawAuthProfiles({
    userStateDirectory: userState,
    runtimeStateDirectory: runtimeState,
  })

  assert.deepEqual(result, { seeded: [], skipped: [] })
  const store = JSON.parse(readFileSync(join(targetDir, 'auth-profiles.json'), 'utf8'))
  assert.deepEqual(Object.keys(store.profiles), ['own'])
})

test('writes nothing when no credential in a store is portable', t => {
  const { userState, runtimeState } = stateFixture(t, {
    main: {
      profiles: {
        'oauth:one': { type: 'oauth', provider: 'openai', access: 'a', refresh: 'r' },
      },
    },
  })

  const result = seedPortableOpenClawAuthProfiles({
    userStateDirectory: userState,
    runtimeStateDirectory: runtimeState,
  })

  assert.deepEqual(result, { seeded: [], skipped: ['main'] })
  assert.equal(
    existsSync(join(runtimeState, 'agents/main/agent/auth-profiles.json')),
    false,
  )
})

test('handles multiple agents and missing or broken stores gracefully', t => {
  const { userState, runtimeState } = stateFixture(t, {
    main: {
      profiles: { 'qwen:default': { type: 'api_key', provider: 'qwen', key: 'k' } },
    },
    coder: {
      profiles: { 'openai:key': { type: 'api_key', provider: 'openai', key: 'k2' } },
    },
  })
  // An agent directory without auth-profiles.json is simply skipped.
  mkdirSync(join(userState, 'agents/empty/agent'), { recursive: true })
  // A corrupt store must not break the launch for the remaining agents.
  const brokenDir = join(userState, 'agents/broken/agent')
  mkdirSync(brokenDir, { recursive: true })
  writeFileSync(join(brokenDir, 'auth-profiles.json'), '{not-json')

  const result = seedPortableOpenClawAuthProfiles({
    userStateDirectory: userState,
    runtimeStateDirectory: runtimeState,
  })

  assert.deepEqual(result.seeded.sort(), ['coder', 'main'])
  assert.deepEqual(result.skipped, ['broken'])
})

test('does nothing without a source state or when source equals target', t => {
  const { runtimeState } = stateFixture(t)
  assert.deepEqual(
    seedPortableOpenClawAuthProfiles({
      userStateDirectory: join(runtimeState, 'missing'),
      runtimeStateDirectory: runtimeState,
    }),
    { seeded: [], skipped: [] },
  )
  assert.deepEqual(
    seedPortableOpenClawAuthProfiles({
      userStateDirectory: runtimeState,
      runtimeStateDirectory: runtimeState,
    }),
    { seeded: [], skipped: [] },
  )
})

test('prepareIsolatedOpenClawState isolates the config and seeds credentials together', t => {
  const { userState, runtimeState } = stateFixture(t, {
    main: {
      profiles: { 'qwen:default': { type: 'api_key', provider: 'qwen', key: 'k' } },
    },
  })
  writeFileSync(
    join(userState, 'openclaw.json'),
    JSON.stringify({
      gateway: { auth: { token: 'tok' } },
      channels: { telegram: {} },
    }),
  )

  const { config, auth } = prepareIsolatedOpenClawState({
    sourcePath: join(userState, 'openclaw.json'),
    targetPath: join(runtimeState, 'openclaw.json'),
  })

  assert.equal(config, true)
  assert.deepEqual(auth, { seeded: ['main'], skipped: [] })
  const isolated = JSON.parse(readFileSync(join(runtimeState, 'openclaw.json'), 'utf8'))
  // Channels stay behind; the credential seed lands next to the config.
  assert.equal(isolated.channels, undefined)
  assert.equal(
    existsSync(join(runtimeState, 'agents/main/agent/auth-profiles.json')),
    true,
  )
})

test('prepareIsolatedOpenClawState does not seed when the config cannot be isolated', t => {
  const { userState, runtimeState } = stateFixture(t, {
    main: {
      profiles: { 'qwen:default': { type: 'api_key', provider: 'qwen', key: 'k' } },
    },
  })

  const { config, auth } = prepareIsolatedOpenClawState({
    sourcePath: join(userState, 'missing.json'),
    targetPath: join(runtimeState, 'openclaw.json'),
  })

  assert.equal(config, false)
  assert.deepEqual(auth, { seeded: [], skipped: [] })
  assert.equal(
    existsSync(join(runtimeState, 'agents/main/agent/auth-profiles.json')),
    false,
  )
})
