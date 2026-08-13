import { spawn } from 'node:child_process'
import { backendConfigurationAction } from '../../shared/backend-onboarding.mjs'

function appleScriptString(value) {
  return `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

export function configurationLaunch(id, {
  env = process.env,
  platform = process.platform,
} = {}) {
  const action = backendConfigurationAction(id, { env, platform })
  if (!action || action.kind !== 'terminal') return null
  const command = action.command
  if (platform === 'darwin') {
    return {
      action,
      command: '/usr/bin/osascript',
      args: [
        '-e', 'tell application "Terminal"',
        '-e', 'activate',
        '-e', `do script ${appleScriptString(command)}`,
        '-e', 'end tell',
      ],
    }
  }
  if (platform === 'win32') {
    return {
      action,
      command: 'cmd.exe',
      args: ['/d', '/c', 'start', '', 'cmd.exe', '/k', command],
    }
  }
  return {
    action,
    command: 'x-terminal-emulator',
    args: ['-e', 'sh', '-lc', `${command}; exec "\${SHELL:-/bin/sh}" -l`],
  }
}

export async function openBackendConfiguration(id, {
  env = process.env,
  platform = process.platform,
  spawnImpl = spawn,
} = {}) {
  const launch = configurationLaunch(id, { env, platform })
  if (!launch) throw new Error('该后台 Agent 没有可用的配置入口')
  const child = spawnImpl(launch.command, launch.args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  })
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref?.()
      resolve({ ok: true, action: launch.action })
    })
  })
}
