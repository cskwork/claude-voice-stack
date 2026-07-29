import { baseEnvironment } from './shared.mjs'

export const qoderBackendDriver = {
  id: 'qoder',
  label: 'Qoder',
  resolveOptions(options) {
    return {
      baseUrl: '',
      model: options.qoderModel,
      directory: options.qoderDirectory,
      configDirectory: options.qoderConfigDirectory,
      cliPath: options.qoderCliPath,
      coordinatorAgent: options.coordinatorAgent,
    }
  },

  createProfile({
    directory,
    cliPath,
    configDirectory,
    permissionMode,
  }) {
    return {
      label: this.label,
      command: cliPath || 'qodercli',
      args: [
        '--acp',
        ...(permissionMode === 'full'
          ? ['--dangerously-skip-permissions']
          : []),
      ],
      cwd: directory,
      env: baseEnvironment(configDirectory),
      externalMcp: true,
      nativeDelegation: false,
      backendUi: false,
    }
  },

}
