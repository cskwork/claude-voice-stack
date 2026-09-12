/**
 * Build the `speech-to-speech serve` invocation for a resolved voice config.
 * Flags were validated against speech-to-speech 1.0.0 (`serve -h`). The API
 * key travels through the child environment (OPENAI_API_KEY fallback in the
 * openai client), never through argv, so it does not show up in `ps`.
 */
export function buildSpeechToSpeechCommand(config, {
  bin = 'speech-to-speech',
  debugTranscripts = false,
} = {}) {
  const { llm, stt, tts, s2s } = config
  const args = [
    'serve',
    '--host', s2s.host,
    '--port', String(s2s.port),
    '--stt', stt.backend,
    '--llm_backend', llm.backend,
    '--model_name', llm.model,
    '--num_pipelines', String(s2s.pipelines),
    '--chat_size', String(llm.chatSize),
  ]
  if (stt.backend === 'parakeet-tdt' && stt.language) {
    args.push('--parakeet_tdt_language', stt.language)
  }
  const env = {}
  if (llm.remote) {
    args.push('--responses_api_base_url', llm.baseUrl)
    args.push(llm.stream ? '--responses_api_stream' : '--no_responses_api_stream')
    if (llm.reasoningEffort) args.push('--responses_api_reasoning_effort', llm.reasoningEffort)
    env.OPENAI_API_KEY = llm.apiKey
  }
  if (tts.mode === 'supertonic') {
    args.push(
      '--tts', 'supertonic',
      '--supertonic_tts_voice', tts.voice,
      '--supertonic_tts_lang', tts.language,
      '--supertonic_tts_speed', tts.speed,
    )
  } else {
    args.push(
      '--tts', 'openai',
      '--openai_tts_base_url', tts.baseUrl,
      '--openai_tts_model', tts.model,
      '--openai_tts_voice', tts.voice,
    )
    if (tts.language && tts.language !== 'na') args.push('--openai_tts_language', tts.language)
  }
  args.push(s2s.liveTranscription ? '--enable_live_transcription' : '--no_enable_live_transcription')
  if (debugTranscripts || s2s.logTranscripts) args.push('--log_transcripts')
  return { command: bin, args, env }
}

export function buildSupertonicServeCommand(config, { bin = 'supertonic' } = {}) {
  const url = new URL(config.tts.baseUrl)
  return {
    command: bin,
    args: ['serve', '--host', url.hostname, '--port', url.port || '7788', '--model', config.tts.model],
    env: {},
  }
}
