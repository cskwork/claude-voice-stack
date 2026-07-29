import { baseEnvironment } from './shared.mjs'

export const hermesBackendDriver = {
  id: 'hermes',
  label: 'Hermes',

  resolveOptions(options) {
    return {
      baseUrl: '',
      model: options.hermesModel,
      directory: options.hermesDirectory,
      cliPath: options.hermesCliPath,
      coordinatorAgent: options.coordinatorAgent,
    }
  },

  createProfile({ directory, cliPath }) {
    return {
      label: this.label,
      command: cliPath || 'hermes',
      args: ['acp', '--accept-hooks'],
      cwd: directory,
      env: baseEnvironment(),
      externalMcp: true,
      nativeDelegation: false,
      backendUi: false,
    }
  },
}
