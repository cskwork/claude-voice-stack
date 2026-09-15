import { backendDriver } from '../../../server/src/backend/adapters/acp/drivers/registry.mjs'

export const VOICE_BACKENDS = ['claude', 'codex', 'pi']

export function voiceBackend(protocol, env = {}) {
  if (!VOICE_BACKENDS.includes(protocol)) return null
  const driver = backendDriver(protocol)
  const executable = {
    claude: env.CLAUDE_CODE_EXECUTABLE || 'claude',
    codex: env.CODEX_PATH || 'codex',
    pi: env.PI_ACP_PI_COMMAND || env.PI_BIN || 'pi',
  }[protocol]
  return {
    id: protocol,
    label: driver.label,
    executable,
    launcher: `scripts/runtime/${protocol === 'claude' ? 'claude-code' : protocol}-acp.mjs`,
    permissions: driver.capabilities.permissions,
  }
}

// Forward the validated defaults too: upstream otherwise defaults to OpenClaw
// when AGENT_PROTOCOL is absent or blank. Shell values have already won here.
export function gatewayEnvironment(config, env) {
  return {
    ...env,
    AGENT_PROTOCOL: config.agentProtocol,
    QWEN_AUDIO_AGENT_BACKEND_PERMISSION_MODE: config.permissionMode,
  }
}

export function backendHealth(protocol, local, gateway) {
  const label = voiceBackend(protocol)?.label || protocol
  const component = { label: 'Backend', ...local, detail: `${label}; ${local.detail}` }
  if (gateway.state !== 'ready' || !gateway.backend) return component
  const actual = gateway.backend.protocol
  if (actual !== protocol) {
    return {
      ...component,
      state: 'degraded',
      detail: `Gateway backend ${actual || 'unknown'}; configured ${label}. Run voice-agent stop, then start.`,
    }
  }
  return {
    ...component,
    state: local.state === 'failed' ? 'failed' : gateway.backend.ok === true ? 'ready' : 'degraded',
    detail: `${label} via Gateway (${gateway.backend.ok === true ? 'connected' : 'not connected'}); ${local.detail}`,
  }
}
