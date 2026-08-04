import assert from 'node:assert/strict'
import test from 'node:test'
import {
  desktopAutoSleepSeconds,
  desktopCanSleep,
  desktopSleepDeadline,
  desktopWorkSettled,
} from '../src/desktop-sleep.js'

test('uses a 120 second desktop sleep default and supports never', () => {
  assert.equal(desktopAutoSleepSeconds(''), 120)
  assert.equal(desktopAutoSleepSeconds('?autoSleepSeconds=300'), 300)
  assert.equal(desktopAutoSleepSeconds('?autoSleepSeconds=0'), 0)
  assert.equal(desktopAutoSleepSeconds('?autoSleepSeconds=5'), 120)
})

test('waits for tasks, permission prompts, transcripts, and voice playback', () => {
  assert.equal(desktopWorkSettled(), true)
  assert.equal(desktopWorkSettled({ tasks: [{ phase: 'running' }] }), false)
  assert.equal(desktopWorkSettled({
    tasks: [{ phase: 'completed', authorization: { status: 'pending' } }],
  }), false)
  assert.equal(desktopWorkSettled({ messages: [{ live: true }] }), false)
  assert.equal(desktopWorkSettled({ voiceState: 'speaking' }), false)
  assert.equal(desktopWorkSettled({ voiceState: 'listening' }), false)
})

test('only sleeps from a healthy active desktop', () => {
  assert.equal(desktopCanSleep({
    settled: true,
    connectionState: 'connected',
  }), true)
  assert.equal(desktopCanSleep({
    settled: true,
    connectionState: 'unavailable',
  }), false)
  assert.equal(desktopCanSleep({
    settled: true,
    connectionState: 'connected',
    lifecycle: 'waking',
  }), false)
})

test('starts the timeout after both interaction and work have ended', () => {
  assert.equal(desktopSleepDeadline({
    lastInteractionAt: 1_000,
    workSettledAt: 10_000,
    timeoutSeconds: 120,
  }), 130_000)
})
