import { baseEnvironment, processAcpConnection } from './shared.mjs'

export const qoderBackendDriver = {
  id: 'qoder',
  label: 'Qoder',

  createProfile({
    directory,
    cliPath,
    permissionMode,
  }) {
    return {
      label: this.label,
      acpConnection: processAcpConnection({
        command: cliPath || 'qodercli',
        args: [
          '--acp',
          ...(permissionMode === 'full'
            ? ['--dangerously-skip-permissions']
            : []),
        ],
        cwd: directory,
        env: baseEnvironment(),
      }),
      externalMcp: true,
      nativeDelegation: false,
      backendUi: false,
    }
  },

}
