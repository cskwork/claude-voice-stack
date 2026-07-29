import { managedOnlyBackend } from './shared.mjs'

export const claudeRuntimeDriver = {
  id: 'claude',
  separateManagedProcess: false,

  resolve({ ownership, permissionMode }) {
    return managedOnlyBackend({
      id: this.id,
      ownership,
      permissionMode,
      label: 'Claude Code',
    })
  },
}
