import { backendDefinition } from './backend-catalog.mjs'

export function backendLifecycleSpec(id) {
  const definition = backendDefinition(id)
  return definition?.lifecycle || null
}

export function backendConfigurationSupport(id) {
  return backendLifecycleSpec(id)?.configuration || { mode: 'user-managed' }
}

function clean(value) {
  return String(value || '').trim()
}

function usesAutomaticBailianConfiguration(id, env) {
  const model = clean(env.QWEN_AUDIO_AGENT_BACKEND_MODEL).toLowerCase()
  return (
    ['opencode', 'openclaw'].includes(id)
    && Boolean(clean(env.DASHSCOPE_API_KEY))
    && Boolean(model)
    && model !== 'auto'
  )
}

// 认证由后台 Agent 自己完成。这里仅描述是否存在可信的官方入口；
// OpenCode/OpenClaw 使用项目自动百炼配置时不再要求额外登录。
export function backendAuthenticationSupport(id, {
  env = process.env,
  platform = process.platform,
} = {}) {
  const definition = backendDefinition(id)
  const spec = definition ? backendLifecycleSpec(definition.id) : null
  const command = clean(spec?.authentication?.command)
  if (!command || usesAutomaticBailianConfiguration(definition?.id, env)) {
    return { required: false, supported: false }
  }
  return {
    required: true,
    supported: ['darwin', 'linux', 'win32'].includes(platform),
    command,
  }
}

export function resolveBackendLifecycle(item, {
  installation,
  configuration,
  authentication,
} = {}) {
  const installed = item?.ready === true
  let state = 'not-installed'
  if (installed && authentication?.required === true) {
    state = 'authentication-required'
  } else if (installed) {
    state = 'installed'
  }
  return {
    state,
    installation: {
      ...installation,
      status: installed ? 'installed' : 'not-installed',
    },
    configuration,
    authentication,
    // “已就绪”是运行时事实，不能由安装或认证状态推断。
    readiness: { status: 'not-connected' },
  }
}
