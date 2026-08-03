const SCOPES = new Set(['profile', 'long_term', 'rules', 'all'])

function normalizeScope(value, fallback = 'all') {
  const scope = String(value || fallback).trim().toLowerCase()
  if (!SCOPES.has(scope)) throw new Error(`unsupported memory scope: ${scope}`)
  return scope
}

export class ProfiledMemoryStore {
  constructor({ memoryStore, userProfile = null } = {}) {
    this.memoryStore = memoryStore
    this.userProfile = userProfile
  }

  list(ownerId, options = {}) {
    const limit = Math.min(64, Math.max(1, Number(options.limit) || 20))
    const scope = normalizeScope(options.scope)
    const profile = ['profile', 'all'].includes(scope)
      ? this.userProfile?.list({ query: options.query }) || []
      : []
    const texts = ['long_term', 'rules', 'all'].includes(scope)
      ? this.memoryStore?.list(ownerId, {
          query: options.query,
          limit,
          scope: scope === 'all' ? null : scope,
        }) || []
      : []
    return [...profile, ...texts].slice(0, limit)
  }

  remember(ownerId, { scope, content } = {}) {
    const target = normalizeScope(scope, 'long_term')
    if (target === 'all') throw new Error('remember requires a concrete memory scope')
    if (target === 'profile') {
      if (!this.userProfile) throw new Error('user profile is unavailable')
      return this.userProfile.remember(content)
    }
    if (!this.memoryStore) throw new Error('long-term memory is unavailable')
    return this.memoryStore.remember(ownerId, content, { scope: target })
  }

  replace(ownerId, {
    scope,
    ids,
    content,
  } = {}) {
    const target = normalizeScope(scope)
    if (target === 'all') throw new Error('replace requires a concrete memory scope')
    if (target === 'profile') {
      if (!this.userProfile) throw new Error('user profile is unavailable')
      return this.userProfile.replace({ ids, content })
    }
    if (!this.memoryStore) throw new Error('long-term memory is unavailable')
    return this.memoryStore.replace(ownerId, { ids, content, scope: target })
  }

  forget(ownerId, {
    scope,
    query,
    all = false,
  } = {}) {
    const target = normalizeScope(scope)
    let removed = 0
    if (['profile', 'all'].includes(target)) {
      removed += this.userProfile?.forget({ query, all }) || 0
    }
    if (['long_term', 'rules', 'all'].includes(target)) {
      removed += this.memoryStore?.forget(ownerId, {
        query,
        all,
        scope: target === 'all' ? null : target,
      }) || 0
    }
    return removed
  }

  health() {
    return {
      ...(this.memoryStore?.health() || {
        ok: true,
        persistenceEnabled: false,
        warning: null,
        owners: 0,
      }),
      userProfile: this.userProfile?.health() || {
        ok: true,
        configured: false,
        warning: null,
      },
    }
  }
}
