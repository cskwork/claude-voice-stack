import { baseEnvironment, processAcpConnection } from './shared.mjs'

export const hermesBackendDriver = {
  id: 'hermes',
  label: 'Hermes',

  createProfile({ directory, cliPath }) {
    return {
      label: this.label,
      acpConnection: processAcpConnection({
        command: cliPath || 'hermes',
        args: ['acp', '--accept-hooks'],
        cwd: directory,
        env: baseEnvironment(),
      }),
      externalMcp: true,
      nativeDelegation: false,
      backendUi: false,
    }
  },
}
