import { useEffect, useRef, useState } from 'react'

const INPUT_SAMPLE_RATE = 16000
const OUTPUT_SAMPLE_RATE = 24000
const SPEECH_THRESHOLD = 0.035
const THINKING_TIMEOUT_MS = 35000

function voiceWsUrl(clientId) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/api/voice/realtime?clientId=${encodeURIComponent(clientId)}`
}

function floatToPcm16Base64(samples) {
  const bytes = new Uint8Array(samples.length * 2)
  const view = new DataView(bytes.buffer)
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
  }

  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

function base64Pcm16ToFloat32(base64) {
  const binary = atob(base64)
  const samples = new Float32Array(binary.length / 2)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  const view = new DataView(bytes.buffer)
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = view.getInt16(i * 2, true) / 0x8000
  }
  return samples
}

function resampleLinear(input, fromRate, toRate) {
  if (fromRate === toRate) return input
  const ratio = fromRate / toRate
  const length = Math.max(1, Math.round(input.length / ratio))
  const output = new Float32Array(length)
  for (let i = 0; i < length; i += 1) {
    const index = i * ratio
    const before = Math.floor(index)
    const after = Math.min(input.length - 1, before + 1)
    const weight = index - before
    output[i] = input[before] * (1 - weight) + input[after] * weight
  }
  return output
}

function rmsLevel(samples) {
  let sum = 0
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i]
  return Math.sqrt(sum / samples.length)
}

export default function useVoiceSession({ muted, clientId, persona, routeStrategy, thinking = false, onAgentActions, onMapAction, onVoiceMessage }) {
  const [voiceState, setVoiceState] = useState('idle')
  const [inputLevel, setInputLevel] = useState(0)
  const [outputLevel, setOutputLevel] = useState(0)
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState(null)
  const cleanupRef = useRef(() => {})
  const onAgentActionsRef = useRef(onAgentActions)
  const onMapActionRef = useRef(onMapAction)
  const onVoiceMessageRef = useRef(onVoiceMessage)

  useEffect(() => {
    onAgentActionsRef.current = onAgentActions
  }, [onAgentActions])

  useEffect(() => {
    onMapActionRef.current = onMapAction
  }, [onMapAction])

  useEffect(() => {
    onVoiceMessageRef.current = onVoiceMessage
  }, [onVoiceMessage])

  useEffect(() => {
    cleanupRef.current()

    if (muted) {
      const resetFrame = requestAnimationFrame(() => {
        setVoiceState('idle')
        setInputLevel(0)
        setOutputLevel(0)
        setProgress(null)
        setError(null)
      })
      cleanupRef.current = () => {}
      return () => cancelAnimationFrame(resetFrame)
    }

    let cancelled = false
    let frame = 0
    let stream = null
    let audioContext = null
    let source = null
    let analyser = null
    let processor = null
    let lastVoiceAt = 0
    let remoteBusy = false
    let displayState = 'idle'
    let ws = null
    let playbackCursor = 0
    let playbackTimers = []
    let playbackSources = []
    let playbackActive = false
    let postPlaybackState = null
    let progressClearTimer = 0
    let thinkingTimer = 0

    const clearProgressTimer = () => {
      if (progressClearTimer) {
        clearTimeout(progressClearTimer)
        progressClearTimer = 0
      }
    }

    const clearThinkingTimer = () => {
      if (thinkingTimer) {
        clearTimeout(thinkingTimer)
        thinkingTimer = 0
      }
    }

    const clearProgressLater = (delay = 2200) => {
      clearProgressTimer()
      progressClearTimer = setTimeout(() => {
        setProgress(null)
        progressClearTimer = 0
      }, delay)
    }

    const setDisplayState = (next) => {
      if (displayState === next) return
      displayState = next
      clearThinkingTimer()
      if (next === 'thinking') {
        thinkingTimer = setTimeout(() => {
          thinkingTimer = 0
          if (displayState !== 'thinking') return
          remoteBusy = false
          postPlaybackState = null
          setOutputLevel(0)
          setError('语音处理超时，请再试一次')
          setDisplayState('idle')
          clearProgressLater(800)
        }, THINKING_TIMEOUT_MS)
      }
      setVoiceState(next)
    }

    const sendWs = (payload) => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload))
      }
    }

    const clearPlaybackTimers = () => {
      playbackTimers.forEach(timer => clearTimeout(timer))
      playbackTimers = []
    }

    const clearPlayback = () => {
      clearPlaybackTimers()
      playbackSources.forEach((sourceNode) => {
        try {
          sourceNode.stop()
        } catch {
          // The source may already have ended.
        }
        try {
          sourceNode.disconnect()
        } catch {
          // Already disconnected.
        }
      })
      playbackSources = []
      playbackCursor = audioContext?.currentTime || 0
      playbackActive = false
      postPlaybackState = null
      setOutputLevel(0)
    }

    const hasPendingPlayback = () => (
      playbackActive
      && audioContext
      && audioContext.currentTime < playbackCursor - 0.02
    )

    const finishPlaybackIfDone = () => {
      if (!playbackActive || hasPendingPlayback()) return
      playbackActive = false
      setOutputLevel(0)
      if (postPlaybackState) {
        const nextState = postPlaybackState
        postPlaybackState = null
        setDisplayState(nextState)
      } else if (!remoteBusy) {
        setDisplayState('idle')
      }
    }

    const playPcmAudio = (audioBase64, sampleRate = OUTPUT_SAMPLE_RATE) => {
      if (!audioContext) return
      const samples = base64Pcm16ToFloat32(audioBase64)
      const buffer = audioContext.createBuffer(1, samples.length, sampleRate)
      buffer.copyToChannel(samples, 0)
      const output = audioContext.createBufferSource()
      output.buffer = buffer
      output.connect(audioContext.destination)
      playbackSources.push(output)
      output.addEventListener('ended', () => {
        playbackSources = playbackSources.filter(item => item !== output)
        try {
          output.disconnect()
        } catch {
          // Already disconnected.
        }
      })

      const startAt = Math.max(audioContext.currentTime + 0.02, playbackCursor)
      playbackCursor = startAt + buffer.duration
      output.start(startAt)

      const level = Math.min(1, rmsLevel(samples) / 0.18)
      playbackActive = true
      setOutputLevel(level)
      setDisplayState('speaking')

      const timer = setTimeout(() => {
        finishPlaybackIfDone()
      }, Math.max(0, (playbackCursor - audioContext.currentTime) * 1000 + 50))
      playbackTimers.push(timer)
    }

    const cleanup = () => {
      cancelled = true
      cancelAnimationFrame(frame)
      playbackActive = false
      clearThinkingTimer()
      clearProgressTimer()
      clearPlayback()
      processor?.disconnect()
      source?.disconnect()
      stream?.getTracks().forEach(track => track.stop())
      audioContext?.close()
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'mute' }))
      }
      ws?.close()
    }

    cleanupRef.current = cleanup

    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('当前浏览器不支持麦克风采集')
        }

        ws = new WebSocket(voiceWsUrl(clientId))
        ws.addEventListener('open', () => {
          sendWs({ type: 'config', soul: persona, routeStrategy, thinking })
          sendWs({ type: 'unmute' })
        })
        ws.addEventListener('message', (event) => {
          let payload
          try {
            payload = JSON.parse(event.data)
          } catch {
            return
          }

          if (payload.type === 'voice_state') {
            remoteBusy = ['thinking', 'speaking'].includes(payload.state)
            if (payload.state === 'idle' && !hasPendingPlayback()) clearProgressLater(900)
            if (hasPendingPlayback() && payload.state !== 'speaking') {
              postPlaybackState = payload.state
              setDisplayState('speaking')
            } else {
              postPlaybackState = null
              setDisplayState(payload.state)
            }
          } else if (payload.type === 'transcript') {
            if (payload.content) {
              onVoiceMessageRef.current?.({ role: payload.role, content: payload.content, final: true })
            }
          } else if (payload.type === 'transcript_delta') {
            if (payload.content) {
              onVoiceMessageRef.current?.({ role: payload.role, content: payload.content, delta: true })
            }
          } else if (payload.type === 'audio') {
            remoteBusy = true
            playPcmAudio(payload.audio, payload.sampleRate || OUTPUT_SAMPLE_RATE)
          } else if (payload.type === 'audio_done') {
            remoteBusy = false
            clearProgressLater()
            if (hasPendingPlayback()) {
              setDisplayState('speaking')
            } else if (playbackActive) {
              finishPlaybackIfDone()
            } else {
              setOutputLevel(0)
              setDisplayState('idle')
            }
          } else if (payload.type === 'agent_actions') {
            onAgentActionsRef.current?.(payload.actions || [])
          } else if (payload.type === 'playback.clear') {
            remoteBusy = false
            clearPlayback()
            setDisplayState(payload.reason === 'user_interruption' ? 'listening' : 'idle')
          } else if (payload.type === 'agent_map_action') {
            if (payload.mapAction) onMapActionRef.current?.(payload.mapAction)
          } else if (payload.type === 'agent_thinking') {
            onVoiceMessageRef.current?.({ role: 'assistant', thinkingDelta: payload.content })
          } else if (payload.type === 'agent_tool_call') {
            onVoiceMessageRef.current?.({ role: 'assistant', toolCall: payload.toolCall })
          } else if (payload.type === 'agent_progress') {
            if (payload.progress) {
              setProgress(payload.progress)
              if (payload.progress.stage === 'navigation_started' || payload.progress.stage === 'route_ready') {
                clearProgressLater(1800)
              }
            }
            onVoiceMessageRef.current?.({ role: 'assistant', progress: payload.progress })
          } else if (payload.type === 'agent_debug') {
            clearProgressLater(800)
            onVoiceMessageRef.current?.({ role: 'assistant', debug: payload.debug })
          } else if (payload.type === 'error') {
            remoteBusy = false
            setDisplayState('error')
            setError(payload.message || '语音服务错误')
          }
        })
        ws.addEventListener('error', () => {
          remoteBusy = false
          setDisplayState('error')
          setError('语音服务连接失败')
        })

        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        })
        if (cancelled) {
          stream.getTracks().forEach(track => track.stop())
          return
        }

        const AudioContextClass = window.AudioContext || window.webkitAudioContext
        audioContext = new AudioContextClass()
        analyser = audioContext.createAnalyser()
        analyser.fftSize = 512
        source = audioContext.createMediaStreamSource(stream)
        source.connect(analyser)
        processor = audioContext.createScriptProcessor(2048, 1, 1)
        processor.onaudioprocess = (event) => {
          if (cancelled || !ws || ws.readyState !== WebSocket.OPEN) return
          const input = event.inputBuffer.getChannelData(0)
          const pcm = floatToPcm16Base64(resampleLinear(input, audioContext.sampleRate, INPUT_SAMPLE_RATE))
          sendWs({ type: 'audio', audio: pcm })
        }
        source.connect(processor)
        processor.connect(audioContext.destination)

        const data = new Float32Array(analyser.fftSize)
        setError(null)
        setDisplayState('idle')

        const tick = () => {
          analyser.getFloatTimeDomainData(data)
          let sum = 0
          for (let i = 0; i < data.length; i += 1) {
            sum += data[i] * data[i]
          }

          const rms = Math.sqrt(sum / data.length)
          const level = Math.min(1, rms / 0.18)
          const now = performance.now()
          setInputLevel(level)

          if (rms > SPEECH_THRESHOLD && !remoteBusy) {
            lastVoiceAt = now
            if (displayState === 'idle') setDisplayState('listening')
          } else if (now - lastVoiceAt > 900) {
            if (!remoteBusy && !playbackActive) setDisplayState('idle')
          }

          frame = requestAnimationFrame(tick)
        }

        frame = requestAnimationFrame(tick)
      } catch (err) {
        if (!cancelled) {
          setInputLevel(0)
          setVoiceState('error')
          setProgress(null)
          setError(err.message || '麦克风不可用')
        }
      }
    }

    start()

    return cleanup
  }, [clientId, muted, persona, routeStrategy, thinking])

  return { voiceState, inputLevel, outputLevel, progress, error }
}
