import assert from 'node:assert/strict'
import test from 'node:test'
import {
  GATEWAY_CLIENT_EVENT_TYPES,
  GATEWAY_SERVER_EVENT_TYPES,
  GatewayClientEvent,
  GatewayServerEvent,
  GatewayTaskEvent,
} from '../shared/realtime-events.mjs'

test('keeps Gateway realtime event names unique within each direction', () => {
  assert.equal(
    GATEWAY_CLIENT_EVENT_TYPES.size,
    Object.keys(GatewayClientEvent).length,
  )
  assert.equal(
    GATEWAY_SERVER_EVENT_TYPES.size,
    Object.keys(GatewayServerEvent).length
      + Object.keys(GatewayTaskEvent).length,
  )
})

test('defines the shared playback acknowledgement lifecycle', () => {
  assert.deepEqual([
    GatewayServerEvent.AUDIO_DELTA,
    GatewayServerEvent.AUDIO_DONE,
    GatewayClientEvent.PLAYBACK_STARTED,
    GatewayClientEvent.PLAYBACK_ENDED,
    GatewayClientEvent.PLAYBACK_CANCELLED,
  ], [
    'audio.delta',
    'audio.done',
    'playback.started',
    'playback.ended',
    'playback.cancelled',
  ])
})

// 桌面隐藏用 sleep 显式进入仅唤醒词监听；快捷键/托盘唤起靠 wake
// 恢复前台连接，服务端用 voice.sleep 回报唤醒进展。
test('defines the shared sleep wake lifecycle', () => {
  assert.deepEqual([
    GatewayClientEvent.SLEEP,
    GatewayClientEvent.WAKE,
    GatewayServerEvent.VOICE_SLEEP,
  ], [
    'sleep',
    'wake',
    'voice.sleep',
  ])
})
