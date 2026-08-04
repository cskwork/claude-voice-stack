const ACTIVE_TASK_PHASES = new Set([
  'queued',
  'running',
  'delegated',
  'finalizing',
  'cancelling',
  'responding',
])

const ACTIVE_VOICE_STATES = new Set([
  'listening',
  'thinking',
  'speaking',
])

export function desktopAutoSleepSeconds(search = '') {
  const params = new URLSearchParams(search)
  if (!params.has('autoSleepSeconds')) return 120
  const value = Number(params.get('autoSleepSeconds'))
  if (value === 0) return 0
  return Number.isInteger(value) && value >= 30 && value <= 3600
    ? value
    : 120
}

export function desktopWorkSettled({
  tasks = [],
  messages = [],
  voiceState = 'idle',
} = {}) {
  return (
    !tasks.some(task => (
      ACTIVE_TASK_PHASES.has(task.phase)
      || task.authorization?.status === 'pending'
    ))
    && !messages.some(message => message.live)
    && !ACTIVE_VOICE_STATES.has(voiceState)
  )
}

export function desktopCanSleep({
  settled,
  connectionState,
  visualError = false,
  lifecycle = 'active',
} = {}) {
  return (
    lifecycle === 'active'
    && settled === true
    && connectionState === 'connected'
    && visualError !== true
  )
}

export function desktopSleepDeadline({
  lastInteractionAt,
  workSettledAt,
  timeoutSeconds,
}) {
  if (!timeoutSeconds) return Infinity
  return Math.max(lastInteractionAt, workSettledAt) + timeoutSeconds * 1000
}
