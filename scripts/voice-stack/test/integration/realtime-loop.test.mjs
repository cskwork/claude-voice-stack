// Phase 1 proof: the external voice stack works standalone, without the Gateway.
// Runs the real speech-to-speech server (Parakeet TDT + Supertonic in-process)
// against a mock Chat Completions provider, drives it over the OpenAI Realtime
// WebSocket, and asserts STT (English + Korean), tool-call forwarding, TTS audio
// and response cancellation. Opt in with VOICE_STACK_INTEGRATION=1: it loads
// models and takes a few minutes on first run.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import { resolveVoiceConfig } from '../../lib/env.mjs'
import { foregroundPrompt, routerTools } from '../../lib/glm-smoke.mjs'
import { formatBytes, probeSpeechToSpeech, processMemoryBytes } from '../../lib/health.mjs'
import { stackPaths } from '../../lib/paths.mjs'
import { isRunning, startDetached, stopProcess, waitFor } from '../../lib/process-manager.mjs'
import { buildSpeechToSpeechCommand } from '../../lib/s2s-command.mjs'
import { MOCK_KEY, startMockProvider } from '../helpers/mock-provider.mjs'

const execFileAsync = promisify(execFile)
const paths = stackPaths()
const enabled = process.env.VOICE_STACK_INTEGRATION === '1' && existsSync(paths.speechToSpeechBin)
const PORT = Number(process.env.VOICE_STACK_TEST_PORT || 18765)

async function synthesizePcm16k(text, lang, dir, name) {
  const wav = join(dir, `${name}.wav`)
  const raw = join(dir, `${name}.pcm`)
  await execFileAsync(paths.supertonicBin, ['tts', text, '-o', wav, '--lang', lang], { timeout: 120_000 })
  await execFileAsync(paths.python, ['-c', [
    'import sys, numpy as np, soundfile as sf, soxr',
    'data, sr = sf.read(sys.argv[1], dtype="float32")',
    'data = data.mean(axis=1) if data.ndim > 1 else data',
    'data = soxr.resample(data, sr, 16000)',
    '(np.clip(data, -1, 1) * 32767).astype("int16").tofile(sys.argv[2])',
  ].join('\n'), wav, raw], { timeout: 60_000 })
  return readFileSync(raw)
}

function openRealtime(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    const events = []
    const waiters = []
    ws.addEventListener('message', message => {
      const event = JSON.parse(message.data)
      events.push(event)
      if (event.type === 'error') process.stderr.write(`# realtime error: ${JSON.stringify(event.error || event)}\n`)
      const index = events.length - 1
      for (const waiter of [...waiters]) {
        if (waiter.match(event, index)) { waiters.splice(waiters.indexOf(waiter), 1); waiter.resolve(event) }
      }
    })
    ws.addEventListener('error', reject)
    ws.addEventListener('open', () => resolve({
      ws,
      events,
      send: payload => ws.send(JSON.stringify(payload)),
      next: (match, timeoutMs = 60_000) => new Promise((res, rej) => {
        const found = events.find(match)
        if (found) return res(found)
        const timer = setTimeout(() => rej(new Error(`timed out waiting for event; last events: ${events.slice(-12).map(e => e.type + (e.transcript ? `(${e.transcript})` : e.name ? `(${e.name})` : '')).join(', ')}`)), timeoutMs)
        waiters.push({ match, resolve: event => { clearTimeout(timer); res(event) } })
      }),
    }))
  })
}

async function sendSpeech(client, pcm) {
  const chunk = 3200 // 100 ms of 16 kHz PCM16
  const silence = Buffer.alloc(chunk)
  for (let offset = 0; offset < pcm.length; offset += chunk) {
    client.send({ type: 'input_audio_buffer.append', audio: pcm.subarray(offset, offset + chunk).toString('base64') })
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  for (let i = 0; i < 15; i += 1) {
    client.send({ type: 'input_audio_buffer.append', audio: silence.toString('base64') })
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

test('standalone voice loop: STT → mock router → tool call / TTS → cancel', { skip: !enabled && 'set VOICE_STACK_INTEGRATION=1 (needs the voice venv)' }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'voice-stack-it-'))
  const provider = await startMockProvider()
  t.after(provider.close)
  // A leftover server on the test port would silently serve the previous
  // configuration; refuse instead of measuring the wrong thing.
  const stale = await probeSpeechToSpeech(`http://127.0.0.1:${PORT}`)
  assert.equal(stale.state, 'stopped', `port ${PORT} already serves speech-to-speech; stop it first`)

  const { config, errors } = resolveVoiceConfig({
    VOICE_LLM_BASE_URL: provider.baseUrl,
    VOICE_LLM_API_KEY: MOCK_KEY,
    VOICE_S2S_PORT: String(PORT),
    VOICE_STT: process.env.VOICE_STACK_TEST_STT || 'whisper-mlx',
    VOICE_STT_MODEL: process.env.VOICE_STACK_TEST_STT_MODEL || '',
    VOICE_STT_LANGUAGE: process.env.VOICE_STACK_TEST_STT_LANGUAGE || '',
  })
  assert.deepEqual(errors, [])
  t.diagnostic(`STT backend: ${config.stt.backend} ${config.stt.model} language=${config.stt.language || 'auto'}`)
  // Test-only: transcripts in the scratch log make failures diagnosable.
  const spec = buildSpeechToSpeechCommand(config, { bin: paths.speechToSpeechBin, debugTranscripts: true })
  const pidPath = join(dir, 's2s.pid')
  // Persistent log so a failed run can be inspected after cleanup.
  const logPath = join(paths.logs, 'integration-speech-to-speech.log')
  t.diagnostic(`speech-to-speech log: ${logPath}`)
  const started = startDetached({ ...spec, cwd: paths.home, logPath, pidPath, captureStdout: true })
  // One hook: stop the server first, then remove the scratch directory. Two
  // hooks would let the pid file disappear before the stop runs.
  t.after(async () => {
    await stopProcess(pidPath)
    rmSync(dir, { recursive: true, force: true })
  })
  const ready = await waitFor(async () => {
    if (!isRunning(started.pid)) throw new Error(`speech-to-speech exited:\n${readFileSync(logPath, 'utf8').slice(-2000)}`)
    return { ok: (await probeSpeechToSpeech(config.s2s.httpBaseUrl)).state === 'ready' }
  }, { timeoutMs: 600_000, intervalMs: 2000 })
  assert.ok(ready.ok, `speech-to-speech not ready:\n${readFileSync(logPath, 'utf8').slice(-2000)}`)
  t.diagnostic(`speech-to-speech ready in ${Math.round(ready.elapsedMs / 1000)} s`)

  const english = await synthesizePcm16k("Ask Claude to inspect the authentication service, but don't edit anything.", 'en', dir, 'en')
  const korean = await synthesizePcm16k('로그인 서비스를 조사해 줘. 하지만 아무것도 수정하지 마.', 'ko', dir, 'ko')

  const client = await openRealtime(`ws://127.0.0.1:${PORT}/v1/realtime`)
  t.after(() => client.ws.close())
  client.send({
    type: 'session.update',
    session: {
      type: 'realtime',
      instructions: foregroundPrompt(),
      tools: routerTools().map(tool => ({
        type: 'function', name: tool.function.name, description: tool.function.description, parameters: tool.function.parameters,
      })),
      output_modalities: ['audio'],
      audio: {
        input: { turn_detection: { type: 'server_vad', interrupt_response: true } },
        output: { format: { type: 'audio/pcm', rate: 24000 } },
      },
    },
  })

  // Turn 1 (English): transcript keeps the restriction; the router delegates
  // with a spawn_thinking call whose objective still says "do not edit".
  await sendSpeech(client, english)
  const enTranscript = await client.next(e => e.type === 'conversation.item.input_audio_transcription.completed', 90_000)
  t.diagnostic(`EN transcript: ${enTranscript.transcript}`)
  assert.match(enTranscript.transcript, /edit/i)
  assert.match(enTranscript.transcript, /inspect|authentication/i)
  const call = await client.next(e => e.type === 'response.function_call_arguments.done', 60_000)
  assert.equal(call.name, 'spawn_thinking')
  const args = JSON.parse(call.arguments)
  assert.match(args.objective, /do not edit/i)
  await client.next(e => e.type === 'response.done', 60_000)
  // The Gateway answers every tool call with a function_call_output item (the
  // task receipt). Do the same so the conversation stays valid for the next turn.
  client.send({
    type: 'conversation.item.create',
    item: { type: 'function_call_output', call_id: call.call_id, output: JSON.stringify({ status: 'accepted', task_id: 'task_1' }) },
  })
  await new Promise(resolve => setTimeout(resolve, 500))

  // Turn 2 (Korean): transcript recognisable; a text reply is synthesised by
  // Supertonic and streamed as 24 kHz PCM audio deltas.
  const seenBefore = client.events.length
  await sendSpeech(client, korean)
  const koTranscript = await client.next((e, i) => i >= seenBefore && e.type === 'conversation.item.input_audio_transcription.completed', 90_000)
  t.diagnostic(`KO transcript: ${koTranscript.transcript}`)
  assert.match(koTranscript.transcript, /로그인|서비스|수정/)
  const firstAudio = await client.next((e, i) => i >= seenBefore && e.type === 'response.output_audio.delta', 90_000)
  assert.ok(firstAudio.delta.length > 0)
  // Barge-in path: cancel the response mid-stream; the server must finish the
  // response promptly and stop publishing audio.
  client.send({ type: 'response.cancel' })
  const done = await client.next((e, i) => i > client.events.indexOf(firstAudio) && e.type === 'response.done', 30_000)
  const doneIndex = client.events.indexOf(done)
  await new Promise(resolve => setTimeout(resolve, 1500))
  const lateAudio = client.events.slice(doneIndex + 1).filter(e => e.type === 'response.output_audio.delta').length
  t.diagnostic(`audio deltas after cancel: ${lateAudio}`)
  t.diagnostic(`speech-to-speech RSS after the loop: ${formatBytes(await processMemoryBytes([started.pid]))}`)
  assert.ok(lateAudio <= 2, `audio kept flowing after cancel (${lateAudio} deltas)`)
})
