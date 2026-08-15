import { backendDefinition } from './backend-catalog.mjs'

// Configuration belongs to the backend onboarding adapter, not to the shared
// UI. Most current agents expose a trusted terminal entry; future adapters can
// return browser/form/instructions without teaching the UI product names.
const configurationAdapters = new Map([
  ['opencode', {
    command: 'opencode auth login',
    hint: '首次使用请完成 OpenCode 官方认证；配置百炼 API Key 与后台模型时可直接使用自动配置。',
    probe: { kind: 'command', args: ['auth', 'list'], parser: 'credential-count' },
  }],
  ['openclaw', {
    command: 'openclaw onboard',
    hint: '首次使用请完成 OpenClaw 官方初始化与认证。',
    probe: { kind: 'openclaw-state' },
  }],
  ['qoder', {
    command: 'qodercli login',
    hint: '首次使用请完成 Qoder 官方认证。',
    probe: { kind: 'command', args: ['status'], parser: 'qoder-status' },
  }],
  ['qwen', {
    command: 'qwen',
    hint: '首次使用请启动 Qwen Code，并通过 /auth 完成认证。',
  }],
  ['kimi', {
    command: 'kimi login',
    hint: '首次使用请完成 Kimi Code 官方认证，或配置官方 KIMI_MODEL_* 模型变量。',
  }],
  ['hermes', {
    command: 'hermes setup --portal',
    hint: '首次使用请完成 Hermes 官方认证。',
  }],
  ['codebuddy', {
    command: 'codebuddy',
    hint: '首次使用请启动 CodeBuddy，并通过 /login 完成登录。',
    probe: { kind: 'codebuddy-credentials' },
  }],
  ['codex', {
    command: 'codex login',
    hint: '首次使用请完成 Codex 官方认证。',
    probe: { kind: 'command', args: ['login', 'status'], parser: 'codex-status' },
  }],
  ['claude', {
    command: 'claude',
    hint: '首次使用请完成 Claude Code 官方认证。',
  }],
  ['deepseek', {
    command: 'dsh web',
    hint: '请在 DeepSeek Web 的“设置 → Models”中为 deepseek-official 填写并保存 DEEPSEEK_API_KEY；仅打开 Web 不代表配置完成。',
    probe: { kind: 'deepseek-credentials' },
  }],
])

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

// Unified onboarding contract consumed by CLI and desktop. A backend owns the
// details of configuration; callers only render and invoke trusted actions.
// More action kinds (browser/form/instructions) can be added without changing
// the settings UI lifecycle.
export function backendOnboardingAdapter(id, {
  env = process.env,
  platform = process.platform,
} = {}) {
  const definition = backendDefinition(id)
  const lifecycle = definition?.lifecycle || null
  const adapter = configurationAdapters.get(definition?.id) || null
  const command = clean(adapter?.command)
  const automatic = usesAutomaticBailianConfiguration(definition?.id, env)
  const supportedPlatform = ['darwin', 'linux', 'win32'].includes(platform)
  const action = command && !automatic
    ? {
        id: 'configure',
        kind: 'terminal',
        label: '配置',
        command,
        hint: clean(adapter?.hint),
      }
    : null

  return {
    id: definition?.id || clean(id),
    installation: lifecycle?.installation || null,
    configuration: {
      ...(lifecycle?.configuration || { mode: 'user-managed' }),
      automatic,
      action: action && supportedPlatform ? action : null,
      probe: adapter?.probe || null,
    },
  }
}

export function backendConfigurationAction(id, options) {
  return backendOnboardingAdapter(id, options).configuration.action
}

export function resolveBackendOnboarding(item, {
  installation,
  configuration,
} = {}) {
  const installed = item?.ready === true
  const configurationRequired = configuration?.required === true
  let state = 'not-installed'
  if (installed && configurationRequired) state = 'configuration-required'
  else if (installed) state = 'installed'

  return {
    state,
    installation: {
      ...installation,
      status: installed ? 'installed' : 'not-installed',
    },
    configuration,
    // Runtime readiness is measured by the live connection, never inferred
    // from installation or local credential files.
    readiness: { status: 'not-connected' },
  }
}
