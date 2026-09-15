# Architecture: local ears and voice, remote GLM router, selectable coding backend

```text
Microphone ─► Silero VAD ─► Whisper small (MLX) ──► GLM-5.3-Flash (HTTPS) ─┐
                    speech-to-speech process (one pipeline)              │
Speaker ◄─ Supertonic (in-process ONNX) ◄─ GLM spoken rendering ◄────────┘
                    ▲                                   │ OpenAI Realtime WS (127.0.0.1:8765)
                    │                                   ▼
                    └──────────── qwen-audio-agent Gateway (127.0.0.1:3101)
                                   │  TUI / WebUI / Desktop
                                   └─ ACP stdio ─► selected adapter ─► Claude Code / Codex / Pi
```

## Responsibilities

| Layer | Owns | Never does |
|---|---|---|
| speech-to-speech | VAD, STT, calling GLM, TTS, barge-in inside the pipeline | Talk to the backend, touch files |
| GLM-5.3-Flash | Turn-taking, routing (VOICE_ONLY / DELEGATE / CONTROL), the `spawn_thinking` objective, spoken summaries | Shell, repository access, tool results it did not receive |
| Gateway | Realtime session, task lifecycle, permission relay, result injection, UI state | Audio conversion, LLM calls |
| Selected backend | Repository, shell, edits, tests, and supported agent tools | Speak |

## How the pieces connect (no upstream code changes)

- `QWEN_AUDIO_REALTIME_PROVIDER=speech-to-speech` selects the upstream provider in
  `server/src/voice/providers/s2s.mjs`. It sends the frontend instructions and the
  Gateway tools on every `session.update`; speech-to-speech forwards them to GLM as
  the system prompt and Chat Completions `tools`.
- `QWEN_AUDIO_AGENT_FRONTEND_PROMPT_DIR=config/prompts/foreground-glm` swaps the
  upstream Chinese prompt for the compact English router prompt (target under 500
  tokens; `test/prompt.test.mjs` caps it at 2,400 characters).
- `AGENT_PROTOCOL=claude|codex|pi` selects the existing upstream ACP driver.
  Claude Code is the default. `QWEN_AUDIO_AGENT_BACKEND_PERMISSION_MODE=native`
  preserves Claude/Codex approvals; the validator still refuses explicit `full`.
  Pi's effective permission mode is always full, with no approval prompts or
  Gateway MCP tools. Pi selection enables this behavior directly.
- `voice-agent start` injects the profile into the Gateway process environment,
  which upstream `loadRuntimeEnvironment` treats as highest precedence.

## Routing and delegation contract

GLM classifies each turn. For DELEGATE it calls the upstream `spawn_thinking`
tool whose only payload is `objective`. The prompt fixes the shape:

```text
Goal: <what to do>. Mode: inspect | edit. Constraints: <list or none>.
```

`scripts/voice-stack/lib/objective.mjs` parses that shape (and tolerant natural
language, English and Korean) into `do_not_edit`, `do_not_commit`,
`no_production_data`, `ask_before_destructive`. The GLM gate (`voice-agent
smoke-glm`, PRD section 25) fails when the restriction is lost. A structured
JSON payload (PRD section 26) would require changing the upstream tool schema
in `server/`; the textual contract meets the requirement without a fork of
Gateway code and is the documented trade-off.

## Result contract

The selected agent's completion reaches GLM through the upstream Gateway path
(`realtime-provider.mjs` `injectResult`): a short user-role `input_text` item plus
a response whose instructions say "state the actual result, do not read protocol
fields, do not claim completion for unfinished work". The Gateway already
condenses ACP output before injection; the profile prompt further limits speech
to one to three sentences. Full transcripts, diffs, and logs stay inside the selected agent and the Gateway journals.

## Context budget

- System prompt: about 2.2 KB.
- Tools: three schemas (`spawn_thinking`, `cancel_agent_task`,
  `get_agent_task_status`) plus permission/input tools when a request is pending.
  Optional upstream tools (schedule, web, knowledge, notes, recall) are disabled.
- History: `VOICE_LLM_CHAT_SIZE=4` recent turns verbatim; speech-to-speech
  compacts older turns in the background.

## Barge-in versus task cancellation

Speech during playback triggers `server_vad` with `interrupt_response`: the
pipeline cancels the active response and stops publishing audio. That is a
Realtime `response.cancel`, not `cancel_agent_task`. The backend task keeps
running unless the user asks to cancel it, which GLM routes as CONTROL.

## Failure behaviour

| Failure | Behaviour |
|---|---|
| GLM unreachable at start | `voice-agent start` refuses to start with "The voice reasoning service is unavailable" |
| GLM fails mid-session | speech-to-speech reports an error event; the Gateway shows the frontend as degraded; no delegation is fabricated |
| Supertonic (in-process) fails | speech-to-speech logs the TTS error; text output continues in the UI |
| Selected backend unavailable | Gateway health `backend.ok=false`; `voice-agent status` shows Backend degraded; voice-only chat continues |
| Backend task fails | Gateway injects the failure; prompt forbids turning "failed" into "completed" |

## Logging and privacy

speech-to-speech prints user and assistant transcripts to **stdout** through its
rich console regardless of `--log_transcripts`; that flag only unlocks
transcript text inside its `logging` output (stderr). `voice-agent start`
therefore records only stderr in `~/.claude-voice-stack/logs/speech-to-speech.log`
and discards stdout. `--debug-transcripts` passes `--log_transcripts` and
captures stdout for that run. Error messages from the LLM provider are also
hidden by speech-to-speech unless transcripts are enabled (`log_exception`), so
a failing turn shows as `Response failed: chars=N` in normal logs.

## RAM strategy

One speech-to-speech process holds the STT model (Whisper small by default,
0.24 B parameters; Parakeet TDT 0.6 B for English-only sessions),
Silero VAD, Smart Turn and Supertonic; nothing else loads a model. GLM runs remotely. Measure with
`voice-agent status` (managed-process RSS) and the procedure in
`ram-benchmark.md` before optimising anything.
