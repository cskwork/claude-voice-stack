import assert from 'node:assert/strict'
import test from 'node:test'
import { TaskManager } from '../src/task/task-manager.mjs'
import { ToolCallHandler } from '../src/voice/tools/tool-call-handler.mjs'
import { TurnTranscripts } from '../src/voice/tools/turn-transcripts.mjs'

function harness({
  coordinator = null,
  manager = new TaskManager(),
  memoryStore = null,
} = {}) {
  const outputs = []
  const transcripts = new TurnTranscripts({ waitMs: 5 })
  const handler = new ToolCallHandler({
    taskManager: manager,
    ownerId: 'owner',
    sessionId: 'voice',
    transcripts,
    getFrontend: () => ({
      sendFunctionOutput: async (...args) => outputs.push(args),
    }),
    getTurnId: () => 'turn-1',
    getTurnGeneration: () => 1,
    coordinator: coordinator || {
      run: async () => ({ content: '完成', metadata: {} }),
    },
    memoryService: memoryStore,
    notesStore: null,
    onMemoryChanged: () => {},
    getClientContext: () => ({}),
    getConversationContext: () => [],
  })
  return { outputs, manager, handler }
}

test('handleScheduleReminder creates a scheduled reminder with valid future time', async () => {
  const { outputs, manager, handler } = harness()
  const future = new Date(Date.now() + 60_000).toISOString()

  await handler.handle({
    call_id: 'call-1',
    name: 'schedule_reminder',
    arguments: JSON.stringify({
      execute_at: future,
      reminder: '三点开会',
      type: 'reminder',
    }),
  }, { turnId: 'turn-1', turnGeneration: 1 })

  assert.equal(outputs.length, 1)
  const [callId, output] = outputs[0]
  assert.equal(callId, 'call-1')
  assert.equal(output.status, 'scheduled')
  assert.ok(output.reminder_id)
  assert.equal(output.type, 'reminder')
  assert.equal(output.execute_at, future)

  const task = manager.get(output.reminder_id, { ownerId: 'owner' })
  assert.equal(task.status, 'scheduled')
  assert.equal(task.kind, 'reminder')
})

test('handleScheduleReminder rejects past time with error', async () => {
  const { outputs, handler } = harness()
  const past = new Date(Date.now() - 60_000).toISOString()

  await handler.handle({
    call_id: 'call-2',
    name: 'schedule_reminder',
    arguments: JSON.stringify({
      execute_at: past,
      reminder: '过去的提醒',
      type: 'reminder',
    }),
  }, { turnId: 'turn-1', turnGeneration: 1 })

  assert.equal(outputs.length, 1)
  const [, output] = outputs[0]
  assert.equal(output.status, 'error')
  assert.equal(output.error_code, 'invalid_time')
})

test('handleScheduleReminder with type=task creates scheduled_task kind', async () => {
  const { outputs, manager, handler } = harness()
  const future = new Date(Date.now() + 60_000).toISOString()

  await handler.handle({
    call_id: 'call-3',
    name: 'schedule_reminder',
    arguments: JSON.stringify({
      execute_at: future,
      reminder: '查构建状态',
      type: 'task',
    }),
  }, { turnId: 'turn-1', turnGeneration: 1 })

  assert.equal(outputs.length, 1)
  const [, output] = outputs[0]
  assert.equal(output.status, 'scheduled')
  assert.equal(output.type, 'task')

  const task = manager.get(output.reminder_id, { ownerId: 'owner' })
  assert.equal(task.kind, 'scheduled_task')
  assert.ok(task.timeoutMs > 0)
  assert.equal(task.progressCheckMs, null)
})

test('handleScheduleReminder defaults type to reminder when not specified', async () => {
  const { outputs, handler } = harness()
  const future = new Date(Date.now() + 60_000).toISOString()

  await handler.handle({
    call_id: 'call-4',
    name: 'schedule_reminder',
    arguments: JSON.stringify({
      execute_at: future,
      reminder: '默认提醒',
    }),
  }, { turnId: 'turn-1', turnGeneration: 1 })

  const [, output] = outputs[0]
  assert.equal(output.type, 'reminder')
})

test('handleScheduleReminder defaults recurrence to once', async () => {
  const { outputs, handler } = harness()
  const future = new Date(Date.now() + 60_000).toISOString()

  await handler.handle({
    call_id: 'call-5',
    name: 'schedule_reminder',
    arguments: JSON.stringify({
      execute_at: future,
      reminder: '每天提醒',
      recurrence: 'daily',
    }),
  }, { turnId: 'turn-1', turnGeneration: 1 })

  const [, output] = outputs[0]
  assert.equal(output.recurrence, 'daily')
})

test('lists scheduled reminders and cancels the latest one without an id', async () => {
  const { outputs, manager, handler } = harness()
  const future = new Date(Date.now() + 60_000).toISOString()
  await handler.handle({
    call_id: 'call-create-listable',
    name: 'schedule_reminder',
    arguments: JSON.stringify({
      execute_at: future,
      reminder: '记得开会',
      type: 'reminder',
    }),
  }, { turnId: 'turn-1', turnGeneration: 1 })
  const reminderId = outputs.at(-1)[1].reminder_id

  await handler.handle({
    call_id: 'call-list-reminders',
    name: 'get_agent_task_status',
    arguments: JSON.stringify({ list_all: true }),
  }, { turnId: 'turn-1', turnGeneration: 1 })
  const listing = outputs.at(-1)[1]
  assert.equal(listing.status, 'ok')
  assert.equal(listing.count, 1)
  assert.deepEqual(listing.tasks[0], {
    work_id: reminderId,
    status: 'scheduled',
    kind: 'reminder',
    objective: '记得开会',
    execute_at: future,
    recurrence: 'once',
  })

  await handler.handle({
    call_id: 'call-cancel-latest-reminder',
    name: 'cancel_agent_task',
    arguments: '{}',
  }, { turnId: 'turn-1', turnGeneration: 1 })
  assert.equal(outputs.at(-1)[1].status, 'cancelled')
  assert.equal(manager.get(reminderId, { ownerId: 'owner' }).status, 'cancelled')
})

test('scheduled tasks resolve the latest user context when they execute', async () => {
  let coordinatorInput
  const memories = [{ scope: 'user', content: '默认使用中文' }]
  const { outputs, manager, handler } = harness({
    memoryStore: {
      list: () => memories,
    },
    coordinator: {
      run: async input => {
        coordinatorInput = input
        return { content: '完成', metadata: {} }
      },
    },
  })
  const future = new Date(Date.now() + 60_000).toISOString()
  await handler.handle({
    call_id: 'call-create-contextual-task',
    name: 'schedule_reminder',
    arguments: JSON.stringify({
      execute_at: future,
      reminder: '检查构建状态',
      type: 'task',
    }),
  }, { turnId: 'turn-1', turnGeneration: 1 })
  const taskId = outputs.at(-1)[1].reminder_id
  memories.push({ scope: 'memory', content: '用户正在维护语音项目' })

  await manager.tasks.get(taskId).runner('检查构建状态', {
    onEvent: () => {},
    signal: new AbortController().signal,
  })

  assert.deepEqual(coordinatorInput.userMemories, memories)
})
