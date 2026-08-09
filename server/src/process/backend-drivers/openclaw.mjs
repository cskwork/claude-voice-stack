import {
  applyLocalAddress,
  localManagedBackend,
} from './shared.mjs'

export const openClawRuntimeDriver = {
  id: 'openclaw',
  separateManagedProcess: true,
  managedScript: 'openclaw-gateway.mjs',
  managedNpmScript: 'openclaw',

  resolveOwnership({ env }) {
    const requested = String(
      env.QWEN_AUDIO_AGENT_BACKEND_OWNERSHIP || '',
    ).trim().toLowerCase()
    if (requested) {
      if (!['owned', 'external'].includes(requested)) {
        throw new Error(`不支持的 OpenClaw 后台进程归属：${requested}`)
      }
      return requested
    }
    return String(env.OPENCLAW_BASE_URL || '').trim()
      ? 'external'
      : 'owned'
  },

  resolve({ env, ownership, permissionMode }) {
    if (permissionMode === 'full') {
      throw new Error(
        'OpenClaw 的最高权限需要单独配置 exec approvals、elevated 和 host，'
        + '不能由 Gateway 的统一权限开关安全启用',
      )
    }
    return localManagedBackend({
      id: this.id,
      env,
      ownership,
      permissionMode,
      baseUrlEnvironment: 'OPENCLAW_BASE_URL',
      defaultBaseUrl: 'http://127.0.0.1:18789',
    })
  },

  applyAddress(env, backend) {
    applyLocalAddress(env, backend, {
      baseUrlEnvironment: 'OPENCLAW_BASE_URL',
      portEnvironment: 'OPENCLAW_PORT',
    })
  },
}
