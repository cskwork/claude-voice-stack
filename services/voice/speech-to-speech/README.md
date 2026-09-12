# speech-to-speech (external dependency)

Hugging Face `speech-to-speech` is not vendored. It is installed, pinned, into
`~/.claude-voice-stack/venv-s2s` by `voice-agent setup` (`scripts/voice-stack/bootstrap-macos.sh`):

```bash
pip install "speech-to-speech[supertonic]==1.0.0"
```

`voice-agent start` launches it with the arguments produced by
`scripts/voice-stack/lib/s2s-command.mjs`. For the default profile that is:

```bash
speech-to-speech serve \
  --host 127.0.0.1 --port 8765 \
  --stt mlx-audio-whisper --language auto \
  --llm_backend chat-completions --model_name glm-5.3-flash \
  --responses_api_base_url "$VOICE_LLM_BASE_URL" --responses_api_stream \
  --tts supertonic --supertonic_tts_voice M1 --supertonic_tts_lang na --supertonic_tts_speed 1.0 \
  --num_pipelines 1 --chat_size 4 --enable_live_transcription
```

The API key is passed as `OPENAI_API_KEY` in the child environment, never on
the command line. `--log_transcripts` is only added by `voice-agent start --debug-transcripts`.

Logs: `~/.claude-voice-stack/logs/speech-to-speech.log`. Health: `GET http://127.0.0.1:8765/v1/pool`.
Upstream docs: https://github.com/huggingface/speech-to-speech
