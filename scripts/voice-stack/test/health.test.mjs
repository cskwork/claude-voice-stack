import assert from 'node:assert/strict'
import test from 'node:test'
import { aggregateHealth, formatBytes, formatHealth, probeHttp, probeSpeechToSpeech } from '../lib/health.mjs'

test('aggregateHealth ranks failed > starting > degraded > stopped > ready', () => {
  assert.equal(aggregateHealth({}), 'stopped')
  assert.equal(aggregateHealth({ a: { state: 'ready' }, b: { state: 'ready' } }), 'ready')
  assert.equal(aggregateHealth({ a: { state: 'ready' }, b: { state: 'failed' } }), 'failed')
  assert.equal(aggregateHealth({ a: { state: 'ready' }, b: { state: 'failed', required: false } }), 'degraded')
  assert.equal(aggregateHealth({ a: { state: 'starting' }, b: { state: 'degraded' } }), 'starting')
  assert.equal(aggregateHealth({ a: { state: 'stopped' }, b: { state: 'stopped' } }), 'stopped')
  assert.equal(aggregateHealth({ a: { state: 'stopped' }, b: { state: 'ready' } }), 'ready')
  assert.equal(aggregateHealth({ a: { state: 'stopped', core: true }, b: { state: 'ready' } }), 'stopped')
})

test('formatHealth renders an aligned table', () => {
  const text = formatHealth({ g: { label: 'Gateway', state: 'ready', detail: 'http://x' }, s: { label: 'STT', state: 'stopped' } })
  assert.match(text, /^Voice Agent\n\nGateway\s+ready\s+http:\/\/x\nSTT\s+stopped$/)
})

test('probeHttp reports timeouts and probeSpeechToSpeech reads the pool', async () => {
  const slow = () => new Promise(() => {})
  const timedOut = await probeHttp('http://127.0.0.1:1/x', { timeoutMs: 20, fetchImpl: slow })
  assert.deepEqual(timedOut, { ok: false, status: 0, error: 'timeout' })
  const fetchImpl = async () => new Response(JSON.stringify({ size: 1, in_use: 0, units: [{ state: 'idle' }] }), {
    status: 200, headers: { 'content-type': 'application/json' },
  })
  const pool = await probeSpeechToSpeech('http://127.0.0.1:8765', { fetchImpl })
  assert.equal(pool.state, 'ready')
  assert.equal(pool.detail, 'pipelines 0/1 in use')
  const stuck = async () => new Response(JSON.stringify({ size: 1, in_use: 1, units: [{ state: 'stuck' }] }), {
    status: 200, headers: { 'content-type': 'application/json' },
  })
  assert.equal((await probeSpeechToSpeech('http://x', { fetchImpl: stuck })).state, 'degraded')
})

test('formatBytes', () => {
  assert.equal(formatBytes(0), '0 B')
  assert.equal(formatBytes(512 * 1024 ** 2), '512 MB')
  assert.equal(formatBytes(5.8 * 1024 ** 3), '5.8 GB')
})
