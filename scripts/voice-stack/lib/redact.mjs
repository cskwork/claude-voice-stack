const SECRET_KEY_PATTERN = /(API_KEY|_TOKEN|SECRET|PASSWORD|CREDENTIAL)$/i

export function isSecretKey(name) {
  return SECRET_KEY_PATTERN.test(String(name || ''))
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Remove secret values from free text before it reaches a log or the terminal.
 * Values come from the loaded environment; short values (< 8 chars) are not
 * replaced because that would also mask ordinary words.
 */
export function redactSecrets(text, env = {}) {
  let output = String(text ?? '')
  for (const [key, value] of Object.entries(env)) {
    if (!isSecretKey(key)) continue
    const secret = String(value ?? '')
    if (secret.length < 8) continue
    output = output.replace(new RegExp(escapeRegExp(secret), 'g'), '***')
  }
  return output
    .replace(/(Bearer\s+)[A-Za-z0-9._-]{8,}/g, '$1***')
    .replace(/\bsk-[A-Za-z0-9._-]{8,}/g, 'sk-***')
}

export function redactedEnvSummary(env = {}) {
  return Object.fromEntries(Object.entries(env).map(([key, value]) => [
    key,
    isSecretKey(key) ? (value ? '(set)' : '(empty)') : value,
  ]))
}
