import assert from 'node:assert/strict'
import test from 'node:test'
import { activityFromUpdate } from '../src/agent/acp-backend-session-utils.mjs'

test('projects an ACP plan into stable task progress', () => {
  assert.deepEqual(activityFromUpdate({
    sessionUpdate: 'plan',
    entries: [
      { content: 'Inspect the project', status: 'completed' },
      { content: 'Implement the change', status: 'in_progress' },
      { content: 'Run tests', status: 'pending' },
    ],
  }), {
    id: 'acp-plan',
    kind: 'plan',
    status: 'running',
    detail: 'Implement the change',
    completed: 1,
    total: 3,
  })
})

test('keeps the ACP human-readable tool title separate from raw details', () => {
  assert.deepEqual(activityFromUpdate({
    sessionUpdate: 'tool_call',
    toolCallId: 'tool-1',
    name: 'shell',
    title: 'Run project tests',
    status: 'pending',
    rawInput: {
      command: 'npm test',
      description: '验证项目测试',
    },
  }), {
    id: 'tool-1',
    kind: 'tool',
    tool: 'shell',
    label: '验证项目测试',
    status: 'pending',
    category: 'run',
    detail: '验证项目测试',
  })
})
