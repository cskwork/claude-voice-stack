# Troubleshooting

Run `npm run voice-agent -- doctor` first. Logs live in `~/.claude-voice-stack/logs/`.

| Symptom | Cause / fix |
|---|---|
| `config missing: ~/.claude-voice-stack/config.env` | Run `voice-agent setup`, or copy `config/profiles/glm-supertonic-claude.env.example` there. |
| `VOICE_LLM_BASE_URL is empty` | Fill in the GLM endpoint and key in `config.env`. Do not put them in the repository. |
| `GLM unreachable: HTTP 401` | Wrong key or wrong base URL for that key (Z.ai general vs coding-plan URLs differ). |
| `glm.tool_call` fails in `doctor` | The endpoint does not stream tool calls the OpenAI way. Try another host for the same model, or set `VOICE_LLM_STREAM=false` and re-run `smoke-glm`. |
| `glm.constraint` fails | The model dropped "do not edit" from the objective. Check `VOICE_LLM_REASONING_EFFORT` (try `none` or `low`), or use a stronger router model. |
| `speech-to-speech did not become ready` | Read `logs/speech-to-speech.log`. First start downloads Parakeet (about 600 MB); `voice-agent setup` pre-downloads it. `ModuleNotFoundError: supertonic` means the extra was not installed. |
| `speech-to-speech exited` right away | Port 8765 in use (`lsof -i :8765`), or a stale pid; `voice-agent stop` then `start`. |
| Gateway starts but the voice is "not connected" | `SPEECH_TO_SPEECH_REALTIME_URL` must match `VOICE_S2S_HOST:VOICE_S2S_PORT`. |
| Assistant answers but never delegates | Confirm `AGENT_PROTOCOL=claude` and that the Gateway health shows `backend.ok`. Check `claude auth status`. |
| Claude never asks for permission / edits immediately | `QWEN_AUDIO_AGENT_BACKEND_PERMISSION_MODE` must be `native`; also check Claude Code's own settings for the workspace. |
| Speech cut off while talking | Increase `--live_transcription_min_silence_ms` in `lib/s2s-command.mjs` (default 500 ms) or use headphones. |
| Assistant hears itself | Use headphones or enable macOS voice isolation on the input device. |
| Korean transcripts poor or gibberish | Make sure `VOICE_STT=mlx-audio-whisper` (Parakeet has no Korean). Pin `VOICE_STT_LANGUAGE=ko` for Korean-only sessions. |
| Interrupting speech cancelled my Claude task | It should not: barge-in only cancels the Realtime response. If a task was cancelled, GLM routed "stop" as CONTROL; say "stop talking" instead of "stop that". |
| `Response failed: chars=NN` in the log, no detail | speech-to-speech hides provider error text unless transcripts are enabled. Re-run once with `voice-agent start --debug-transcripts` to read the message (often a 401/404 from the GLM endpoint). |
| Integration test says `port 18765 already serves speech-to-speech` | A previous test run left its server behind. Find it with `lsof -nP -iTCP:18765 -sTCP:LISTEN`, stop it, or run with `VOICE_STACK_TEST_PORT=18766`. |
| `voice-agent stop` leaves a process | Pids are in `~/.claude-voice-stack/run/`; the stop sends SIGTERM to the process group, then SIGKILL after 10 s. |

Transcripts are not logged. For a single debugging run: `voice-agent start --debug-transcripts`.
