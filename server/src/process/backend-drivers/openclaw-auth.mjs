import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import JSON5 from 'json5'

function clean(value) {
  return String(value || '').trim()
}

function configuredToken(value, env) {
  if (typeof value === 'string') {
    const reference = value.match(/^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/)
    return reference ? clean(env[reference[1]]) : clean(value)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  const source = clean(value.source || value.provider).toLowerCase()
  const environmentName = clean(
    value.id || value.name || value.key || value.env,
  )
  return source === 'env' && environmentName
    ? clean(env[environmentName])
    : ''
}

export function openClawConfigPath({
  env = process.env,
  homeDirectory = env.HOME,
} = {}) {
  if (clean(env.OPENCLAW_CONFIG_PATH)) {
    return resolve(clean(env.OPENCLAW_CONFIG_PATH))
  }
  const stateDirectory = clean(env.OPENCLAW_STATE_DIR)
    || (homeDirectory ? resolve(homeDirectory, '.openclaw') : '')
  return stateDirectory ? resolve(stateDirectory, 'openclaw.json') : ''
}

export function resolveOpenClawGatewayToken({
  env = process.env,
  homeDirectory = env.HOME,
} = {}) {
  const explicit = clean(env.OPENCLAW_GATEWAY_TOKEN)
  if (explicit) return explicit
  const path = openClawConfigPath({ env, homeDirectory })
  if (!path || !existsSync(path)) return ''
  try {
    const parsed = JSON5.parse(readFileSync(path, 'utf8'))
    return configuredToken(parsed?.gateway?.auth?.token, env)
  } catch {
    return ''
  }
}

export function syncOpenClawGatewayTokenFile({
  env = process.env,
  homeDirectory = env.HOME,
  targetPath,
} = {}) {
  const token = resolveOpenClawGatewayToken({ env, homeDirectory })
  const path = clean(targetPath || env.OPENCLAW_GATEWAY_TOKEN_FILE)
  if (!token || !path) return false
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporaryPath = `${path}.tmp.${process.pid}`
  writeFileSync(temporaryPath, `${token}\n`, { mode: 0o600 })
  chmodSync(temporaryPath, 0o600)
  renameSync(temporaryPath, path)
  return true
}

export function writeIsolatedOpenClawConfig({
  sourcePath,
  targetPath,
} = {}) {
  const source = clean(sourcePath)
  const target = clean(targetPath)
  if (!source || !target || !existsSync(source)) return false
  const parsed = JSON5.parse(readFileSync(source, 'utf8'))
  // A qwenaudio-owned Gateway only provides the local ACP backend. Reusing
  // channels would connect the user's messaging accounts a second time.
  delete parsed.channels
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
  const temporaryPath = `${target}.tmp.${process.pid}`
  writeFileSync(temporaryPath, `${JSON.stringify(parsed, null, 2)}\n`, {
    mode: 0o600,
  })
  chmodSync(temporaryPath, 0o600)
  renameSync(temporaryPath, target)
  return true
}

// Faithful port of OpenClaw's own agent-copy portability policy
// (src/agents/auth-profiles/portability.ts): static api_key/token profiles
// are portable unless they opt out with copyToAgents: false; OAuth refresh
// material is not portable unless the provider opts in AND the profile
// carries inline access/refresh material.
export function isPortableOpenClawCredential(credential) {
  if (!credential || typeof credential !== 'object' || Array.isArray(credential)) {
    return false
  }
  if (!['api_key', 'token', 'oauth'].includes(credential.type)) return false
  if (!clean(credential.provider)) return false
  if (credential.copyToAgents === false) return false
  if (credential.type === 'oauth') {
    const hasInlineMaterial = [credential.access, credential.refresh].some(
      value => typeof value === 'string' && value.trim(),
    )
    return credential.copyToAgents === true && hasInlineMaterial
  }
  return true
}

function portableProfileStore(parsed) {
  // auth-profiles.json has two known shapes: the current store
  // ({ version, profiles: { id: credential } }) and the legacy flat record
  // ({ id: credential }). Preserve the input shape and keep only portable
  // credentials; anything else in the store stays behind.
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const flat = !parsed.profiles || typeof parsed.profiles !== 'object'
  const profiles = flat ? parsed : parsed.profiles
  const portable = Object.fromEntries(
    Object.entries(profiles).filter(([, credential]) => (
      isPortableOpenClawCredential(credential)
    )),
  )
  if (!Object.keys(portable).length) return null
  return flat
    ? portable
    : {
        ...(parsed.version === undefined ? {} : { version: parsed.version }),
        profiles: portable,
      }
}

// Seeds the isolated runtime state with the portable static credentials from
// the user's own OpenClaw state, mirroring what `openclaw agents add` does
// inside one state tree. The per-agent SQLite store is deliberately not
// touched: it is OpenClaw-private storage, while auth-profiles.json is the
// documented seeding input. Existing target profiles are never overwritten so
// a separately authenticated isolated instance keeps its own credentials.
export function seedPortableOpenClawAuthProfiles({
  userStateDirectory,
  runtimeStateDirectory,
} = {}) {
  const source = clean(userStateDirectory)
  const target = clean(runtimeStateDirectory)
  const result = { seeded: [], skipped: [] }
  if (!source || !target || resolve(source) === resolve(target)) return result
  const agentsRoot = join(source, 'agents')
  if (!existsSync(agentsRoot)) return result
  let agentIds = []
  try {
    agentIds = readdirSync(agentsRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
  } catch {
    return result
  }
  for (const agentId of agentIds) {
    const sourceProfiles = join(agentsRoot, agentId, 'agent', 'auth-profiles.json')
    const targetProfiles = join(target, 'agents', agentId, 'agent', 'auth-profiles.json')
    try {
      if (!existsSync(sourceProfiles) || existsSync(targetProfiles)) {
        continue
      }
      const store = portableProfileStore(
        JSON.parse(readFileSync(sourceProfiles, 'utf8')),
      )
      if (!store) {
        result.skipped.push(agentId)
        continue
      }
      mkdirSync(dirname(targetProfiles), { recursive: true, mode: 0o700 })
      const temporaryPath = `${targetProfiles}.tmp.${process.pid}`
      writeFileSync(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, {
        mode: 0o600,
      })
      chmodSync(temporaryPath, 0o600)
      renameSync(temporaryPath, targetProfiles)
      result.seeded.push(agentId)
    } catch {
      // A broken per-agent store must not block the gateway launch; the
      // remaining agents still get their portable credentials.
      result.skipped.push(agentId)
    }
  }
  return result
}

// Single preparation seam shared by the CLI script and the desktop helper:
// isolate the config file and seed portable credentials in one call, so both
// entrypoints stay thin and cannot drift apart.
export function prepareIsolatedOpenClawState({
  sourcePath,
  targetPath,
} = {}) {
  const config = writeIsolatedOpenClawConfig({ sourcePath, targetPath })
  const auth = config
    ? seedPortableOpenClawAuthProfiles({
        userStateDirectory: dirname(resolve(clean(sourcePath))),
        runtimeStateDirectory: dirname(resolve(clean(targetPath))),
      })
    : { seeded: [], skipped: [] }
  return { config, auth }
}
