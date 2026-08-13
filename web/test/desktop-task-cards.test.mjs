import assert from 'node:assert/strict'
import test from 'node:test'
import {
  desktopTaskCards,
  desktopTaskElapsedLabel,
  desktopTaskElapsedSeconds,
} from '../src/desktop-task-cards.js'

test('shows ordinary work but excludes reminders, scheduled work and controls', () => {
  const cards = desktopTaskCards([
    { id: 'scheduled', kind: 'scheduled_task', phase: 'running' },
    { id: 'reminder', kind: 'reminder', phase: 'running' },
    { id: 'control', kind: 'control', phase: 'running' },
    { id: 'work-2', kind: 'work', phase: 'delegated', createdAt: 2 },
    { id: 'work-1', kind: 'work', phase: 'running', createdAt: 1 },
  ])
  assert.deepEqual(cards.map(task => task.id), ['work-1', 'work-2'])
})

test('supports legacy work events and ignores scheduled placeholders', () => {
  assert.deepEqual(desktopTaskCards([
    { id: 'legacy', phase: 'queued' },
    { id: 'future', kind: 'work', phase: 'scheduled' },
  ]).map(task => task.id), ['legacy'])
})

test('advances active elapsed time from the task start', () => {
  assert.equal(desktopTaskElapsedSeconds({
    phase: 'running',
    startedAt: 1_000,
    elapsedMs: 500,
  }, 4_400), 3)
  assert.equal(desktopTaskElapsedSeconds({
    phase: 'completed',
    startedAt: 1_000,
    elapsedMs: 2_100,
  }, 9_000), 2)
  assert.equal(desktopTaskElapsedLabel({
    phase: 'running',
    startedAt: 1_000,
  }, 126_000), '2m 5s')
})
