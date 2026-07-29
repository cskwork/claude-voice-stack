import { resolve } from 'node:path'
import { baseEnvironment, clean } from './shared.mjs'

export const claudeBackendDriver = {
  id: 'claude',
  label: 'Claude Code',

  resolveOptions(options) {
    return {
      baseUrl: '',
      model: '',
      directory: options.claudeDirectory,
      cliPath: options.claudeCliPath,
      claudeExecutable: options.claudeExecutable,
      configDirectory: options.claudeConfigDirectory,
      coordinatorAgent: options.coordinatorAgent,
    }
  },

  createProfile({
    root,
    directory,
    cliPath,
    claudeExecutable,
    configDirectory,
  }) {
    return {
      label: this.label,
      command: cliPath || resolve(root, 'scripts/claude-code-acp'),
      args: [],
      cwd: directory,
      env: {
        ...baseEnvironment(),
        ...(clean(claudeExecutable)
          ? { CLAUDE_CODE_EXECUTABLE: clean(claudeExecutable) }
          : {}),
        ...(clean(configDirectory)
          ? { CLAUDE_CONFIG_DIR: clean(configDirectory) }
          : {}),
      },
      externalMcp: true,
      nativeDelegation: false,
      backendUi: false,
    }
  },
}
