import {
  copyFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { resolve } from 'node:path'

// 桌面版与 CLI 共享同一份资产（配置、身份、记忆、清单，QWAUDIO_DATA_DIR
// 指向 CLI 的 ~/.config/qwaudio）；运行时状态（gateway.lock、tasks.json、
// state/、logs/、皮肤等）仍留在桌面版自己的 Electron 数据目录，互不干扰。
// tasks.json 属运行时状态，不参与共享与回填。
const SHARED_ASSET_FILES = [
  'config.env',
  'state.env',
  'ASSISTANT.md',
  'USER.md',
  'MEMORY.md',
  'frontend-memory.json',
  'frontend-notes.json',
]
const BACKFILL_MARKER = 'shared-assets-backfill.json'

export function resolveDesktopConfigDirectory({ env, userDataDirectory }) {
  if (env.QWAUDIO_CONFIG_DIR) return resolve(env.QWAUDIO_CONFIG_DIR)
  return resolve(userDataDirectory)
}

// 旧版本桌面版曾把资产复制到自己的目录并各自演化。切换到共享资产层时，
// 把桌面侧仍较新的资产一次性回填到共享目录：被覆盖的共享侧文件先备份为
// <名称>.pre-merge.bak；state.env 是本地身份，共享侧已存在时保留（桌面侧
// 的签名作废，重新签发即可）。幂等：桌面目录写入回填标记后不再执行。
export function backfillSharedAssets({ desktopDir, dataDir }) {
  if (!desktopDir || !dataDir) {
    return { backfilled: false, reason: 'missing-directories' }
  }
  const source = resolve(desktopDir)
  const target = resolve(dataDir)
  if (source === target) return { backfilled: false, reason: 'same-directory' }
  const markerPath = resolve(source, BACKFILL_MARKER)
  if (existsSync(markerPath)) {
    return { backfilled: false, reason: 'already-backfilled' }
  }
  mkdirSync(target, { recursive: true, mode: 0o700 })
  const copied = []
  const skipped = []
  for (const name of SHARED_ASSET_FILES) {
    const from = resolve(source, name)
    if (!existsSync(from)) continue
    const to = resolve(target, name)
    if (existsSync(to)) {
      if (name === 'state.env') {
        skipped.push(name)
        continue
      }
      if (statSync(to).mtimeMs >= statSync(from).mtimeMs) {
        skipped.push(name)
        continue
      }
      copyFileSync(to, `${to}.pre-merge.bak`)
      chmodSync(`${to}.pre-merge.bak`, 0o600)
    }
    copyFileSync(from, to)
    chmodSync(to, 0o600)
    copied.push(name)
  }
  mkdirSync(source, { recursive: true, mode: 0o700 })
  writeFileSync(
    markerPath,
    `${JSON.stringify({
      dataDir: target,
      backfilledAt: new Date().toISOString(),
      copied,
      skipped,
    }, null, 2)}\n`,
    'utf8',
  )
  return { backfilled: copied.length > 0, copied, skipped }
}
