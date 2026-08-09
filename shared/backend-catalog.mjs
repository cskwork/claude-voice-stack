const definitions = new Map([
  ['opencode', {
    id: 'opencode',
    label: 'OpenCode',
    baseUrlEnvironment: 'OPENCODE_BASE_URL',
    defaultBaseUrl: 'http://127.0.0.1:4096',
    supportsFullPermission: true,
  }],
  ['openclaw', {
    id: 'openclaw',
    label: 'OpenClaw',
    baseUrlEnvironment: 'OPENCLAW_BASE_URL',
    defaultBaseUrl: 'http://127.0.0.1:18789',
    supportsExternalService: true,
    supportsFullPermission: false,
  }],
  ['qoder', {
    id: 'qoder',
    label: 'Qoder',
    supportsFullPermission: true,
  }],
  ['kimi', {
    id: 'kimi',
    label: 'Kimi Code',
    supportsFullPermission: true,
  }],
  ['hermes', {
    id: 'hermes',
    label: 'Hermes',
    supportsFullPermission: true,
  }],
  ['codebuddy', {
    id: 'codebuddy',
    label: 'CodeBuddy',
    supportsFullPermission: true,
  }],
  ['codex', {
    id: 'codex',
    label: 'Codex',
    supportsFullPermission: true,
  }],
  ['claude', {
    id: 'claude',
    label: 'Claude Code',
    supportsFullPermission: true,
  }],
  ['acp', {
    id: 'acp',
    label: 'ACP Agent',
    supportsFullPermission: false,
  }],
])

export function backendDefinition(protocol) {
  return definitions.get(normalizeBackendProtocol(protocol)) || null
}

export function backendNames() {
  return [...definitions.keys()]
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
