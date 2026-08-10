import { actionPromiseGuard } from './action-promise.mjs'

// Registration is intentionally static. Adding a guard is a reviewed code change,
// not runtime configuration, and the first matching guard is the only correction
// allowed for one response.
const RESPONSE_GUARDS = Object.freeze([
  actionPromiseGuard,
])

export function evaluateResponseGuards(
  observation,
  { guards = RESPONSE_GUARDS } = {},
) {
  for (const guard of guards) {
    if (!guard?.id || !guard?.instructions || !guard?.matches) continue
    if (!guard.matches(observation)) continue
    return {
      guardId: guard.id,
      instructions: guard.instructions,
    }
  }
  return null
}

export function isResponseGuardTurnCurrent({
  sameFrontend = false,
  outputEnabled = false,
  userSpeaking = false,
  responseTurnId = '',
  responseTurnGeneration,
  committedTurnId = '',
  committedTurnGeneration,
} = {}) {
  return Boolean(
    sameFrontend
    && outputEnabled
    && !userSpeaking
    && responseTurnId
    && responseTurnId === committedTurnId
    && responseTurnGeneration === committedTurnGeneration,
  )
}
