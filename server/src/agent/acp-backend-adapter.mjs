import { randomUUID } from 'node:crypto'
import { AgentError } from './backend-adapter.mjs'
import { BACKEND_AGENT_INSTRUCTIONS } from './backend-agent-instructions.mjs'
import {
  acpBackendProfile,
  endpointAvailable,
} from './acp-backend-profile.mjs'
import {
  activityFromUpdate,
  coordinatorKey,
  coordinatorPresentation,
  nativeToolOutput,
  normalizeCoordinatorContent,
  projectSessionKey,
  sessionSummary,
} from './acp-backend-session-utils.mjs'
import { AcpProcessClient } from './acp-process-client.mjs'
import { AcpSessionRegistry } from './acp-session-registry.mjs'
import {
  ACP_SESSION_TOOL_NAMES,
  AcpSessionToolServer,
} from './acp-session-tools.mjs'

const MAX_SESSION_RESULTS = 100
const MAX_DELEGATION_RESULT_CHARS = 12_000

export { acpBackendProfile } from './acp-backend-profile.mjs'

function clean(value) {
  return String(value || '').trim()
}

function bounded(value, max = 300) {
  return clean(value).replace(/\s+/g, ' ').slice(0, max)
}

function deferred() {
  let resolvePromise
  let rejectPromise
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return { promise, resolve: resolvePromise, reject: rejectPromise }
}

export class AcpBackendAdapter {
  constructor({
    protocol = 'opencode',
    root = process.cwd(),
    ownership = 'owned',
    permissionMode = 'native',
    model = '',
    timeoutMs = 300_000,
    directory = process.cwd(),
    cliPath = '',
    configDirectory = '',
    claudeExecutable = '',
    baseUrl = '',
    token = '',
    tokenFile = '',
    coordinatorAgent = '',
    profile,
    sessionStatePath = null,
    client,
    clientFactory = options => new AcpProcessClient(options),
    backendAvailable = endpointAvailable,
    sessionToolServer,
    nativeDelegationAdapter,
  } = {}) {
    this.protocol = protocol
    this.root = root
    this.ownership = ownership === 'external' ? 'external' : 'owned'
    this.permissionMode = permissionMode === 'full' ? 'full' : 'native'
    this.model = clean(model)
    this.timeoutMs = timeoutMs
    this.directory = directory
    this.baseUrl = clean(baseUrl) || null
    this.coordinatorAgent = clean(coordinatorAgent)
    this.profile = profile || acpBackendProfile({
      protocol,
      root,
      directory,
      cliPath,
      baseUrl,
      token,
      tokenFile,
      coordinatorAgent,
      configDirectory,
      claudeExecutable,
      permissionMode: this.permissionMode,
      model: this.model,
    })
    this.registry = new AcpSessionRegistry({ filePath: sessionStatePath })
    this.sessionToolServer = sessionToolServer || new AcpSessionToolServer()
    this.pendingPermissions = new Map()
    this.resolvedPermissions = new Map()
    this.coordinatorSessions = new Map()
    this.coordinatorSessionPromises = new Map()
    this.sessionQueues = new Map()
    this.activeCoordinatorTurns = new Set()
    this.delegatedWorkRuns = new Map()
    this.pendingCoordinatorFacts = new Map()
    this.nativeDelegationAdapter = nativeDelegationAdapter || null
    this.backendAvailable = client ? null : backendAvailable
    this.client = client || clientFactory({
      label: this.profile.label,
      command: this.profile.command,
      args: this.profile.args,
      cwd: this.profile.cwd,
      env: this.profile.env,
      timeoutMs,
      onPermission: (params, context) => (
        this.handlePermission(params, context)
      ),
    })
  }

  get label() {
    return this.profile.label
  }

  describe() {
    return {
      kind: this.protocol,
      label: this.label,
      baseUrl: this.baseUrl,
      uiPath: null,
      model: this.model || null,
      directory: this.directory,
      ownership: this.ownership,
      permissionMode: this.permissionMode,
      transport: 'acp',
      backendAgent: this.coordinatorAgent || null,
      sessionModel: 'one-persistent-backend-agent',
      capabilities: {
        delegation: true,
        permissions: true,
        backendUi: Boolean(this.profile.backendUi),
        nativeSessionHistory: true,
        externalMcp: this.profile.externalMcp,
      },
    }
  }

  async health() {
    try {
      if (
        this.profile.readinessMessage
        && this.baseUrl
        && this.backendAvailable
        && !await this.backendAvailable(this.baseUrl)
      ) {
        return {
          ok: false,
          protocol: this.protocol,
          ownership: this.ownership,
          transport: 'acp',
          error: this.profile.readinessMessage,
        }
      }
      const initialized = await this.client.start()
      return {
        ok: true,
        protocol: this.protocol,
        ownership: this.ownership,
        transport: 'acp',
        agentInfo: initialized.agentInfo || null,
        capabilities: initialized.agentCapabilities || {},
      }
    } catch (error) {
      return {
        ok: false,
        protocol: this.protocol,
        ownership: this.ownership,
        transport: 'acp',
        error: `${error.message}${
          clean(this.client.stderr) ? `：${clean(this.client.stderr)}` : ''
        }`,
      }
    }
  }

  serialize(key, operation) {
    const previous = this.sessionQueues.get(key) || Promise.resolve()
    const current = previous.catch(() => {}).then(operation)
    this.sessionQueues.set(key, current)
    return current.finally(() => {
      if (this.sessionQueues.get(key) === current) {
        this.sessionQueues.delete(key)
      }
    })
  }

  async ensureCoordinatorSession(ownerId, mcpServers = []) {
    const key = coordinatorKey(ownerId, this.protocol)
    if (this.coordinatorSessions.has(key)) {
      return this.coordinatorSessions.get(key)
    }
    if (this.coordinatorSessionPromises.has(key)) {
      return this.coordinatorSessionPromises.get(key)
    }
    const pending = (async () => {
      const stored = this.registry.get(key)
      let session
      if (stored?.sessionId) {
        try {
          session = await this.client.resumeSession(stored.sessionId, {
            cwd: stored.cwd || this.directory,
            mcpServers,
            meta: this.coordinatorMeta(ownerId),
            ownerId,
            role: 'coordinator',
          })
          session.isNew = false
        } catch {
          this.registry.delete(key)
        }
      }
      if (!session) {
        session = await this.client.newSession({
          cwd: this.directory,
          mcpServers,
          meta: this.coordinatorMeta(ownerId),
          ownerId,
          role: 'coordinator',
        })
        session.isNew = true
      }
      await this.configureSession(session, 'coordinator')
      this.coordinatorSessions.set(key, session)
      this.registry.set(key, session)
      return session
    })().finally(() => this.coordinatorSessionPromises.delete(key))
    this.coordinatorSessionPromises.set(key, pending)
    return pending
  }

  coordinatorMeta(ownerId) {
    return this.profile.coordinatorMeta?.(ownerId) || null
  }

  async configureSession(session, role) {
    const options = Array.isArray(session?.response?.configOptions)
      ? session.response.configOptions
      : []
    const desired = [
      ...(role === 'coordinator' && this.coordinatorAgent
        ? [['mode', this.coordinatorAgent]]
        : []),
      ...(this.model && this.model !== 'auto'
        ? [['model', this.model]]
        : []),
    ]
    for (const [configId, value] of desired) {
      const option = options.find(item => item.id === configId)
      const supported = option?.type !== 'select'
        || option.options?.some(item => item.value === value)
      if (!option || !supported || option.currentValue === value) continue
      await this.client.setSessionConfigOption(
        session.sessionId,
        configId,
        value,
      )
      option.currentValue = value
    }
  }

  optionFor(params, decision) {
    const options = Array.isArray(params?.options) ? params.options : []
    const kinds = decision === 'always'
      ? ['allow_once', 'allow_always']
      : ['reject_always', 'reject_once']
    for (const kind of kinds) {
      const option = options.find(candidate => candidate.kind === kind)
      if (option) return option
    }
    return null
  }

  async handlePermission(params, { signal, session } = {}) {
    const name = clean(params?.toolCall?.name || params?.toolCall?.title)
    const internal = ACP_SESSION_TOOL_NAMES.some(toolName => (
      name === toolName
      || name.endsWith(`__${toolName}`)
      || name.startsWith(`${toolName} (`)
    ))
    if (
      this.permissionMode === 'full'
      || internal
    ) {
      const option = this.optionFor(params, 'always')
      return option
        ? { outcome: { outcome: 'selected', optionId: option.optionId } }
        : { outcome: { outcome: 'cancelled' } }
    }
    const id = `auth_${randomUUID().replaceAll('-', '')}`
    const pending = deferred()
    const permission = {
      id,
      workId: session?.coordinationRunId || null,
      status: 'pending',
      category: bounded(name, 80) || 'unknown',
      summary: [
        bounded(name, 80),
        bounded(
          params?.toolCall?.rawInput?.description
          || params?.toolCall?.rawInput?.command
          || params?.toolCall?.rawInput?.path
          || '',
        ),
      ].filter(Boolean).join('：'),
      patterns: [],
    }
    const record = {
      ...permission,
      ownerId: clean(session?.ownerId),
      sessionId: clean(session?.sessionId),
      permissionScopeId: clean(session?.permissionScopeId),
      params,
      pending,
      onEvent: session?.onEvent,
    }
    this.pendingPermissions.set(id, record)
    record.onEvent?.({ type: 'backend.permission.requested', permission })
    signal?.addEventListener('abort', () => {
      this.cancelPermission(record)
    }, { once: true })
    return pending.promise
  }

  cancelPermission(record) {
    if (!record || !this.pendingPermissions.delete(record.id)) return false
    record.pending.resolve({ outcome: { outcome: 'cancelled' } })
    const permission = {
      id: record.id,
      workId: record.workId,
      status: 'cancelled',
      category: record.category,
      summary: record.summary,
    }
    record.onEvent?.({ type: 'backend.permission.resolved', permission })
    return true
  }

  async respondPermission(id, decision, { ownerId } = {}) {
    const record = this.pendingPermissions.get(String(id))
    if (!record) {
      const resolved = this.resolvedPermissions.get(String(id))
      if (resolved?.ownerId === clean(ownerId)) return resolved.permission
    }
    if (!record || record.ownerId !== clean(ownerId)) {
      throw new AgentError('权限请求不存在、已经失效或不属于当前用户', {
        protocol: this.protocol,
      })
    }
    this.pendingPermissions.delete(record.id)
    const approved = decision === 'always'
    const option = this.optionFor(
      record.params,
      approved ? 'always' : 'reject',
    )
    record.pending.resolve(option
      ? { outcome: { outcome: 'selected', optionId: option.optionId } }
      : { outcome: { outcome: 'cancelled' } })
    const permission = {
      id: record.id,
      workId: record.workId,
      status: approved ? 'approved' : 'denied',
      category: record.category,
      summary: record.summary,
    }
    record.onEvent?.({ type: 'backend.permission.resolved', permission })
    this.resolvedPermissions.set(permission.id, {
      ownerId: record.ownerId,
      permission,
    })
    while (this.resolvedPermissions.size > 200) {
      this.resolvedPermissions.delete(
        this.resolvedPermissions.keys().next().value,
      )
    }
    return permission
  }

  cancelPermissionsForScope(permissionScopeId) {
    const scope = clean(permissionScopeId)
    if (!scope) return
    for (const record of this.pendingPermissions.values()) {
      if (record.permissionScopeId !== scope) continue
      this.cancelPermission(record)
    }
  }

  onSessionUpdate(run, update) {
    run.toolCalls ||= new Map()
    const activity = activityFromUpdate(update, run.toolCalls)
    if (activity) run.onEvent?.({ type: 'backend.activity', activity })
    if (!this.profile.nativeDelegation) return
    if (!['tool_call', 'tool_call_update'].includes(update?.sessionUpdate)) {
      return
    }
    const id = clean(update.toolCallId)
    const merged = {
      ...(run.nativeToolCalls.get(id) || {}),
      ...update,
    }
    run.nativeToolCalls.set(id, merged)
    if (merged.status !== 'completed' || run.delegation) return
    const name = clean(merged.name || merged.title).toLowerCase()
    if (!/sessions_(spawn|send)/.test(name)) return
    const output = nativeToolOutput(merged.rawOutput)
    const sessionId = clean(
      output.childSessionKey
      || output.sessionKey
      || output.session_id
      || output.sessionId,
    )
    if (!sessionId) return
    const delegationId = clean(output.runId)
    if (!delegationId) return
    run.delegation = this.createNativeDelegation(run, {
      delegationId,
      sessionId,
      directory: clean(
        merged.rawInput?.cwd
        || merged.rawInput?.directory
        || this.directory,
      ),
      title: bounded(
        merged.rawInput?.label
        || merged.rawInput?.task
        || merged.rawInput?.message,
        160,
      ) || this.profile.defaultDelegationTitle || `${this.label} 项目任务`,
    })
  }

  async listProjectSessions({ query, directory, limit } = {}) {
    const sessions = await this.client.listSessions({
      cwd: clean(directory) || undefined,
      limit: limit || 20,
    })
    this.registry.setProjects(sessions
      .filter(session => clean(session?.sessionId) && clean(session?.cwd))
      .map(session => [
        projectSessionKey(this.protocol, session.sessionId),
        session,
      ]))
    const coordinators = new Set(
      [...this.coordinatorSessions.values()].map(item => item.sessionId),
    )
    const needle = clean(query).toLowerCase()
    return {
      sessions: sessions
        .filter(session => !coordinators.has(clean(session.sessionId)))
        .map(sessionSummary)
        .filter(session => !needle || [
          session.title,
          session.directory,
        ].join(' ').toLowerCase().includes(needle)),
    }
  }

  rememberProjectSession(session) {
    if (!clean(session?.sessionId) || !clean(session?.cwd)) return
    this.registry.setProject(
      projectSessionKey(this.protocol, session.sessionId),
      session,
    )
  }

  findDelegation({ delegation_id: delegationId, session_id: sessionId }) {
    return [...this.delegatedWorkRuns.values()]
      .map(run => run.delegation)
      .find(record => (
        (clean(delegationId) && record?.id === clean(delegationId))
        || (clean(sessionId) && record?.sessionId === clean(sessionId))
      ))
  }

  createDelegation(run, {
    session,
    prompt,
    directory,
    title,
  }) {
    if (run.delegation) {
      throw new AgentError('当前协调轮次已经启动了一个第三层任务', {
        protocol: this.protocol,
      })
    }
    const controller = new AbortController()
    const record = {
      id: `${this.protocol}_run_${randomUUID()}`,
      sessionId: session.sessionId,
      directory,
      title: bounded(title || prompt, 160) || `${this.label} 项目任务`,
      ownerId: run.ownerId,
      workId: run.coordinationRunId,
      status: 'running',
      controller,
      result: null,
      error: null,
    }
    run.delegation = record
    this.delegatedWorkRuns.set(run.coordinationRunId, run)
    record.promise = this.serialize(`target:${record.sessionId}`, async () => {
      const permissionScopeId = `prompt_${randomUUID()}`
      try {
        session.ownerId = run.ownerId
        session.coordinationRunId = run.coordinationRunId
        session.onEvent = run.onEvent
        session.permissionScopeId = permissionScopeId
        const result = await this.client.prompt(record.sessionId, prompt, {
          signal: controller.signal,
          timeoutMs: 0,
          onUpdate: update => this.onSessionUpdate(run, update),
        })
        record.status = 'completed'
        record.result = result
        return {
          id: record.id,
          sessionId: record.sessionId,
          directory: record.directory,
          title: record.title,
          content: result.content,
        }
      } catch (error) {
        record.status = controller.signal.aborted ? 'cancelled' : 'failed'
        record.error = error
        throw error
      } finally {
        this.cancelPermissionsForScope(permissionScopeId)
        if (session.permissionScopeId === permissionScopeId) {
          session.permissionScopeId = null
        }
      }
    })
    record.promise.catch(() => {})
    return record
  }

  async startProjectSession(run, { prompt, directory, title }) {
    const cwd = clean(directory)
    const session = await this.client.newSession({
      cwd,
      ownerId: run.ownerId,
      role: 'project',
    })
    this.rememberProjectSession({
      ...session,
      cwd,
      title: clean(title || prompt),
    })
    await this.configureSession(session, 'project')
    const record = this.createDelegation(run, {
      session,
      prompt: clean(prompt),
      directory: cwd,
      title,
    })
    return {
      status: 'started',
      delegation_id: record.id,
      session_id: record.sessionId,
      title: record.title,
      directory: record.directory,
    }
  }

  async continueProjectSession(
    run,
    { session_id: sessionId, prompt, directory },
  ) {
    const requestedDirectory = clean(directory)
    const active = this.findDelegation({ session_id: sessionId })
    const remembered = this.registry.getProject(
      projectSessionKey(this.protocol, sessionId),
    )
    let existing = null
    let cwd = clean(
      requestedDirectory
      || active?.directory
      || remembered?.cwd,
    )
    if (!cwd) {
      const sessions = await this.client.listSessions({
        limit: MAX_SESSION_RESULTS,
      })
      existing = sessions.find(item => (
        clean(item.sessionId) === clean(sessionId)
      ))
      cwd = clean(existing?.cwd)
    }
    if (!cwd) {
      throw new AgentError(
        `${this.label} Session 的项目目录未知，请先查询 Session 列表后再继续`,
        { protocol: this.protocol },
      )
    }
    const session = await this.client.resumeSession(clean(sessionId), {
      cwd,
      ownerId: run.ownerId,
      role: 'project',
    })
    this.rememberProjectSession({
      ...existing,
      ...session,
      cwd,
      title: existing?.title || remembered?.title,
    })
    await this.configureSession(session, 'project')
    const record = this.createDelegation(run, {
      session,
      prompt: clean(prompt),
      directory: cwd,
      title: clean(prompt),
    })
    return {
      status: 'started',
      delegation_id: record.id,
      session_id: record.sessionId,
      title: record.title,
      directory: record.directory,
    }
  }

  statusForDelegation(input) {
    const record = this.findDelegation(input)
    if (!record) return { status: 'not_found' }
    return {
      status: record.status,
      delegation_id: record.id,
      session_id: record.sessionId,
      title: record.title,
      directory: record.directory,
      ...(record.status === 'completed'
        ? { result: clean(record.result?.content).slice(0, 4000) }
        : {}),
      ...(record.status === 'failed'
        ? { error: clean(record.error?.message || record.error) }
        : {}),
    }
  }

  async cancelDelegation(input) {
    const record = this.findDelegation(input)
    if (!record) return { status: 'not_found' }
    if (!['completed', 'failed', 'cancelled'].includes(record.status)) {
      record.status = 'cancelled'
      if (this.nativeDelegationAdapter) {
        await this.nativeDelegationAdapter.cancel({
          runId: record.id,
          sessionId: record.sessionId,
        }).catch(() => {})
      }
      record.controller.abort(new Error('用户已取消这项项目任务'))
      if (!this.nativeDelegationAdapter) {
        await this.client.cancelSession(record.sessionId).catch(() => {})
      }
    }
    return {
      status: record.status,
      delegation_id: record.id,
      session_id: record.sessionId,
    }
  }

  toolContext(run) {
    return {
      listSessions: input => this.listProjectSessions(input),
      startSession: input => this.startProjectSession(run, input),
      sendSession: input => this.continueProjectSession(run, input),
      sessionStatus: input => this.statusForDelegation(input),
      cancelSession: input => this.cancelDelegation(input),
    }
  }

  coordinatorInstructions(message) {
    const sessionInstructions = this.profile.sessionInstructions || [
      'The qwen_audio_agent MCP tools are the only interface for opening,',
      'continuing, querying, and cancelling third-layer project Sessions.',
      'session_start and session_send are asynchronous. After either returns',
      'status=started, return the delegated response required by the request',
      'envelope and stop this turn. Never poll it in the same turn.',
    ].join(' ')
    return [
      '<qwen_audio_agent_backend_instructions>',
      BACKEND_AGENT_INSTRUCTIONS,
      sessionInstructions,
      '</qwen_audio_agent_backend_instructions>',
      '',
      message,
    ].join('\n')
  }

  async coordinatorTurn(message, {
    ownerId,
    coordinationRunId,
    signal,
    onEvent,
  }) {
    const run = {
      ownerId: clean(ownerId),
      coordinationRunId: clean(coordinationRunId),
      onEvent,
      delegation: null,
      nativeToolCalls: new Map(),
      toolCalls: new Map(),
      initialPromptDone: false,
    }
    const ownerKey = clean(ownerId)
    const pendingFacts = this.pendingCoordinatorFacts.get(ownerKey) || []
    const prompt = pendingFacts.length
      ? [
          '<qwen_audio_agent_reconciliation>',
          ...pendingFacts.map(fact => JSON.stringify(fact)),
          '</qwen_audio_agent_reconciliation>',
          '以上是 Gateway 已执行并验证的控制结果。请更新你的上下文，不要重复执行。',
          '',
          message,
        ].join('\n')
      : message
    let registration = null
    if (this.profile.externalMcp) {
      registration = await this.sessionToolServer.register(
        this.toolContext(run),
      )
    }
    const mcpServers = registration ? [registration.descriptor] : []
    const session = await this.ensureCoordinatorSession(ownerId, mcpServers)
    const permissionScopeId = `prompt_${randomUUID()}`
    run.sessionId = session.sessionId
    session.ownerId = clean(ownerId)
    session.coordinationRunId = clean(coordinationRunId)
    session.onEvent = onEvent
    session.permissionScopeId = permissionScopeId
    this.activeCoordinatorTurns.add(session.sessionId)
    try {
      // Re-supply MCP definitions on resume: ACP Sessions do not require the
      // agent to persist client-provided MCP connections across processes.
      if (registration && !session.isNew) {
        await this.client.resumeSession(session.sessionId, {
          cwd: session.cwd || this.directory,
          mcpServers,
          meta: this.coordinatorMeta(ownerId),
          ownerId,
          role: 'coordinator',
        })
      }
      const result = await this.client.prompt(
        session.sessionId,
        this.coordinatorInstructions(prompt),
        {
          signal,
          timeoutMs: this.timeoutMs,
          onUpdate: update => this.onSessionUpdate(run, update),
        },
      )
      run.initialPromptDone = true
      session.isNew = false
      if (pendingFacts.length) this.pendingCoordinatorFacts.delete(ownerKey)
      this.registry.set(
        coordinatorKey(ownerId, this.protocol),
        session,
      )
      return {
        run,
        session,
        result: {
          ...result,
          content: normalizeCoordinatorContent(result.content),
        },
      }
    } finally {
      this.activeCoordinatorTurns.delete(session.sessionId)
      registration?.release()
      this.cancelPermissionsForScope(permissionScopeId)
      if (session.permissionScopeId === permissionScopeId) {
        session.permissionScopeId = null
      }
    }
  }

  createNativeDelegation(run, {
    delegationId,
    sessionId,
    directory,
    title,
  }) {
    const controller = new AbortController()
    const record = {
      id: delegationId,
      sessionId,
      directory,
      title,
      ownerId: run.ownerId,
      workId: run.coordinationRunId,
      status: 'running',
      controller,
      result: null,
      error: null,
      parentSessionId: run.sessionId,
      nativeCompletion: deferred(),
    }
    this.delegatedWorkRuns.set(run.coordinationRunId, run)
    record.promise = this.waitForNativeDelegation(record, run)
    record.promise.catch(() => {})
    return record
  }

  async waitForNativeDelegation(record) {
    try {
      const completed = this.nativeDelegationAdapter
        ? await this.nativeDelegationAdapter.wait({
            runId: record.id,
            sessionId: record.sessionId,
            signal: record.controller.signal,
          })
        : { content: await record.nativeCompletion.promise }
      const content = clean(completed?.content)
      record.status = 'completed'
      record.result = { content }
      return {
        id: record.id,
        sessionId: record.sessionId,
        directory: record.directory,
        title: record.title,
        content,
      }
    } catch (error) {
      record.status = record.controller.signal.aborted ? 'cancelled' : 'failed'
      record.error = error
      throw error
    }
  }

  delegationResultPrompt(result, coordinationRunId) {
    return [
      '<qwen_audio_agent_delegation_result>',
      JSON.stringify({
        request_id: clean(coordinationRunId),
        delegation_id: result.id,
        target_session_id: result.sessionId,
        directory: result.directory,
        result: clean(result.content).slice(0, MAX_DELEGATION_RESULT_CHARS),
      }, null, 2),
      '</qwen_audio_agent_delegation_result>',
      '这是由 Gateway 验证并关联到当前请求的第三层 Session 最终结果。',
      '请只整理该可信结果并生成 presentation。',
      '返回当前 request_id 的 completed 最终 presentation；',
      '不要再次执行、委托或查询目标任务。',
    ].join('\n')
  }

  resultEnvelope(initial, delegation = null) {
    return {
      content: initial.result.content,
      raw: initial.result.response,
      protocol: this.protocol,
      metadata: {
        backendRef: {
          provider: this.protocol,
          role: 'backend',
          sessionId: initial.session.sessionId,
          directory: initial.session.cwd || this.directory,
        },
        ...(delegation
          ? {
              delegation: {
                id: delegation.id,
                sessionId: delegation.sessionId,
                title: delegation.title,
                directory: delegation.directory,
              },
            }
          : {}),
      },
    }
  }

  async runCoordinator(message, {
    ownerId,
    coordinationRunId,
    signal,
    onEvent,
  } = {}) {
    const key = coordinatorKey(ownerId, this.protocol)
    const initial = await this.serialize(
      `coordinator:${key}`,
      () => this.coordinatorTurn(message, {
        ownerId,
        coordinationRunId,
        signal,
        onEvent,
      }),
    )
    if (!initial.run.delegation) return this.resultEnvelope(initial)
    const delegation = initial.run.delegation
    onEvent?.({
      type: 'backend.delegated',
      delegation: {
        id: delegation.id,
        sessionId: delegation.sessionId,
        title: delegation.title,
        directory: delegation.directory,
        presentation: coordinatorPresentation(initial.result.content),
      },
    })
    try {
      const target = await delegation.promise
      onEvent?.({
        type: 'backend.delegation.completed',
        delegation: {
          id: target.id,
          sessionId: target.sessionId,
          title: target.title,
          directory: target.directory,
        },
      })
      const final = await this.serialize(
        `coordinator:${key}`,
        () => this.coordinatorTurn(
          this.delegationResultPrompt(target, coordinationRunId),
          {
            ownerId,
            coordinationRunId,
            signal,
            onEvent,
          },
        ),
      )
      return this.resultEnvelope(final, target)
    } finally {
      this.delegatedWorkRuns.delete(clean(coordinationRunId))
    }
  }

  canRecoverDelegatedWork(task) {
    return Boolean(
      this.nativeDelegationAdapter
      && task?.delegation?.id
      && task?.delegation?.sessionId,
    )
  }

  async recoverDelegatedWork(task, {
    signal,
    onEvent,
  } = {}) {
    if (!this.canRecoverDelegatedWork(task)) {
      throw new AgentError(`${this.label} 无法恢复这项第三层任务`, {
        protocol: this.protocol,
      })
    }
    const ownerId = clean(task.ownerId)
    const coordinationRunId = clean(task.id)
    const key = coordinatorKey(ownerId, this.protocol)
    const session = await this.ensureCoordinatorSession(ownerId)
    const run = {
      ownerId,
      coordinationRunId,
      onEvent,
      sessionId: session.sessionId,
      nativeToolCalls: new Map(),
      toolCalls: new Map(),
      initialPromptDone: true,
      delegation: null,
    }
    const saved = task.delegation
    const delegation = this.createNativeDelegation(run, {
      delegationId: clean(saved.id),
      sessionId: clean(saved.sessionId),
      directory: clean(saved.directory || this.directory),
      title: bounded(saved.title || task.objective, 160)
        || this.profile.defaultDelegationTitle
        || `${this.label} 项目任务`,
    })
    signal?.addEventListener('abort', () => {
      delegation.controller.abort(
        signal.reason || new Error('用户已取消这项项目任务'),
      )
    }, { once: true })
    onEvent?.({
      type: 'backend.delegated',
      delegation: {
        id: delegation.id,
        sessionId: delegation.sessionId,
        title: delegation.title,
        directory: delegation.directory,
        presentation: saved.presentation || null,
      },
    })
    try {
      const target = await delegation.promise
      onEvent?.({
        type: 'backend.delegation.completed',
        delegation: {
          id: target.id,
          sessionId: target.sessionId,
          title: target.title,
          directory: target.directory,
        },
      })
      const final = await this.serialize(
        `coordinator:${key}`,
        () => this.coordinatorTurn(
          this.delegationResultPrompt(target, coordinationRunId),
          {
            ownerId,
            coordinationRunId,
            signal,
            onEvent,
          },
        ),
      )
      return this.resultEnvelope(final, target)
    } finally {
      this.delegatedWorkRuns.delete(coordinationRunId)
    }
  }

  async coordinatorControl(workId, prompt, {
    ownerId,
    signal,
  } = {}) {
    const key = coordinatorKey(ownerId, this.protocol)
    return this.serialize(
      `coordinator:${key}`,
      () => this.coordinatorTurn(prompt, {
        ownerId,
        coordinationRunId: workId,
        signal,
        onEvent: null,
      }),
    )
  }

  async cancelDelegatedWork(workId, { ownerId, signal } = {}) {
    const run = this.delegatedWorkRuns.get(clean(workId))
    const record = run?.delegation
    if (!record || record.ownerId !== clean(ownerId)) {
      throw new AgentError(`没有找到可取消的 ${this.label} 项目任务`, {
        protocol: this.protocol,
      })
    }
    const coordinator = this.coordinatorSessions.get(
      coordinatorKey(ownerId, this.protocol),
    )
    const busy = coordinator
      && this.activeCoordinatorTurns.has(coordinator.sessionId)
    if (!busy) {
      try {
        const instruction = this.profile.cancelInstruction?.(record)
          || `请调用 qwen_audio_agent_session_cancel 取消 delegation_id=${record.id}。`
        await this.coordinatorControl(workId, [
          '<qwen_audio_agent_control kind="cancel">',
          instruction,
          '工具返回后只简短确认，不要做其他工作。',
          '</qwen_audio_agent_control>',
        ].join('\n'), { ownerId, signal })
        return {
          route: 'coordinator',
          layer: 'delegated',
          delegationId: record.id,
          sessionId: record.sessionId,
        }
      } catch {
        // Cancellation is urgent; fall through to the ACP transport.
      }
    }
    await this.cancelDelegation({ delegation_id: record.id })
    const ownerKey = clean(ownerId)
    const facts = this.pendingCoordinatorFacts.get(ownerKey) || []
    facts.push({
      kind: 'delegated_session_cancelled',
      work_id: clean(workId),
      delegation_id: record.id,
      target_session_id: record.sessionId,
      confirmed_at: new Date().toISOString(),
    })
    this.pendingCoordinatorFacts.set(ownerKey, facts.slice(-20))
    return {
      route: 'adapter',
      layer: 'delegated',
      delegationId: record.id,
      sessionId: record.sessionId,
    }
  }

  async queryDelegatedWork(workId, question, { ownerId, signal } = {}) {
    const run = this.delegatedWorkRuns.get(clean(workId))
    const record = run?.delegation
    if (!record || record.ownerId !== clean(ownerId)) {
      throw new AgentError(`没有找到对应的 ${this.label} 项目任务`, {
        protocol: this.protocol,
      })
    }
    const instruction = this.profile.statusInstruction?.(record)
      || `请调用 qwen_audio_agent_session_status 查询 delegation_id=${record.id}。`
    const result = await this.coordinatorControl(workId, [
      '<qwen_audio_agent_control kind="status">',
      instruction,
      clean(question)
        ? `用户的具体问题：${clean(question)}`
        : '请自然地说明当前状态。',
      '只根据工具结果返回 completed/respond JSON，不要扫描项目或执行任务。',
      '</qwen_audio_agent_control>',
    ].join('\n'), { ownerId, signal })
    return this.resultEnvelope(result, record)
  }

  async uiUrl(ownerId) {
    if (!this.profile.uiUrl) return null
    const key = coordinatorKey(ownerId, this.protocol)
    const session = this.coordinatorSessions.get(key) || this.registry.get(key)
    return this.profile.uiUrl({
      baseUrl: this.baseUrl,
      sessionId: session?.sessionId || null,
      ownerId,
    })
  }

  async close() {
    for (const run of this.delegatedWorkRuns.values()) {
      run.delegation?.controller.abort(
        new Error(`${this.label} backend is shutting down`),
      )
    }
    for (const record of this.pendingPermissions.values()) {
      record.pending.resolve({ outcome: { outcome: 'cancelled' } })
    }
    this.pendingPermissions.clear()
    await Promise.allSettled([
      this.sessionToolServer.close(),
      this.client.close(),
    ])
  }
}
