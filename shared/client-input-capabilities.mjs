const PROFILES = Object.freeze({
  web: Object.freeze({ text: true, audio: true, image: true, resource: true }),
  cli: Object.freeze({ text: true, audio: true, image: true, resource: true }),
  desktop: Object.freeze({ text: false, audio: true, image: false, resource: false }),
})

export function clientInputCapabilities(clientType = 'web') {
  const profile = PROFILES[clientType] || PROFILES.web
  return { ...profile }
}

export function supportsComposerInput(clientType = 'web') {
  const capabilities = clientInputCapabilities(clientType)
  return capabilities.text || capabilities.image || capabilities.resource
}
