const HERMES_INSTALL_COMMAND = 'curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash'

// Static backend metadata lives here so CLI, desktop, runtime setup and the
// Gateway do not maintain parallel lists. Executable behavior stays in backend
// drivers; this catalog describes identity, storage and onboarding only.
const definitions = new Map([
  ['opencode', {
    id: 'opencode',
    label: 'OpenCode',
    workspaceEnvironment: 'OPENCODE_WORKSPACE',
    setup: {
      command: 'opencode',
      executableEnvironment: 'OPENCODE_BIN',
      integration: 'native',
      minimumVersion: '1.18.0',
    },
    lifecycle: {
      installation: { steps: [{ kind: 'npm', package: 'opencode-ai@1.18.5', packageEnv: 'OPENCODE_PACKAGE' }] },
      configuration: { mode: 'bailian-or-backend-owned' },
    },
    onboarding: {
      command: 'opencode auth login',
      hint: '首次使用请完成 OpenCode 官方认证；配置百炼 API Key 与后台模型时可直接使用自动配置。',
      probe: { kind: 'command', args: ['auth', 'list'], parser: 'credential-count' },
    },
    baseUrlEnvironment: 'OPENCODE_BASE_URL',
    defaultBaseUrl: 'http://127.0.0.1:4096',
    supportsFullPermission: true,
    environment: {
      names: [
        'DASHSCOPE_API_KEY',
        'QWEN_AUDIO_AGENT_OPENCODE_ISOLATE_USER_CONFIG',
        'QWEN_AUDIO_AGENT_OPENCODE_XDG_CONFIG_HOME',
      ],
      prefixes: ['OPENCODE_'],
    },
  }],
  ['openclaw', {
    id: 'openclaw',
    label: 'OpenClaw',
    workspaceEnvironment: 'QWEN_AUDIO_AGENT_OPENCLAW_WORKSPACE',
    setup: {
      command: 'openclaw',
      executableEnvironment: 'OPENCLAW_BIN',
      integration: 'bridge',
    },
    lifecycle: {
      installation: { steps: [{ kind: 'npm', package: 'openclaw@2026.6.33', packageEnv: 'OPENCLAW_PACKAGE' }] },
      configuration: { mode: 'bailian-or-backend-owned' },
    },
    onboarding: {
      command: 'openclaw onboard',
      hint: '首次使用请完成 OpenClaw 官方初始化与认证。',
      probe: { kind: 'openclaw-state' },
    },
    baseUrlEnvironment: 'OPENCLAW_BASE_URL',
    defaultBaseUrl: 'http://127.0.0.1:18789',
    supportsExternalService: true,
    externalService: {
      credentialEnvironment: 'OPENCLAW_GATEWAY_TOKEN',
    },
    supportsFullPermission: false,
    environment: {
      names: [
        'DASHSCOPE_API_KEY',
        'AGENT_API_KEY',
        'QWAUDIO_CONFIG_DIR',
        'QWEN_AUDIO_AGENT_OPENCLAW_MODEL',
        'QWEN_AUDIO_AGENT_OPENCLAW_MODEL_ID',
        'QWEN_AUDIO_AGENT_OPENCLAW_STATE_DIR',
        'QWEN_AUDIO_AGENT_OPENCLAW_WORKSPACE',
      ],
      prefixes: ['OPENCLAW_'],
    },
  }],
  ['qoder', {
    id: 'qoder',
    label: 'Qoder',
    workspaceEnvironment: 'QODER_WORKSPACE',
    setup: {
      command: 'qodercli',
      executableEnvironment: ['QODERCLI_PATH', 'QODER_CLI_PATH'],
      integration: 'native',
    },
    lifecycle: {
      installation: { steps: [{ kind: 'npm', package: '@qoder-ai/qodercli@1.1.13', packageEnv: 'QODERCLI_PACKAGE' }] },
      configuration: { mode: 'backend-owned' },
    },
    onboarding: {
      command: 'qodercli login',
      hint: '首次使用请完成 Qoder 官方认证。',
      probe: { kind: 'command', args: ['status'], parser: 'qoder-status' },
    },
    supportsFullPermission: true,
    environment: { prefixes: ['QODER_', 'QODERCLI_'] },
  }],
  ['qwen', {
    id: 'qwen',
    label: 'Qwen Code',
    workspaceEnvironment: 'QWEN_CODE_WORKSPACE',
    setup: {
      command: 'qwen',
      executableEnvironment: 'QWEN_CODE_BIN',
      integration: 'native',
      minimumVersion: '0.21.6',
    },
    lifecycle: {
      installation: { steps: [{ kind: 'npm', package: '@qwen-code/qwen-code@0.21.6', packageEnv: 'QWEN_CODE_PACKAGE' }] },
      configuration: { mode: 'backend-owned' },
    },
    onboarding: {
      command: 'qwen',
      hint: '首次使用请启动 Qwen Code，并通过 /auth 完成认证。',
    },
    supportsFullPermission: true,
    environment: {
      names: ['DASHSCOPE_API_KEY', 'OPENAI_API_KEY', 'OPENAI_BASE_URL'],
      prefixes: ['QWEN_CODE_'],
    },
  }],
  ['kimi', {
    id: 'kimi',
    label: 'Kimi Code',
    workspaceEnvironment: 'KIMI_WORKSPACE',
    setup: {
      command: 'kimi',
      executableEnvironment: 'KIMI_CODE_BIN',
      integration: 'native',
      minimumVersion: '0.31.0',
    },
    lifecycle: {
      installation: { steps: [{ kind: 'npm', package: '@moonshot-ai/kimi-code@0.32.0', packageEnv: 'KIMI_CODE_PACKAGE' }] },
      configuration: { mode: 'backend-owned' },
    },
    onboarding: {
      command: 'kimi login',
      hint: '首次使用请完成 Kimi Code 官方认证，或配置官方 KIMI_MODEL_* 模型变量。',
    },
    supportsFullPermission: true,
    environment: { prefixes: ['KIMI_'] },
  }],
  ['hermes', {
    id: 'hermes',
    label: 'Hermes',
    workspaceEnvironment: 'HERMES_WORKSPACE',
    setup: {
      command: 'hermes',
      executableEnvironment: 'HERMES_BIN',
      integration: 'native',
    },
    lifecycle: {
      installation: {
        steps: [
          { kind: 'script', command: HERMES_INSTALL_COMMAND, platforms: ['darwin', 'linux'] },
          { kind: 'script', command: 'iex (irm https://hermes-agent.nousresearch.com/install.ps1)', platforms: ['win32'] },
        ],
      },
      configuration: { mode: 'backend-owned' },
    },
    onboarding: {
      command: 'hermes setup --portal',
      hint: '首次使用请完成 Hermes 官方认证。',
    },
    supportsFullPermission: true,
    environment: { prefixes: ['HERMES_'] },
  }],
  ['codebuddy', {
    id: 'codebuddy',
    label: 'CodeBuddy',
    workspaceEnvironment: 'CODEBUDDY_WORKSPACE',
    setup: {
      command: 'codebuddy',
      executableEnvironment: 'CODEBUDDY_BIN',
      integration: 'native',
    },
    lifecycle: {
      installation: { steps: [{ kind: 'npm', package: '@tencent-ai/codebuddy-code@2.132.0', packageEnv: 'CODEBUDDY_PACKAGE' }] },
      configuration: { mode: 'backend-owned' },
    },
    onboarding: {
      command: 'codebuddy',
      hint: '首次使用请启动 CodeBuddy，并通过 /login 完成登录。',
      probe: { kind: 'codebuddy-credentials' },
    },
    supportsFullPermission: true,
    environment: { prefixes: ['CODEBUDDY_'] },
  }],
  ['codex', {
    id: 'codex',
    label: 'Codex',
    workspaceEnvironment: 'CODEX_WORKSPACE',
    setup: {
      command: 'codex',
      executableEnvironment: 'CODEX_PATH',
      integration: 'adapter',
      adapterCommand: 'codex-acp',
      adapterEnvironment: 'CODEX_ACP_BIN',
      adapterRuntimeEnvironment: 'CODEX_ACP_RUNTIME',
    },
    lifecycle: {
      installation: {
        steps: [
          { kind: 'npm', package: '@openai/codex@0.146.0', packageEnv: 'CODEX_PACKAGE' },
          { kind: 'npm', label: 'ACP 适配器', component: 'adapter', package: '@agentclientprotocol/codex-acp@1.1.7', packageEnv: 'CODEX_ACP_PACKAGE' },
        ],
      },
      configuration: { mode: 'backend-owned' },
    },
    onboarding: {
      command: 'codex login',
      hint: '首次使用请完成 Codex 官方认证。',
      probe: { kind: 'command', args: ['login', 'status'], parser: 'codex-status' },
    },
    supportsFullPermission: true,
    environment: {
      names: ['DASHSCOPE_API_KEY', 'OPENAI_API_KEY', 'OPENAI_BASE_URL'],
      prefixes: ['CODEX_'],
    },
  }],
  ['claude', {
    id: 'claude',
    label: 'Claude Code',
    workspaceEnvironment: 'CLAUDE_WORKSPACE',
    setup: {
      command: 'claude',
      executableEnvironment: 'CLAUDE_CODE_EXECUTABLE',
      integration: 'adapter',
      adapterCommand: 'claude-code-acp',
      adapterEnvironment: 'CLAUDE_CODE_ACP_BIN',
      adapterRuntimeEnvironment: 'CLAUDE_CODE_ACP_RUNTIME',
    },
    lifecycle: {
      installation: {
        steps: [
          { kind: 'npm', package: '@anthropic-ai/claude-code@2.1.221', packageEnv: 'CLAUDE_CODE_PACKAGE' },
          { kind: 'npm', label: 'ACP 适配器', component: 'adapter', package: '@zed-industries/claude-code-acp@0.16.2', packageEnv: 'CLAUDE_CODE_ACP_PACKAGE' },
        ],
      },
      configuration: { mode: 'backend-owned' },
    },
    onboarding: {
      command: 'claude',
      hint: '首次使用请完成 Claude Code 官方认证。',
    },
    supportsFullPermission: true,
    environment: {
      names: ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'CLAUDE_API_KEY'],
      prefixes: ['CLAUDE_'],
    },
  }],
  ['deepseek', {
    id: 'deepseek',
    label: 'DeepSeek',
    workspaceEnvironment: 'DEEPSEEK_HARNESS_WORKSPACE',
    setup: {
      command: 'dsh',
      executableEnvironment: 'DEEPSEEK_HARNESS_BIN',
      integration: 'native',
      adapterCommand: 'dsh-acp-demo',
      adapterEnvironment: 'DEEPSEEK_HARNESS_ACP_BIN',
      adapterRuntimeEnvironment: 'DEEPSEEK_HARNESS_ACP_RUNTIME',
      managedAdapterFallback: false,
      inspectAdapterIndependently: true,
    },
    lifecycle: {
      installation: {
        verifyInstalledPackages: true,
        // Keep the ACP executable package last. If an earlier Developer
        // Preview component fails, setup remains visibly incomplete and a
        // retry fills the whole composition instead of skipping it.
        steps: [
          {
            kind: 'npm',
            label: 'DeepSeek CLI',
            component: 'backend',
            package: '@deepseek-ai/dsh@0.1.0-rc.6',
            registry: 'https://registry.npmjs.org/',
          },
          ...[
          '@deepseek-ai/dsh-llm-deepseek@0.1.0-rc.6',
          '@deepseek-ai/dsh-sandbox-local@0.1.0-rc.6',
          '@deepseek-ai/dsh-subprocess-local@0.1.0-rc.6',
          '@deepseek-ai/dsh-bash-sandbox@0.1.0-rc.6',
          '@deepseek-ai/dsh-token-meter@0.1.0-rc.6',
          '@deepseek-ai/dsh-compaction-basic@0.1.0-rc.6',
          '@deepseek-ai/dsh-fs-sandbox@0.1.0-rc.6',
          '@deepseek-ai/dsh-fs-observation-policy@0.1.0-rc.6',
          '@deepseek-ai/dsh-tool-fs@0.1.0-rc.6',
          '@deepseek-ai/dsh-acp-demo@0.1.0-rc.6',
          ].map((packageName, index, packages) => ({
          kind: 'npm',
          label: index === packages.length - 1 ? 'ACP Runtime' : '运行组件',
          component: 'adapter',
          package: packageName,
          registry: 'https://registry.npmjs.org/',
          })),
        ],
      },
      configuration: { mode: 'backend-owned' },
    },
    onboarding: {
      command: 'dsh web',
      hint: '请在 DeepSeek Web 的“设置 → Models”中为 deepseek-official 填写并保存 DEEPSEEK_API_KEY；仅打开 Web 不代表配置完成。',
      probe: { kind: 'deepseek-credentials' },
    },
    supportsFullPermission: true,
    environment: {
      names: ['DEEPSEEK_API_KEY'],
      prefixes: ['DEEPSEEK_', 'DSH_'],
    },
  }],
  ['acp', {
    id: 'acp',
    label: 'ACP Agent',
    workspaceEnvironment: 'ACP_WORKSPACE',
    setup: {
      commandEnvironment: 'ACP_COMMAND',
      integration: 'generic',
    },
    lifecycle: {
      installation: null,
      configuration: { mode: 'user-managed' },
    },
    supportsFullPermission: false,
    environment: {
      prefixes: ['ACP_'],
      explicitListEnvironment: 'QWEN_AUDIO_AGENT_ACP_FORWARD_ENV',
    },
  }],
])

export function backendDefinition(protocol) {
  return definitions.get(normalizeBackendProtocol(protocol)) || null
}

export function backendNames() {
  return [...definitions.keys()]
}

export function backendDefinitions() {
  return [...definitions.values()]
}

export function resolveBackendOwnership(protocol, {
  baseUrlConfigured = false,
  requestedOwnership = '',
} = {}) {
  const definition = backendDefinition(protocol)
  if (!definition) throw new Error(`不支持的后台 Agent：${protocol}`)
  const requested = String(requestedOwnership || '').trim().toLowerCase()
  if (requested && !['owned', 'external'].includes(requested)) {
    throw new Error(`不支持的后台进程归属：${requested}`)
  }
  if (requested === 'external' && !definition.supportsExternalService) {
    throw new Error(`${definition.label} 不支持连接外部后台服务`)
  }
  if (requested) return requested
  return definition.supportsExternalService && baseUrlConfigured
    ? 'external'
    : 'owned'
}

export function normalizeBackendProtocol(value) {
  const protocol = String(value || '').trim().toLowerCase()
  return protocol === 'none' ? '' : protocol
}
