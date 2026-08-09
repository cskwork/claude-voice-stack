import { backendDriver } from './backends/registry.mjs'
export { endpointAvailable } from './backends/shared.mjs'

export function acpBackendProfile({
  protocol,
  root,
  ownership,
  directory,
  cliPath,
  baseUrl,
  token,
  tokenFile,
  coordinatorAgent,
  configDirectory,
  permissionMode,
  model,
  modelUrl,
  claudeExecutable,
  args,
  label,
}) {
  return backendDriver(protocol).createProfile({
    root,
    ownership,
    directory,
    cliPath,
    baseUrl,
    token,
    tokenFile,
    coordinatorAgent,
    configDirectory,
    permissionMode,
    model,
    modelUrl,
    claudeExecutable,
    args,
    label,
  })
}
