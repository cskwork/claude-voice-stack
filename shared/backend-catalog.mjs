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
    supportsExternalGateway: true,
    supportsFullPermission: false,
  }],
  ['qoder', {
    id: 'qoder',
    label: 'Qoder',
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
  return definitions.get(String(protocol || '').trim().toLowerCase()) || null
}

export function backendNames() {
  return [...definitions.keys()]
}
