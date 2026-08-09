import { backendDefinition } from '../../../../shared/backend-catalog.mjs'
import { openClawRuntimeDriver } from './openclaw.mjs'
import { openCodeRuntimeDriver } from './opencode.mjs'
import { managedOnlyBackend } from './shared.mjs'

const drivers = new Map([
  openCodeRuntimeDriver,
  openClawRuntimeDriver,
].map(driver => [driver.id, driver]))

function managedProcessDriver(definition) {
  return {
    id: definition.id,
    separateManagedProcess: false,
    resolve({ ownership, permissionMode }) {
      if (permissionMode === 'full' && !definition.supportsFullPermission) {
        throw new Error(`${definition.label} 无法安全地统一开启最高权限模式`)
      }
      return managedOnlyBackend({
        id: definition.id,
        ownership,
        permissionMode,
        label: definition.label,
      })
    },
  }
}

export function normalizeBackendRuntimeProtocol(protocol) {
  const id = String(protocol || '').trim().toLowerCase()
  return id === 'none' ? '' : id
}

export function backendRuntimeDriver(protocol) {
  const id = normalizeBackendRuntimeProtocol(protocol)
  const definition = backendDefinition(id)
  const driver = drivers.get(id) || (definition
    ? managedProcessDriver(definition)
    : null)
  if (!driver) throw new Error(`不支持的后台 Agent：${id}`)
  return driver
}
