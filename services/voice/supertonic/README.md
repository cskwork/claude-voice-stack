# Supertonic (external dependency)

Supertonic is a local ONNX text-to-speech engine. Two ways to run it:

1. **In-process (default, `VOICE_TTS_MODE=supertonic`)**: speech-to-speech loads
   the `supertonic` Python package inside its own process. One model copy, no
   HTTP hop, cancellation handled by the pipeline. Installed by the
   `speech-to-speech[supertonic]` extra (pins `supertonic>=1.3.1`).
2. **HTTP server (`VOICE_TTS_MODE=openai-http`)**: `voice-agent start` runs
   `supertonic serve --host 127.0.0.1 --port 7788 --model supertonic-3` and
   speech-to-speech calls `POST /v1/audio/speech`. Use this to share one TTS
   server between several clients or to isolate TTS crashes.

Voice styles: `M1`–`M5`, `F1`–`F5` (`SUPERTONIC_VOICE`). Language: `na` for
auto, or `ko` / `en` (`SUPERTONIC_LANGUAGE`). Quick check outside the stack:

```bash
~/.claude-voice-stack/venv-s2s/bin/supertonic say '안녕하세요, 테스트입니다.' --lang ko
```

Upstream: https://github.com/w-websoft/supertonic-tts
