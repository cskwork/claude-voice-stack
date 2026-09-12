# Upstream map (Phase 0)

Baseline: `QwenAudio/qwen-audio-agent` commit `a6a56b5d92ea58b03381c81bcd14f9c4c417e4ad`
(2026-09-12, "feat(smart-cockpit): sync navigation route animations (#423)"), package
version 1.11.0. Baseline tests before any change: root `node --test test/*.test.mjs`
184 pass / 1 skip; `npm run test --workspace server` 1231 pass.

This fork adds files only. No upstream source file under `server/`, `shared/`, `cli/`,
`tui/`, `web/`, or `desktop/` is modified. `package.json` and `README.md` gain entries.

## Where the pieces live

| Concern | Upstream location | Notes for this fork |
|---|---|---|
| Realtime provider registry | `server/src/voice/providers/registry.mjs` | `speech-to-speech` (alias `s2s`) is a built-in provider. Selected by `QWEN_AUDIO_REALTIME_PROVIDER=speech-to-speech`. |
| speech-to-speech provider | `server/src/voice/providers/s2s.mjs` | Speaks the GA Realtime dialect via `ga-protocol.mjs`. 16 kHz in / 24 kHz out, `server_vad` with `interrupt_response`, single response slot, 60 s first-response timeout. Sends `instructions` + flat `tools` on `session.update`. |
| Wire adapter | `server/src/voice/providers/ga-protocol.mjs` | Maps `response.output_text.*` to `response.text.*`; namespaces item ids (`msg_`, `fc_`, `fco_`); correlates responses with `qwen_audio_request_id` metadata. |
| Realtime session state / barge-in | `server/src/voice/realtime-provider.mjs`, `realtime-gateway.mjs` | `injectResult()` (line ~473) turns backend results into a user `input_text` item plus a `response.create` carrying `resultResponseInstructions`. Response cancellation (`response.cancel`) is separate from task cancellation (`cancel_agent_task`). |
| Endpoint config | `server/src/core/config.mjs` (`speechToSpeechRealtimeUrl`, `speechToSpeechAuthToken`) | Env: `SPEECH_TO_SPEECH_REALTIME_URL`, optional `SPEECH_TO_SPEECH_AUTH_TOKEN`. |
| Frontend prompt | `config/frontend-agent/PROMPT.md` + `ASSISTANT.md`, loaded by `server/src/conversation/frontend-agent-context.mjs` | Directory is overridable with `QWEN_AUDIO_AGENT_FRONTEND_PROMPT_DIR` (relative to repo root). Assistant persona: `QWEN_AUDIO_AGENT_ASSISTANT_PROFILE_PATH`. The upstream `~/.config/qwaudio/ASSISTANT.md` copy otherwise wins. |
| Frontend instructions builder | `server/src/frontend/frontend-tools.mjs` (`buildFrontendInstructions`, `resultResponseInstructions`, `progressResponseInstructions`, `permissionResponseInstructions`) | These per-response instructions are Chinese upstream strings appended by the Gateway at runtime; the profile prompt sets the English rules GLM follows. |
| Delegation tool schema | `server/src/frontend/tools/spawn-thinking-tool.mjs` | `spawn_thinking({ objective: string, input_refs?: string[] })`. There is no structured `constraints` field; the objective string is the contract. |
| Control tools | `server/src/frontend/tools/features/agent-task-tools.mjs` | `cancel_agent_task`, `get_agent_task_status`, `respond_permission`, `respond_agent_input`. |
| Optional frontend tools | `server/src/frontend/optional-features.mjs`, env `QWEN_AUDIO_*_TOOL_ENABLED` | Disabled in the profile to keep the GLM tool list short. |
| Backend selection | `AGENT_PROTOCOL=claude`, `server/src/backend/adapters/acp/drivers/claude.mjs` | Claude driver capabilities: delegation, permissions, external MCP, native session history. |
| Claude ACP launcher | `scripts/runtime/claude-code-acp.mjs` | Runs `claude-code-acp` binary if present, else `npx -y @zed-industries/claude-code-acp@0.16.2`. Requires the `claude` executable (or `CLAUDE_CODE_EXECUTABLE`). Copies `CLAUDE_API_KEY` to `ANTHROPIC_API_KEY`. |
| Permission modes | `docs/configuration/backend.md`, env `QWEN_AUDIO_AGENT_BACKEND_PERMISSION_MODE` | `native` (default) forwards Claude's own permission prompts; `full` auto-approves. The profile validator rejects `full`. |
| Config file loading | `shared/runtime-environment.mjs` (`loadRuntimeEnvironment`) | Order: process env, `.env.local`, `.env`, `~/.config/qwaudio/config.env`. Existing process variables win, which is how `voice-agent start` injects the profile. |
| Gateway launcher | `scripts/start.mjs` → `cli/src/runtime.mjs` (`ensureRuntime`) | Spawns `server/src/index.mjs`, exposes `GET /api/health` on `HOST:PORT` (default 127.0.0.1:3101). |
| Upstream doctor | `cli/src/diagnostics.mjs` (`qwenaudio doctor`) | Checks config, realtime configuration, MCP config, journals, Gateway health. `voice-agent doctor` adds the Python stack, GLM gate, audio devices, Claude login. |
| Web UI / TUI | `web/`, `tui/` | TUI works without the web build; `npm run build` produces `web/dist`. |

## Hugging Face speech-to-speech 1.0.0 (external, pinned)

Verified with `speech-to-speech serve --stt parakeet-tdt --llm_backend chat-completions --tts supertonic -h`:

- STT backends: `parakeet-tdt` (MLX on Apple Silicon, `mlx-community/parakeet-tdt-0.6b-v3`), `whisper-mlx`, `mlx-audio-whisper`, others.
- LLM backends: `chat-completions`, `responses-api`, `mlx-lm`, `transformers`. Chat Completions reuses `--responses_api_base_url`, `--responses_api_stream`, `--responses_api_reasoning_effort`. API key falls back to `OPENAI_API_KEY` in the environment.
- TTS backends include `supertonic` (in-process, extra `speech-to-speech[supertonic]`, needs `supertonic>=1.3.1`) and `openai` (`/v1/audio/speech` HTTP).
- Realtime server: `--host` (default 127.0.0.1), `--port 8765`, `--num_pipelines`, `--enable_live_transcription`, `--log_transcripts` (off by default). Health: `GET /v1/pool`, `GET /v1/usage`.
- `session.update` instructions and function tools are forwarded to the LLM; tool calls come back as Realtime function-call events; `response.cancel` and `server_vad` `interrupt_response` handle barge-in.

## Supertonic 1.3.1 (external)

Installed via pipx (`~/.local/bin/supertonic`) and inside the voice venv. `supertonic serve --host 127.0.0.1 --port 7788 --model supertonic-3` exposes `/v1/tts` and `/v1/audio/speech`. The default profile does not need the HTTP server because speech-to-speech loads Supertonic in-process (one model copy, no HTTP hop); `VOICE_TTS_MODE=openai-http` switches to the server.

## Decisions taken from the map

0. STT default is `mlx-audio-whisper` (whisper-large-v3-turbo through mlx-audio, built into speech-to-speech on macOS). Parakeet TDT v3 was measured to have no Korean support (see `ram-benchmark.md`), so it stays an English-only option.
1. No Gateway code change is needed for the MVP (PRD open question 7). Everything is configuration, prompt, and process management.
2. Delegation constraints ride inside `spawn_thinking.objective` in a fixed textual shape ("Goal … Mode … Constraints …") because the upstream tool schema has no structured field and changing it would fork `server/`. The GLM gate asserts the restriction survives.
3. Result normalisation stays upstream: the Gateway already injects a result item plus speech-only instructions; the profile prompt limits what GLM says.
