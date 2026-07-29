import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import test from 'node:test'
import {
  AcpBackendAdapter,
  acpBackendProfile,
} from '../src/agent/acp-backend-adapter.mjs'

function completed(speech = '完成') {
  return JSON.stringify({
    work_id: 'work-one',
    state: 'completed',
    mode: 'respond',
    presentation: { speech, inline: null },
  })
}

function delegated(result) {
  return JSON.stringify({
    work_id: 'work-one',
    state: 'delegated',
    mode: 'delegate',
    delegation_id: result.delegation_id,
    target_session_id: result.session_id,
    presentation: { speech: '已经交给独立项目处理。', inline: null },
  })
}

function fakeToolServer() {
  return {
    context: null,
    registerCalls: 0,
    async register(context) {
      this.context = context
      this.registerCalls += 1
      return {
        descriptor: {
          type: 'http',
          name: 'test',
          url: `http://127.0.0.1/mcp/${this.registerCalls}`,
          headers: [],
        },
        release() {},
      }
    },
    async close() {},
  }
}

function fakeAcpClient({
  action = 'start',
  holdTarget = false,
  sendDirectory = '/previous',
  scopeListsByCwd = false,
} = {}) {
  const calls = []
  const sessions = new Map([
    ['previous-session', {
      sessionId: 'previous-session',
      cwd: '/previous',
      title: 'Previous project',
      updatedAt: '2026-01-01T00:00:00Z',
    }],
  ])
  let toolServer
  let nextId = 0
  const targetGate = holdTarget
    ? Promise.withResolvers()
    : { promise: Promise.resolve('third-layer-result') }
  return {
    calls,
    sessions,
    targetGate,
    bind(server) {
      toolServer = server
    },
    async start() {
      return {
        agentInfo: { name: 'fake-acp' },
        agentCapabilities: {
          loadSession: true,
          mcpCapabilities: { http: true },
          sessionCapabilities: { list: {}, resume: {}, close: {} },
        },
      }
    },
    async newSession(options) {
      const session = {
        sessionId: options.role === 'coordinator'
          ? 'coordinator-session'
          : `project-${++nextId}`,
        cwd: options.cwd,
        ...options,
      }
      calls.push(['new', session])
      sessions.set(session.sessionId, session)
      return session
    },
    async resumeSession(sessionId, options) {
      const session = {
        ...(sessions.get(sessionId) || {}),
        sessionId,
        ...options,
      }
      calls.push(['resume', sessionId, options])
      sessions.set(sessionId, session)
      return session
    },
    async listSessions(options = {}) {
      calls.push(['list', options])
      const values = [...sessions.values()]
      if (!scopeListsByCwd) return values
      const cwd = options.cwd || '/coordinator'
      return values.filter(session => session.cwd === cwd)
    },
    async prompt(sessionId, prompt, options = {}) {
      calls.push(['prompt', sessionId, prompt])
      if (sessionId !== 'coordinator-session') {
        if (options.signal?.aborted) throw options.signal.reason
        return new Promise((resolve, reject) => {
          const abort = () => reject(options.signal.reason)
          options.signal?.addEventListener('abort', abort, { once: true })
          targetGate.promise.then(content => {
            options.signal?.removeEventListener('abort', abort)
            resolve({
              content,
              response: { stopReason: 'end_turn' },
            })
          }, reject)
        })
      }
      if (prompt.includes('plain follow-up')) {
        return {
          content: completed('已同步取消事实'),
          response: { stopReason: 'end_turn' },
        }
      }
      if (prompt.includes('kind="cancel"')) {
        const record = [...sessions.values()].find(item => (
          item.role === 'project'
        ))
        await toolServer.context.cancelSession({
          session_id: record.sessionId,
        })
        return {
          content: completed('已取消'),
          response: { stopReason: 'end_turn' },
        }
      }
      if (prompt.includes('kind="status"')) {
        const status = await toolServer.context.sessionStatus({
          session_id: action === 'send'
            ? 'previous-session'
            : 'project-1',
        })
        return {
          content: completed(`当前状态：${status.status}`),
          response: { stopReason: 'end_turn' },
        }
      }
      if (prompt.includes('qwen_audio_agent_delegation_result')) {
        return {
          content: completed('第三层结果已整理'),
          response: { stopReason: 'end_turn' },
        }
      }
      const result = action === 'send'
        ? await toolServer.context.sendSession({
            session_id: 'previous-session',
            prompt: 'continue previous work',
            ...(sendDirectory ? { directory: sendDirectory } : {}),
          })
        : await toolServer.context.startSession({
            prompt: 'build project',
            directory: '/project',
            title: 'Project',
          })
      return {
        content: delegated(result),
        response: { stopReason: 'end_turn' },
      }
    },
    async cancelSession(sessionId) {
      calls.push(['cancel', sessionId])
    },
    async setSessionConfigOption(sessionId, configId, value) {
      calls.push(['config', sessionId, configId, value])
      return { configOptions: [] }
    },
    async close() {},
  }
}

test('waits for the managed OpenClaw Gateway before starting its ACP bridge', async () => {
  const client = fakeAcpClient()
  let available = false
  let starts = 0
  const originalStart = client.start
  client.start = async () => {
    starts += 1
    return originalStart()
  }
  const adapter = new AcpBackendAdapter({
    protocol: 'openclaw',
    baseUrl: 'http://127.0.0.1:18789',
    clientFactory: () => client,
    backendAvailable: async () => available,
  })

  const starting = await adapter.health()
  assert.equal(starting.ok, false)
  assert.match(starting.error, /正在启动/)
  assert.equal(starts, 0)

  available = true
  const ready = await adapter.health()
  assert.equal(ready.ok, true)
  assert.equal(starts, 1)
})

test('continues a remembered project Session when session_send omits directory', async () => {
  const client = fakeAcpClient({
    action: 'send',
    sendDirectory: '',
    scopeListsByCwd: true,
  })
  const tools = fakeToolServer()
  client.bind(tools)
  const adapter = new AcpBackendAdapter({
    protocol: 'qoder',
    directory: '/coordinator',
    client,
    sessionToolServer: tools,
  })
  adapter.registry.setProject('qoder:previous-session', {
    sessionId: 'previous-session',
    cwd: '/previous',
    title: 'Previous project',
  })
  const result = await adapter.runCoordinator('delegate', {
    ownerId: 'owner-one',
    coordinationRunId: 'work-one',
  })
  assert.equal(
    JSON.parse(result.content).presentation.speech,
    '第三层结果已整理',
  )
  assert.ok(client.calls.some(call => (
    call[0] === 'resume'
    && call[1] === 'previous-session'
    && call[2].cwd === '/previous'
  )))
  assert.equal(client.calls.some(call => call[0] === 'list'), false)
  await adapter.close()
})

test('uses one ACP profile family while preserving backend differences', () => {
  const root = '/repo'
  assert.deepEqual(
    acpBackendProfile({
      protocol: 'opencode',
      root,
      directory: '/work',
      permissionMode: 'native',
    }).args,
    [],
  )
  assert.deepEqual(
    acpBackendProfile({
      protocol: 'qoder',
      root,
      directory: '/work',
      permissionMode: 'full',
    }).args,
    ['--acp', '--dangerously-skip-permissions'],
  )
  const openClaw = acpBackendProfile({
    protocol: 'openclaw',
    root,
    directory: '/work',
    baseUrl: 'http://127.0.0.1:18789',
    token: 'secret',
    tokenFile: '/state/gateway-token',
    coordinatorAgent: 'coordinator',
    permissionMode: 'native',
  })
  assert.equal(openClaw.externalMcp, false)
  assert.deepEqual(openClaw.args, [
    'acp',
    '--url',
    'ws://127.0.0.1:18789',
    '--token-file',
    '/state/gateway-token',
    '--verbose',
  ])
  const generic = acpBackendProfile({
    protocol: 'acp',
    root,
    directory: '/work',
    cliPath: 'example-agent',
    args: ['--acp', '--profile', 'voice'],
    label: 'Example Agent',
    permissionMode: 'native',
  })
  assert.equal(generic.label, 'Example Agent')
  assert.equal(generic.command, 'example-agent')
  assert.deepEqual(generic.args, ['--acp', '--profile', 'voice'])
  assert.equal(generic.externalMcp, true)
  const hermes = acpBackendProfile({
    protocol: 'hermes',
    root,
    directory: '/work',
    cliPath: '/opt/hermes',
    permissionMode: 'native',
  })
  assert.equal(hermes.command, '/opt/hermes')
  assert.deepEqual(hermes.args, ['acp', '--accept-hooks'])
  const codeBuddy = acpBackendProfile({
    protocol: 'codebuddy',
    root,
    directory: '/work',
    model: 'qwen3.7-max',
    modelUrl: 'https://example.com/v1/chat/completions',
    permissionMode: 'full',
  })
  assert.deepEqual(codeBuddy.args, [
    '--acp',
    '--model',
    'qwen3.7-max',
    '--dangerously-skip-permissions',
  ])
  assert.equal(
    codeBuddy.env.CODEBUDDY_MODEL_URL,
    'https://example.com/v1/chat/completions',
  )
  const nativeCodeBuddy = acpBackendProfile({
    protocol: 'codebuddy',
    root,
    directory: '/work',
    permissionMode: 'native',
  })
  assert.deepEqual(nativeCodeBuddy.args, ['--acp'])
  assert.equal(nativeCodeBuddy.env.CODEBUDDY_MODEL_URL, undefined)
  const codex = acpBackendProfile({
    protocol: 'codex',
    root,
    directory: '/work',
    model: 'qwen3.7-max',
    modelUrl: 'https://example.com/compatible-mode/v1',
    permissionMode: 'full',
  })
  assert.equal(codex.command, resolve(root, 'scripts/codex-acp'))
  assert.equal(codex.env.INITIAL_AGENT_MODE, 'agent-full-access')
  const codexConfig = JSON.parse(codex.env.CODEX_CONFIG)
  assert.equal(codexConfig.model, 'qwen3.7-max')
  assert.equal(
    codexConfig.model_providers['qwen-audio-agent'].base_url,
    'https://example.com/compatible-mode/v1',
  )
  const nativeCodex = acpBackendProfile({
    protocol: 'codex',
    root,
    directory: '/work',
    cliPath: '/opt/codex-acp',
    permissionMode: 'native',
  })
  assert.equal(nativeCodex.command, resolve(root, 'scripts/codex-acp'))
  assert.equal(nativeCodex.env.CODEX_ACP_BIN, '/opt/codex-acp')
  assert.equal(nativeCodex.env.CODEX_CONFIG, undefined)
  assert.equal(nativeCodex.env.MODEL_PROVIDER, undefined)
  const claude = acpBackendProfile({
    protocol: 'claude',
    root,
    directory: '/work',
    cliPath: '/opt/claude-code-acp',
    claudeExecutable: '/opt/claude',
    configDirectory: '/config/claude',
    permissionMode: 'full',
  })
  assert.equal(claude.command, resolve(root, 'scripts/claude-code-acp'))
  assert.equal(claude.cwd, '/work')
  assert.equal(claude.env.CLAUDE_CODE_ACP_BIN, '/opt/claude-code-acp')
  assert.equal(claude.env.CLAUDE_CODE_EXECUTABLE, '/opt/claude')
  assert.equal(claude.env.CLAUDE_CONFIG_DIR, '/config/claude')
  assert.equal(claude.externalMcp, true)
})

for (const action of ['start', 'send']) {
  test(`ACP coordinator can ${action} a third-layer Session and finalize through the coordinator`, async () => {
    const client = fakeAcpClient({ action })
    const tools = fakeToolServer()
    client.bind(tools)
    const adapter = new AcpBackendAdapter({
      protocol: 'opencode',
      root: '/repo',
      directory: '/coordinator',
      client,
      sessionToolServer: tools,
    })
    const events = []
    const result = await adapter.runCoordinator('delegate', {
      ownerId: 'owner-one',
      coordinationRunId: 'work-one',
      onEvent: event => events.push(event),
    })
    assert.equal(JSON.parse(result.content).presentation.speech, '第三层结果已整理')
    assert.ok(events.some(event => event.type === 'backend.delegated'))
    assert.ok(events.some(
      event => event.type === 'backend.delegation.completed',
    ))
    if (action === 'send') {
      assert.ok(client.calls.some(call => (
        call[0] === 'resume'
        && call[1] === 'previous-session'
        && call[2].cwd === '/previous'
      )))
    } else {
      assert.ok(client.calls.some(call => (
        call[0] === 'new' && call[1].role === 'project'
      )))
    }
    const coordinatorPrompts = client.calls.filter(call => (
      call[0] === 'prompt' && call[1] === 'coordinator-session'
    ))
    assert.equal(coordinatorPrompts.length, 2)
    assert.equal(
      client.calls.some(call => call[0] === 'config'),
      false,
    )
    await adapter.close()
  })
}

test('ACP permissions expose permanent allow and reject semantics', async () => {
  const client = fakeAcpClient()
  const adapter = new AcpBackendAdapter({
    protocol: 'opencode',
    client,
    sessionToolServer: fakeToolServer(),
  })
  const options = [
    { optionId: 'once', name: 'Allow', kind: 'allow_once' },
    { optionId: 'always', name: 'Always', kind: 'allow_always' },
    { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
  ]
  const events = []
  client.sessions.set('coordinator-session', {
    sessionId: 'coordinator-session',
    ownerId: 'owner-one',
    coordinationRunId: 'work-one',
    onEvent: event => events.push(event),
  })
  const pending = adapter.handlePermission({
    sessionId: 'coordinator-session',
    toolCall: {
      toolCallId: 'tool-one',
      name: 'write',
      rawInput: { path: '/tmp/file' },
    },
    options,
  }, {
    session: client.sessions.get('coordinator-session'),
  })
  const requested = events.find(event => (
    event.type === 'backend.permission.requested'
  ))
  await adapter.respondPermission(requested.permission.id, 'always', {
    ownerId: 'owner-one',
  })
  assert.deepEqual(await pending, {
    outcome: { outcome: 'selected', optionId: 'once' },
  })
  assert.ok(events.some(event => (
    event.type === 'backend.permission.resolved'
  )))
  assert.deepEqual(
    await adapter.respondPermission(requested.permission.id, 'always', {
      ownerId: 'owner-one',
    }),
    events.find(event => event.type === 'backend.permission.resolved').permission,
  )
  const repeated = adapter.handlePermission({
    sessionId: 'coordinator-session',
    toolCall: {
      toolCallId: 'tool-two',
      name: 'write',
      rawInput: { path: '/tmp/file' },
    },
    options,
  }, {
    session: client.sessions.get('coordinator-session'),
  })
  const repeatedRequest = events.filter(event => (
    event.type === 'backend.permission.requested'
  )).at(-1)
  assert.notEqual(repeatedRequest.permission.id, requested.permission.id)
  await adapter.respondPermission(repeatedRequest.permission.id, 'reject', {
    ownerId: 'owner-one',
  })
  assert.deepEqual(await repeated, {
    outcome: { outcome: 'selected', optionId: 'reject' },
  })
  await adapter.close()
})

test('permission cleanup is isolated to the ACP prompt that requested it', async () => {
  const adapter = new AcpBackendAdapter({
    protocol: 'opencode',
    client: fakeAcpClient(),
    sessionToolServer: fakeToolServer(),
  })
  const options = [
    { optionId: 'always', kind: 'allow_always' },
    { optionId: 'reject', kind: 'reject_once' },
  ]
  const coordinatorEvents = []
  const coordinator = adapter.handlePermission({
    toolCall: { name: 'read', rawInput: { path: '/coordinator' } },
    options,
  }, {
    session: {
      sessionId: 'coordinator',
      ownerId: 'owner-one',
      coordinationRunId: 'work-one',
      permissionScopeId: 'coordinator-prompt',
      onEvent: event => coordinatorEvents.push(event),
    },
  })
  const project = adapter.handlePermission({
    toolCall: { name: 'write', rawInput: { path: '/project' } },
    options,
  }, {
    session: {
      sessionId: 'project',
      ownerId: 'owner-one',
      coordinationRunId: 'work-one',
      permissionScopeId: 'project-prompt',
    },
  })
  const projectPermission = [...adapter.pendingPermissions.values()]
    .find(record => record.sessionId === 'project')

  adapter.cancelPermissionsForScope('coordinator-prompt')
  assert.deepEqual(await coordinator, {
    outcome: { outcome: 'cancelled' },
  })
  assert.equal(
    coordinatorEvents.at(-1).type,
    'backend.permission.resolved',
  )
  assert.equal(coordinatorEvents.at(-1).permission.status, 'cancelled')
  assert.equal(adapter.pendingPermissions.has(projectPermission.id), true)
  await adapter.respondPermission(projectPermission.id, 'always', {
    ownerId: 'owner-one',
  })
  assert.deepEqual(await project, {
    outcome: { outcome: 'selected', optionId: 'always' },
  })
  await adapter.close()
})

test('automatically allows only the Gateway-owned Session MCP tools', async () => {
  const adapter = new AcpBackendAdapter({
    protocol: 'qoder',
    client: fakeAcpClient(),
    sessionToolServer: fakeToolServer(),
  })
  const result = await adapter.handlePermission({
    toolCall: {
      toolCallId: 'session-tool',
      title: 'qwen_audio_agent_session_start (qwen_audio_agent)',
    },
    options: [
      { optionId: 'once', name: 'Allow', kind: 'allow_once' },
    ],
  })
  assert.deepEqual(result, {
    outcome: { outcome: 'selected', optionId: 'once' },
  })
  assert.equal(adapter.pendingPermissions.size, 0)
  await adapter.close()
})

test('delegated status queries go through the coordinator and cancellation does too when idle', async () => {
  const client = fakeAcpClient({ holdTarget: true })
  const tools = fakeToolServer()
  client.bind(tools)
  const adapter = new AcpBackendAdapter({
    protocol: 'opencode',
    root: '/repo',
    directory: '/coordinator',
    client,
    sessionToolServer: tools,
  })
  const running = adapter.runCoordinator('delegate', {
    ownerId: 'owner-one',
    coordinationRunId: 'work-one',
  })
  while (!adapter.delegatedWorkRuns.has('work-one')) {
    await new Promise(resolve => setImmediate(resolve))
  }
  const status = await adapter.queryDelegatedWork(
    'work-one',
    '做到哪了',
    { ownerId: 'owner-one' },
  )
  assert.equal(JSON.parse(status.content).presentation.speech, '当前状态：running')
  const cancelled = await adapter.cancelDelegatedWork('work-one', {
    ownerId: 'owner-one',
  })
  assert.equal(cancelled.route, 'coordinator')
  await assert.rejects(running, /取消/)
  assert.ok(client.calls.some(call => (
    call[0] === 'prompt' && call[2].includes('kind="status"')
  )))
  assert.ok(client.calls.some(call => (
    call[0] === 'prompt' && call[2].includes('kind="cancel"')
  )))
  await adapter.close()
})

test('busy-coordinator cancellation uses ACP directly and reconciles on the next turn', async () => {
  const client = fakeAcpClient({ holdTarget: true })
  const tools = fakeToolServer()
  client.bind(tools)
  const adapter = new AcpBackendAdapter({
    protocol: 'opencode',
    root: '/repo',
    directory: '/coordinator',
    client,
    sessionToolServer: tools,
  })
  const running = adapter.runCoordinator('delegate', {
    ownerId: 'owner-one',
    coordinationRunId: 'work-one',
  })
  while (!adapter.delegatedWorkRuns.has('work-one')) {
    await new Promise(resolve => setImmediate(resolve))
  }
  adapter.activeCoordinatorTurns.add('coordinator-session')
  const cancellation = await adapter.cancelDelegatedWork('work-one', {
    ownerId: 'owner-one',
  })
  adapter.activeCoordinatorTurns.delete('coordinator-session')
  assert.equal(cancellation.route, 'adapter')
  await assert.rejects(running, /取消/)
  await adapter.coordinatorTurn('plain follow-up', {
    ownerId: 'owner-one',
    coordinationRunId: 'work-two',
  })
  const followUp = client.calls.findLast(call => (
    call[0] === 'prompt' && call[2].includes('plain follow-up')
  ))
  assert.match(followUp[2], /qwen_audio_agent_reconciliation/)
  assert.match(followUp[2], /delegated_session_cancelled/)
  assert.equal(adapter.pendingCoordinatorFacts.has('owner-one'), false)
  await adapter.close()
})

test('selects supported ACP Session mode and model config options', async () => {
  const client = fakeAcpClient()
  const configured = []
  client.setSessionConfigOption = async (...args) => {
    configured.push(args)
    if (args[1] !== 'llm-selector') return {}
    return {
      configOptions: [{
        id: 'llm-selector',
        category: 'model',
        type: 'select',
        currentValue: args[2],
        options: [{ value: 'provider/model' }],
      }],
    }
  }
  client.newSession = async options => ({
    sessionId: 'coordinator-session',
    cwd: options.cwd,
    response: {
      configOptions: [
        {
          id: 'mode',
          type: 'select',
          currentValue: 'build',
          options: [{ value: 'voice-coordinator' }],
        },
        {
          id: 'llm-selector',
          category: 'model',
          type: 'select',
          currentValue: 'default',
          options: [{ value: 'provider/model' }],
        },
      ],
    },
  })
  const adapter = new AcpBackendAdapter({
    protocol: 'opencode',
    coordinatorAgent: 'voice-coordinator',
    model: 'provider/model',
    client,
    sessionToolServer: fakeToolServer(),
  })
  await adapter.ensureCoordinatorSession('owner-one')
  assert.deepEqual(configured, [
    ['coordinator-session', 'mode', 'voice-coordinator'],
    ['coordinator-session', 'llm-selector', 'provider/model'],
  ])
  await adapter.close()
})

test('never calls ACP model configuration without an explicit model', async () => {
  for (const model of ['', 'auto']) {
    const client = fakeAcpClient()
    const configured = []
    client.setSessionConfigOption = async (...args) => configured.push(args)
    const adapter = new AcpBackendAdapter({
      protocol: 'opencode',
      model,
      client,
    })
    assert.equal(adapter.describe().model, null)
    await adapter.configureSession({
      sessionId: 'session-one',
      response: {
        configOptions: [{
          id: 'models',
          category: 'model',
          type: 'select',
          currentValue: 'user-default',
          options: [{ value: 'user-default' }, { value: 'forced-model' }],
        }],
      },
    }, 'project')
    assert.deepEqual(configured, [])
    await adapter.close()
  }
})

test('rejects explicit models that ACP cannot apply', async () => {
  const client = fakeAcpClient()
  const adapter = new AcpBackendAdapter({
    protocol: 'opencode',
    model: 'forced-model',
    client,
  })
  await assert.rejects(
    adapter.configureSession({
      sessionId: 'missing-option',
      response: { configOptions: [] },
    }, 'project'),
    /没有通过 ACP 提供 Session 模型配置/,
  )
  await assert.rejects(
    adapter.configureSession({
      sessionId: 'unsupported-model',
      response: {
        configOptions: [{
          id: 'model',
          type: 'select',
          currentValue: 'user-default',
          options: [{ value: 'user-default' }],
        }],
      },
    }, 'project'),
    /不支持模型 forced-model.*user-default/,
  )
  await adapter.close()
})

test('verifies that an explicit ACP model override took effect', async () => {
  const client = fakeAcpClient()
  client.setSessionConfigOption = async () => ({
    configOptions: [{
      id: 'models',
      category: 'model',
      type: 'select',
      currentValue: 'different-model',
      options: [
        {
          group: 'Models',
          options: [{ value: 'forced-model' }, { value: 'different-model' }],
        },
      ],
    }],
  })
  const adapter = new AcpBackendAdapter({
    protocol: 'opencode',
    model: 'forced-model',
    client,
  })
  await assert.rejects(
    adapter.configureSession({
      sessionId: 'session-one',
      response: {
        configOptions: [{
          id: 'models',
          category: 'model',
          type: 'select',
          currentValue: 'user-default',
          options: [{
            group: 'Models',
            options: [
              { value: 'forced-model' },
              { value: 'different-model' },
            ],
          }],
        }],
      },
    }, 'project'),
    /未确认模型覆盖生效/,
  )
  await adapter.close()
})

test('reports ACP model-setting and unverifiable-response failures', async () => {
  const session = {
    sessionId: 'session-one',
    response: {
      configOptions: [{
        id: 'llm',
        category: 'MODEL',
        type: 'select',
        currentValue: 'user-default',
        options: [{ value: 'forced-model' }],
      }],
    },
  }
  const failingClient = fakeAcpClient()
  failingClient.setSessionConfigOption = async () => {
    throw new Error('backend rejected the request')
  }
  const failingAdapter = new AcpBackendAdapter({
    protocol: 'opencode',
    model: 'forced-model',
    client: failingClient,
  })
  await assert.rejects(
    failingAdapter.configureSession(session, 'project'),
    /无法把 Session 模型设置为 forced-model：backend rejected the request/,
  )
  await failingAdapter.close()

  const unverifiableClient = fakeAcpClient()
  unverifiableClient.setSessionConfigOption = async () => ({})
  const unverifiableAdapter = new AcpBackendAdapter({
    protocol: 'opencode',
    model: 'forced-model',
    client: unverifiableClient,
  })
  await assert.rejects(
    unverifiableAdapter.configureSession(session, 'project'),
    /没有返回 ACP configOptions/,
  )
  await unverifiableAdapter.close()
})

test('OpenClaw maps native Session tool updates into the shared delegation lifecycle', async () => {
  const calls = []
  const nativeCalls = []
  let promptCount = 0
  const client = {
    async start() {
      return {
        agentCapabilities: {
          sessionCapabilities: { list: {}, resume: {} },
        },
      }
    },
    async newSession(options) {
      return {
        sessionId: 'openclaw-coordinator',
        cwd: options.cwd,
        response: {},
      }
    },
    async resumeSession(sessionId, options) {
      return { sessionId, cwd: options.cwd, response: {} }
    },
    async listSessions() {
      return [{
        sessionId: 'agent:child:one',
        cwd: '/project',
        updatedAt: '2026-01-01T00:00:00Z',
      }]
    },
    async prompt(sessionId, prompt, options = {}) {
      calls.push(prompt)
      promptCount += 1
      if (promptCount === 1) {
        options.onUpdate({
          sessionUpdate: 'tool_call',
          toolCallId: 'spawn-one',
          name: 'sessions_spawn',
          title: 'Spawn project Session',
          status: 'completed',
          rawInput: { task: 'build project', cwd: '/project' },
          rawOutput: {
            content: [{
              type: 'text',
              text: JSON.stringify({
                status: 'accepted',
                runId: 'run-one',
                childSessionKey: 'agent:child:one',
              }),
            }],
          },
        })
        return {
          content: JSON.stringify({
            work_id: 'work-one',
            state: 'delegated',
            mode: 'delegate',
            delegation_id: 'run-one',
            target_session_id: 'agent:child:one',
            presentation: { speech: 'OpenClaw 已开始执行。', inline: null },
          }),
          response: { stopReason: 'end_turn' },
        }
      }
      return {
        content: completed('OpenClaw 第三层结果已整理'),
        response: { stopReason: 'end_turn' },
      }
    },
    async cancelSession() {},
    async close() {},
  }
  const adapter = new AcpBackendAdapter({
    protocol: 'openclaw',
    root: '/repo',
    directory: '/coordinator',
    baseUrl: 'http://127.0.0.1:18789',
    client,
    nativeDelegationAdapter: {
      async wait(input) {
        nativeCalls.push(['wait', input.runId, input.sessionId])
        return { content: 'child completed successfully' }
      },
      async cancel(input) {
        nativeCalls.push(['cancel', input.runId, input.sessionId])
      },
    },
  })
  const events = []
  const running = adapter.runCoordinator('delegate', {
    ownerId: 'owner-one',
    coordinationRunId: 'work-one',
    onEvent: event => events.push(event),
  })
  const result = await running
  assert.equal(
    JSON.parse(result.content).presentation.speech,
    'OpenClaw 第三层结果已整理',
  )
  assert.deepEqual(nativeCalls, [[
    'wait',
    'run-one',
    'agent:child:one',
  ]])
  assert.ok(calls[1].includes('child completed successfully'))
  assert.ok(events.some(event => event.type === 'backend.delegated'))
  assert.ok(events.some(
    event => event.type === 'backend.delegation.completed',
  ))
  await adapter.close()
})

test('OpenClaw routes each owner to the configured coordinator Agent through ACP metadata', () => {
  const adapter = new AcpBackendAdapter({
    protocol: 'openclaw',
    root: '/repo',
    baseUrl: 'http://127.0.0.1:18789',
    coordinatorAgent: 'voice-coordinator',
    client: fakeAcpClient(),
  })
  assert.deepEqual(adapter.coordinatorMeta('Owner One'), {
    sessionKey: 'agent:voice-coordinator:qwen-audio-agent:owner%20one:backend',
  })
})

test('OpenClaw reattaches a persisted native delegation after Gateway restart', async () => {
  const events = []
  const client = fakeAcpClient()
  client.prompt = async (_sessionId, prompt) => ({
    content: completed(
      prompt.includes('recovered child result')
        ? '恢复结果已整理'
        : 'unexpected',
    ),
    response: { stopReason: 'end_turn' },
  })
  const adapter = new AcpBackendAdapter({
    protocol: 'openclaw',
    root: '/repo',
    directory: '/coordinator',
    baseUrl: 'http://127.0.0.1:18789',
    client,
    nativeDelegationAdapter: {
      async wait({ runId, sessionId }) {
        assert.equal(runId, 'run-recovered')
        assert.equal(sessionId, 'agent:child:recovered')
        return { content: 'recovered child result' }
      },
    },
  })

  const result = await adapter.recoverDelegatedWork({
    id: 'work-one',
    ownerId: 'owner-one',
    objective: '恢复项目任务',
    delegation: {
      id: 'run-recovered',
      sessionId: 'agent:child:recovered',
      directory: '/project',
      title: '恢复项目',
    },
  }, {
    onEvent: event => events.push(event),
  })

  assert.equal(
    JSON.parse(result.content).presentation.speech,
    '恢复结果已整理',
  )
  assert.ok(events.some(event => event.type === 'backend.delegated'))
  assert.ok(events.some(
    event => event.type === 'backend.delegation.completed',
  ))
  await adapter.close()
})

test('releases completed ACP tool-call state instead of retaining it globally', () => {
  const adapter = new AcpBackendAdapter({
    protocol: 'qoder',
    client: fakeAcpClient(),
    sessionToolServer: fakeToolServer(),
  })
  const run = {
    toolCalls: new Map(),
    nativeToolCalls: new Map(),
    onEvent: () => {},
  }

  adapter.onSessionUpdate(run, {
    sessionUpdate: 'tool_call',
    toolCallId: 'tool-one',
    name: 'Read',
    status: 'in_progress',
    rawInput: { path: '/project/file.js' },
  })
  assert.equal(run.toolCalls.size, 1)

  adapter.onSessionUpdate(run, {
    sessionUpdate: 'tool_call_update',
    toolCallId: 'tool-one',
    status: 'completed',
  })
  assert.equal(run.toolCalls.size, 0)
  assert.equal(Object.hasOwn(adapter, 'toolCalls'), false)
})
