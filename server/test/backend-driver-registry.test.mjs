import assert from 'node:assert/strict'
import test from 'node:test'
import {
  backendDefinition,
  backendNames,
  resolveBackendOwnership,
} from '../../shared/backend-catalog.mjs'
import { backendDriver } from '../src/agent/backends/registry.mjs'
import {
  backendRuntimeDriver,
} from '../src/process/backend-drivers/registry.mjs'

test('every advertised backend has Agent and Runtime drivers', () => {
  for (const protocol of backendNames()) {
    assert.equal(backendDriver(protocol).id, protocol)
    const runtime = backendRuntimeDriver(protocol)
    const definition = backendDefinition(protocol)
    assert.equal(runtime.id, protocol)
    assert.equal(runtime.baseUrlEnvironment, definition.baseUrlEnvironment)
    assert.equal(runtime.defaultBaseUrl, definition.defaultBaseUrl)
    assert.equal(
      Boolean(runtime.supportsExternalService),
      Boolean(definition.supportsExternalService),
    )
  }
})

test('external ownership is available only to declared backend services', () => {
  assert.equal(resolveBackendOwnership('openclaw', {
    baseUrlConfigured: true,
  }), 'external')
  assert.equal(resolveBackendOwnership('openclaw'), 'owned')
  assert.equal(resolveBackendOwnership('opencode', {
    baseUrlConfigured: true,
  }), 'owned')
  assert.throws(() => resolveBackendOwnership('opencode', {
    requestedOwnership: 'external',
  }), /不支持连接外部后台服务/)
})
