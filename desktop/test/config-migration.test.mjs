import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import {
  backfillSharedAssets,
  resolveDesktopConfigDirectory,
} from '../src/config-migration.mjs'

function withDirectories(fn) {
  const root = mkdtempSync(join(tmpdir(), 'qwaudio-config-migration-'))
  const desktopDir = join(root, 'desktop')
  const dataDir = join(root, 'shared')
  try {
    return fn({ desktopDir, dataDir })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function seed(directory, name, content) {
  mkdirSync(directory, { recursive: true })
  const path = join(directory, name)
  writeFileSync(path, content, 'utf8')
  return path
}

test('prefers QWAUDIO_CONFIG_DIR over the Electron userData directory', () => {
  const override = '/tmp/qwaudio-profile'
  assert.equal(
    resolveDesktopConfigDirectory({
      env: { QWAUDIO_CONFIG_DIR: override },
      userDataDirectory: '/home/user/.config/Qwen Audio Agent',
    }),
    resolve(override),
  )
})

test('falls back to the Electron userData directory without override', () => {
  assert.equal(
    resolveDesktopConfigDirectory({
      env: {},
      userDataDirectory: '/home/user/.config/Qwen Audio Agent',
    }),
    resolve('/home/user/.config/Qwen Audio Agent'),
  )
})

test('never overwrites an existing shared asset', () => {
  withDirectories(({ desktopDir, dataDir }) => {
    seed(desktopDir, 'MEMORY.md', '# MEMORY desktop\n')
    seed(dataDir, 'MEMORY.md', '# MEMORY cli\n')
    const result = backfillSharedAssets({ desktopDir, dataDir })
    assert.equal(result.backfilled, false)
    assert.deepEqual(result.copied, [])
    assert.deepEqual(result.skipped, ['MEMORY.md'])
    assert.equal(
      readFileSync(join(dataDir, 'MEMORY.md'), 'utf8'),
      '# MEMORY cli\n',
    )
  })
})

test('does not use timestamps to choose between two user assets', () => {
  withDirectories(({ desktopDir, dataDir }) => {
    seed(desktopDir, 'config.env', 'DASHSCOPE_API_KEY=sk-desktop\n')
    seed(dataDir, 'config.env', 'DASHSCOPE_API_KEY=sk-cli\n')
    const result = backfillSharedAssets({ desktopDir, dataDir })
    assert.equal(result.backfilled, false)
    assert.deepEqual(result.skipped, ['config.env'])
    assert.equal(
      readFileSync(join(dataDir, 'config.env'), 'utf8'),
      'DASHSCOPE_API_KEY=sk-cli\n',
    )
  })
})

test('never overwrites an existing shared state.env identity', () => {
  withDirectories(({ desktopDir, dataDir }) => {
    seed(desktopDir, 'state.env', 'QWEN_AUDIO_AGENT_AUTH_SECRET=desktop\n')
    seed(dataDir, 'state.env', 'QWEN_AUDIO_AGENT_AUTH_SECRET=cli\n')
    const result = backfillSharedAssets({ desktopDir, dataDir })
    assert.deepEqual(result.skipped, ['state.env'])
    assert.equal(
      readFileSync(join(dataDir, 'state.env'), 'utf8'),
      'QWEN_AUDIO_AGENT_AUTH_SECRET=cli\n',
    )
  })
})

test('copies desktop assets missing from the shared directory', () => {
  withDirectories(({ desktopDir, dataDir }) => {
    seed(desktopDir, 'USER.md', '# USER desktop\n')
    seed(desktopDir, 'tasks.json', '{"version":1}\n')
    const result = backfillSharedAssets({ desktopDir, dataDir })
    assert.deepEqual(result.copied, ['USER.md'])
    assert.equal(
      readFileSync(join(dataDir, 'USER.md'), 'utf8'),
      '# USER desktop\n',
    )
    // tasks.json 是运行时状态，永不参与共享回填。
    assert.equal(existsSync(join(dataDir, 'tasks.json')), false)
  })
})

test('moves an old desktop workspace only when the shared workspace is absent', () => {
  withDirectories(({ desktopDir, dataDir }) => {
    seed(join(desktopDir, 'workspace'), 'notes.txt', 'desktop workspace\n')
    const result = backfillSharedAssets({ desktopDir, dataDir })
    assert.deepEqual(result.copied, ['workspace'])
    assert.equal(
      readFileSync(join(dataDir, 'workspace/notes.txt'), 'utf8'),
      'desktop workspace\n',
    )
  })
})

test('keeps both workspaces intact when a shared workspace already exists', () => {
  withDirectories(({ desktopDir, dataDir }) => {
    seed(join(desktopDir, 'workspace'), 'desktop.txt', 'desktop\n')
    seed(join(dataDir, 'workspace'), 'cli.txt', 'cli\n')
    const result = backfillSharedAssets({ desktopDir, dataDir })
    assert.deepEqual(result.skipped, ['workspace'])
    assert.equal(existsSync(join(dataDir, 'workspace/desktop.txt')), false)
    assert.equal(readFileSync(join(dataDir, 'workspace/cli.txt'), 'utf8'), 'cli\n')
    assert.equal(readFileSync(join(desktopDir, 'workspace/desktop.txt'), 'utf8'), 'desktop\n')
  })
})

test('runs exactly once per desktop directory', () => {
  withDirectories(({ desktopDir, dataDir }) => {
    seed(desktopDir, 'MEMORY.md', '# MEMORY desktop\n')
    const first = backfillSharedAssets({ desktopDir, dataDir })
    assert.equal(first.backfilled, true)
    seed(desktopDir, 'USER.md', '# USER late\n')
    const again = backfillSharedAssets({ desktopDir, dataDir })
    assert.equal(again.backfilled, false)
    assert.equal(again.reason, 'already-backfilled')
    assert.equal(existsSync(join(dataDir, 'USER.md')), false)
  })
})

test('skips when the desktop and shared directories are the same', () => {
  withDirectories(({ desktopDir }) => {
    const result = backfillSharedAssets({
      desktopDir,
      dataDir: desktopDir,
    })
    assert.equal(result.backfilled, false)
    assert.equal(result.reason, 'same-directory')
  })
})
