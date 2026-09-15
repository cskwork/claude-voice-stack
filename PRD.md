# PRD — Local-First Voice Frontend for Claude Code

**Repository:** `claude-voice-stack` (working title in the original brief: `voice-claude-agent`)
**Base project:** [QwenAudio/qwen-audio-agent](https://github.com/QwenAudio/qwen-audio-agent)
**Status:** Draft v0.1
**Primary platform:** macOS Apple Silicon
**Primary goal:** Replace the default Qwen/DashScope realtime voice frontend with a RAM-efficient modular voice stack while keeping Claude Code as the backend coding agent.


## Compatibility update, 2026-09-15

The voice profile now supports `AGENT_PROTOCOL=claude`, `codex`, and `pi` using
the existing upstream drivers. Claude remains the default; the Claude-only
requirements below describe the original v0.1 scope and are superseded by this
section for backend selection. One Gateway runs one selected backend at a time.
Stop and restart when changing agents. Native approvals remain for Claude and
Codex. Pi selection directly enables execution without approval prompts, and
Pi cannot use Gateway MCP tools or separate delegated sessions.
See [current setup](docs/voice-stack/macos-setup.md#choose-a-backend).

---

## 1. Summary

Fork `qwen-audio-agent` and preserve its Gateway, ACP task lifecycle, Claude Code integration, TUI/Web/Desktop surfaces, task status, interruption handling, and permission model.

Replace the default cloud realtime voice model with:

```text
Microphone
   ↓
Silero VAD
   ↓
Parakeet TDT via MLX              local STT
   ↓
GLM-5.3-Flash API                 remote foreground voice/router LLM
   ↓
qwen-audio-agent Gateway
   ↓
Claude Code via claude-code-acp   backend coding agent
   ↓
GLM-5.3-Flash API                 short conversational rendering
   ↓
Supertonic                        local TTS
   ↓
Speaker
```

Hugging Face `speech-to-speech` provides the modular realtime voice pipeline:

```text
VAD → STT → LLM → TTS
```

and exposes it through an OpenAI-Realtime-compatible WebSocket interface. The fork should use that existing protocol boundary instead of reimplementing speech orchestration inside the Node gateway.

The intended result is a voice-first Claude Code runtime with:

- local speech recognition;
- local speech synthesis;
- remote GLM-5.3-Flash used only as the lightweight foreground conversational/router model;
- Claude Code retained as the sole backend execution/coding agent;
- low local RAM consumption;
- full-duplex conversation and barge-in;
- no local 1.7B/4B LLM loaded by default;
- no DashScope dependency in the default profile.

---

# 2. Problem

The default `qwen-audio-agent` experience uses a realtime voice model as the foreground conversational layer and delegates substantive work to an ACP backend.

For this product, Claude Code is already the desired backend agent. Running another large local LLM only to route speech and summarize Claude results wastes unified memory on Apple Silicon.

The desired division of responsibility is:

| Component | Responsibility |
|---|---|
| Local VAD | Detect speech boundaries |
| Local STT | Convert speech to text |
| GLM-5.3-Flash | Short conversation, intent interpretation, delegation decisions, tool calls, concise spoken rendering |
| qwen-audio-agent Gateway | Realtime session, task lifecycle, ACP delegation, permissions, frontend state |
| Claude Code | Repository inspection, shell, code edits, tests, MCP, skills, sustained reasoning |
| Supertonic | Text-to-speech only |

GLM must **not** become a second coding agent competing with Claude Code.

---

# 3. Goals

## G1. Keep Claude Code unchanged as the backend agent

Use the existing Claude Code ACP integration.

Default configuration:

```env
AGENT_PROTOCOL=claude
QWEN_AUDIO_AGENT_BACKEND_PERMISSION_MODE=native
```

Claude Code continues to own:

- authentication;
- backend model selection;
- MCP servers;
- skills;
- tool permissions;
- repository context;
- shell access;
- file editing;
- long-running task execution.

Do not proxy Claude through GLM.

---

## G2. Replace the realtime voice frontend

Default product profile:

```text
HF speech-to-speech
├── VAD: Silero
├── STT: Parakeet TDT / MLX
├── LLM: GLM-5.3-Flash / remote Chat Completions API
└── TTS: Supertonic / local OpenAI-compatible HTTP endpoint
```

The Gateway connects to the voice service through the existing Speech-to-Speech realtime provider path.

Target endpoint:

```text
ws://127.0.0.1:8765/v1/realtime
```

---

## G3. Minimize local RAM

No local general-purpose LLM is loaded in the default configuration.

Priority order:

1. one realtime speech pipeline;
2. local STT only;
3. remote GLM foreground LLM;
4. local lightweight Supertonic TTS;
5. small recent voice history;
6. Claude Code keeps project context separately.

The voice layer must never copy the full Claude transcript, repository content, terminal logs, or long diffs into GLM context by default.

---

## G4. Preserve realtime conversation behavior

Required behavior:

- listen while Claude works;
- spoken acknowledgement before delegation;
- user can interrupt speech;
- TTS playback stops on barge-in;
- new voice input remains usable while backend work continues;
- task completion returns naturally to the current voice conversation;
- destructive operations remain gated by the backend permission policy.

---

## G5. Remain provider-swappable

Although GLM-5.3-Flash is the default foreground LLM, provider integration must remain configuration-driven.

The voice service should continue to support any compatible:

```text
/v1/chat/completions
```

provider without changes to the Node gateway.

---

# 4. Non-goals

The first version will **not**:

- replace Claude Code with GLM;
- run GLM-5.3-Flash locally;
- implement a custom speech-to-speech engine from scratch;
- implement a new ACP protocol;
- duplicate Claude's MCP/tool system inside GLM;
- give GLM direct shell or repository write access;
- send raw microphone audio to GLM;
- add long-term semantic memory;
- add multi-user server deployment;
- optimize for Windows/Linux before the macOS path works;
- guarantee offline operation;
- remove existing qwen-audio-agent providers immediately.

---

# 5. Verified upstream capabilities

The implementation is intentionally based on existing upstream boundaries.

## qwen-audio-agent

Current upstream provides:

- a realtime voice frontend separated from a backend Agent;
- Claude Code via `claude-code-acp`;
- ACP task delegation;
- frontend-only and backend execution modes;
- alternative Speech-to-Speech realtime frontend support;
- Gateway/TUI/Web/Desktop surfaces;
- permission modes;
- task lifecycle and asynchronous backend execution.

Source:

- https://github.com/QwenAudio/qwen-audio-agent
- https://github.com/QwenAudio/qwen-audio-agent/blob/main/docs/configuration/backend.md
- https://github.com/QwenAudio/qwen-audio-agent/blob/main/docs/backends/overview.md

## Hugging Face speech-to-speech

Current upstream provides:

- modular `VAD → STT → LLM → TTS`;
- OpenAI Realtime-compatible WebSocket/WebRTC server;
- local Parakeet TDT on Apple Silicon;
- `mlx-lm` local LLM option;
- remote `responses-api` and `chat-completions` LLM backends;
- tool-call events;
- OpenAI-compatible external TTS via `/v1/audio/speech`;
- configurable realtime pipeline count.

Source:

- https://github.com/huggingface/speech-to-speech

## Supertonic

Current upstream provides:

- local ONNX-based TTS;
- Python SDK;
- local HTTP server;
- native `/v1/tts`;
- OpenAI-compatible `/v1/audio/speech`.

Source:

- https://github.com/w-websoft/supertonic-tts

## GLM-5.3-Flash

The GLM-5.3-Flash model ecosystem supports OpenAI-compatible Chat Completions style serving.

The product must treat the exact hosted provider URL, authentication scheme, model ID, tool-calling behavior, and streaming semantics as configuration that is verified with a startup smoke test rather than hard-coded.

Source:

- https://huggingface.co/zai-org/GLM-5.3-Flash

---

# 6. Target architecture

```text
┌──────────────────────────── Apple Silicon Mac ────────────────────────────┐
│                                                                          │
│  Microphone                                                              │
│      │                                                                   │
│      ▼                                                                   │
│  Silero VAD                                                              │
│      │                                                                   │
│      ▼                                                                   │
│  Parakeet TDT                                                            │
│  MLX / local STT                                                         │
│      │ text                                                              │
│      ▼                                                                   │
│  Hugging Face speech-to-speech realtime server                           │
│      │                                                                   │
│      ├──────── HTTPS ───────────────► GLM-5.3-Flash API                  │
│      │                               foreground LLM                       │
│      │                                                                   │
│      ├──────── HTTP ────────────────► Supertonic                         │
│      │                               local TTS                            │
│      │                                                                   │
│      ▼                                                                   │
│  OpenAI-Realtime-compatible WebSocket                                    │
│      │                                                                   │
│      ▼                                                                   │
│  qwen-audio-agent Gateway                                                │
│      │                                                                   │
│      ├── TUI / WebUI / Desktop                                           │
│      │                                                                   │
│      └── ACP stdio                                                       │
│             │                                                            │
│             ▼                                                            │
│         claude-code-acp                                                  │
│             │                                                            │
│             ▼                                                            │
│         Claude Code                                                      │
│         tools / MCP / skills / repo / shell                              │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

# 7. Core design principle

## One assistant, two intelligence layers

The user experiences one assistant.

Internally:

### Foreground: GLM

GLM handles:

- conversational turn-taking;
- intent classification;
- deciding whether backend execution is needed;
- producing delegation/tool calls;
- brief acknowledgement;
- explaining backend task status;
- converting backend results into concise speech;
- trivial non-execution questions.

### Backend: Claude Code

Claude handles:

- codebase understanding;
- shell commands;
- repository search;
- edits;
- tests;
- debugging;
- DB/API investigation;
- MCP;
- skills;
- long reasoning;
- sustained tasks.

The foreground must not independently claim that work was completed unless the Gateway has received backend evidence.

---

# 8. Foreground routing contract

GLM should classify every user turn into one of three classes.

## A. VOICE_ONLY

No backend execution required.

Examples:

```text
"What are you doing?"
"Repeat that."
"Say that more simply."
"Stop speaking."
```

Response stays in the voice layer.

## B. DELEGATE

Requires Claude Code.

Examples:

```text
"Check why the API is returning 500."
"Fix the failing tests."
"Look at the repository and explain this flow."
"Run the test but do not change anything."
```

GLM issues the existing backend delegation function/tool call.

## C. CONTROL

Controls an existing task/session.

Examples:

```text
"Cancel that."
"Don't edit anything."
"Just inspect it."
"When it finishes, summarize the root cause only."
```

The Gateway/task lifecycle owns the real state transition.

GLM must not simulate task cancellation or completion.

---

# 9. Foreground system prompt requirements

The GLM system prompt should be deliberately small.

Required rules:

```text
You are the foreground voice interface for a coding agent.

Claude Code is the backend execution agent.

Use Claude Code for repository inspection, files, shell, code changes,
tests, debugging, MCP, skills, and any task requiring sustained work.

Do not pretend backend work happened.
Do not fabricate tool results.
Do not duplicate Claude's coding work.

Keep spoken responses short and natural.
Delegate substantive tasks using the available backend delegation tool.

When backend results arrive, summarize only the most useful outcome for speech.
Preserve user restrictions such as:
- inspect only
- do not edit
- do not commit
- do not use production data
- ask before destructive actions
```

Target system prompt size: **< 500 tokens**.

---

# 10. Context policy

The foreground context is intentionally separate from Claude Code context.

## Allowed in GLM context

- system prompt;
- last 4–6 voice turns;
- active task ID;
- active task status;
- user constraints;
- concise backend result summary;
- small structured task metadata.

## Forbidden by default

- full Claude transcript;
- entire code files;
- full terminal logs;
- complete git diffs;
- long test output;
- repository tree dumps;
- database exports;
- secrets.

Example:

```json
{
  "task_id": "task_42",
  "status": "completed",
  "user_constraints": [
    "inspect_only",
    "no_commit"
  ],
  "result": {
    "summary": "Null token refresh path causes HTTP 500.",
    "files": ["src/auth/AuthService.ts"],
    "verification": "18 relevant tests passed"
  }
}
```

This structure is preferable to forwarding raw ACP transcript history.

---

# 11. Configuration

Create a project-specific config profile without breaking upstream defaults.

Example `.env.example`:

```env
# --------------------------------------------------
# Voice provider
# --------------------------------------------------

QWEN_AUDIO_REALTIME_PROVIDER=speech-to-speech
SPEECH_TO_SPEECH_REALTIME_URL=ws://127.0.0.1:8765/v1/realtime

# --------------------------------------------------
# Backend Agent
# --------------------------------------------------

AGENT_PROTOCOL=claude
QWEN_AUDIO_AGENT_BACKEND_PERMISSION_MODE=native

# Empty = allow Claude Code to use its own configured model
QWEN_AUDIO_AGENT_BACKEND_MODEL=

# --------------------------------------------------
# GLM foreground LLM
# --------------------------------------------------

VOICE_LLM_BACKEND=chat-completions
VOICE_LLM_MODEL=glm-5.3-flash
VOICE_LLM_BASE_URL=
VOICE_LLM_API_KEY=

VOICE_LLM_STREAM=true
VOICE_LLM_CHAT_SIZE=4
VOICE_LLM_MAX_OUTPUT_TOKENS=128

# Optional provider-specific reasoning value.
# Leave unset unless verified against the chosen GLM endpoint.
VOICE_LLM_REASONING_EFFORT=

# --------------------------------------------------
# Supertonic
# --------------------------------------------------

SUPERTONIC_BASE_URL=http://127.0.0.1:7788/v1
SUPERTONIC_MODEL=supertonic
SUPERTONIC_VOICE=
SUPERTONIC_LANGUAGE=auto

# --------------------------------------------------
# Realtime
# --------------------------------------------------

VOICE_PIPELINES=1
VOICE_LANGUAGE=auto
VOICE_LIVE_TRANSCRIPTION=true

# Do not log transcripts in normal use
VOICE_LOG_TRANSCRIPTS=false
```

Secrets must never be committed.

---

# 12. Process layout

The first release may use three processes.

## Process A — Supertonic

```bash
supertonic serve \
  --host 127.0.0.1 \
  --port 7788
```

## Process B — HF speech-to-speech

Conceptual command:

```bash
speech-to-speech serve \
  --stt parakeet-tdt \
  --llm_backend chat-completions \
  --model_name "$VOICE_LLM_MODEL" \
  --responses_api_base_url "$VOICE_LLM_BASE_URL" \
  --responses_api_api_key "$VOICE_LLM_API_KEY" \
  --responses_api_stream \
  --tts openai \
  --openai_tts_base_url "$SUPERTONIC_BASE_URL" \
  --openai_tts_model "$SUPERTONIC_MODEL" \
  --num_pipelines 1 \
  --chat_size 4 \
  --enable_live_transcription
```

Exact flags must be validated against the pinned `speech-to-speech` version during implementation.

## Process C — Gateway

```bash
npm run dev
```

or the fork's final CLI command.

---

# 13. Startup orchestration

The fork should eventually provide:

```bash
voice-agent doctor
voice-agent start
voice-agent stop
voice-agent status
```

`start` should:

1. validate Node/Python/macOS architecture;
2. validate Claude Code is installed;
3. validate Claude authentication through existing ACP setup;
4. validate GLM credentials with a small API request;
5. start or verify Supertonic;
6. start HF speech-to-speech;
7. wait for `ws://127.0.0.1:8765/v1/realtime`;
8. start Gateway;
9. display component health;
10. launch chosen UI optionally.

Do not hide failed dependencies.

---

# 14. Health model

Expose status for:

```text
Gateway
Speech-to-Speech
STT
GLM
Supertonic
Claude ACP
Microphone
Speaker
```

Suggested states:

```text
starting
ready
degraded
failed
stopped
```

Example:

```text
Voice Agent

Gateway       ready
STT           ready   Parakeet TDT / MLX
Voice LLM     ready   GLM-5.3-Flash
TTS           ready   Supertonic
Backend       ready   Claude Code
Memory        5.8 GB process total
```

Memory display is diagnostic only and must not promise exact RAM usage.

---

# 15. RAM requirements

## Primary target

The product is designed for a **16 GB Apple Silicon Mac** with normal developer applications open.

## RAM strategy

Mandatory:

- no local foreground general-purpose LLM by default;
- one speech pipeline;
- local STT only;
- local lightweight TTS;
- short voice history;
- GLM API for foreground generation;
- Claude context remains inside Claude;
- no speculative decoding;
- no duplicate model process;
- lazy-start optional services where safe;
- stop unused Qwen/DashScope frontend processes.

## Product acceptance target

During a normal 10-minute voice coding session:

- no unbounded memory growth;
- no duplicate Parakeet process;
- no duplicate Supertonic model load;
- one active HF realtime pipeline;
- memory returns near steady state after task completion;
- system remains usable on 16 GB unified memory.

Hard RAM numbers should be measured on the reference Mac rather than guessed in the product.

---

# 16. Latency targets

These are product targets, not guarantees.

| Stage | Target |
|---|---:|
| speech end → final STT | < 700 ms |
| STT result → first GLM token | < 800 ms median |
| trivial voice turn → TTS begins | < 1.5 s median |
| delegation acknowledgement | < 1.5 s median |
| interruption → playback stop | < 250 ms |
| backend completion → spoken notification start | < 1.5 s |

Network-dependent GLM latency must be measured separately.

---

# 17. Barge-in requirements

When the user speaks while TTS is playing:

1. detect speech start;
2. immediately stop local audio publication/playback;
3. cancel the active realtime response;
4. close/cancel the active TTS HTTP response best-effort;
5. do not assume the TTS server halted compute;
6. preserve an unrelated Claude backend task unless the user's new instruction explicitly cancels it;
7. process the new voice turn.

A voice interruption is **not** automatically a backend-task cancellation.

---

# 18. Backend permission policy

Default:

```env
QWEN_AUDIO_AGENT_BACKEND_PERMISSION_MODE=native
```

Reason:

Claude Code remains responsible for native permission prompts and safety boundaries.

Do not default to:

```text
full
```

The fork may provide a documented opt-in for trusted environments, but never silently enable it.

---

# 19. Failure behavior

## GLM unavailable

Voice frontend should report:

> "The voice reasoning service is unavailable."

Do not send tasks directly to Claude without an explicit fallback policy.

Optional future fallback:

```text
remote GLM
   ↓ failed
local Qwen3-0.6B/1.7B MLX
```

Not required for v1.

## Supertonic unavailable

Continue text UI if possible.

Display:

```text
TTS unavailable — text responses remain active.
```

## STT unavailable

Do not fake transcription.

Allow typed input if existing UI supports it.

## Claude unavailable

Voice-only conversation may continue.

Execution requests must return a clear backend-unavailable state.

## Claude task failure

GLM summarizes the failure accurately.

Never convert:

```text
failed
```

into:

```text
completed
```

for conversational smoothness.

---

# 20. Logging and privacy

Default:

```text
VOICE_LOG_TRANSCRIPTS=false
```

Logs should include:

- component lifecycle;
- latency;
- task IDs;
- status transitions;
- token/count metadata if available;
- error codes.

Logs should exclude by default:

- microphone audio;
- raw transcripts;
- Claude prompts;
- repository contents;
- source code;
- API keys;
- TTS text.

Add explicit `--debug-transcripts` opt-in.

---

# 21. Repository strategy

Fork:

```bash
git clone https://github.com/QwenAudio/qwen-audio-agent.git claude-voice-stack
cd claude-voice-stack
git remote rename origin upstream
```

Then create your own Git repository remote separately.

Do **not** immediately delete upstream providers.

Prefer:

```text
upstream architecture
    +
new opinionated profile
    +
process manager
    +
GLM/Supertonic setup
```

over a deep rewrite.

This keeps future upstream merging realistic.

---

# 22. Suggested repository additions

```text
claude-voice-stack/
├── PRD.md
├── config/
│   ├── profiles/
│   │   ├── glm-supertonic-claude.env.example
│   │   └── local-fallback.env.example
│   └── prompts/
│       └── foreground-glm.md
│
├── scripts/
│   ├── bootstrap-macos.sh
│   ├── doctor.sh
│   ├── start-voice-stack.sh
│   ├── stop-voice-stack.sh
│   └── smoke-test-glm.sh
│
├── services/
│   └── voice/
│       ├── speech-to-speech/
│       │   └── README.md
│       └── supertonic/
│           └── README.md
│
├── docs/
│   ├── architecture-local-glm.md
│   ├── macos-setup.md
│   ├── troubleshooting.md
│   └── ram-benchmark.md
│
└── upstream qwen-audio-agent files...
```

Avoid copying HF speech-to-speech or Supertonic source code into the repository unless modification becomes necessary.

Pin dependencies instead.

---

# 23. Dependency strategy

Initial rule:

```text
qwen-audio-agent   fork source
speech-to-speech   external Python dependency
Supertonic         external Python dependency/service
Claude Code        external installed backend
GLM                remote API
```

Use separate Python virtual environments if dependency conflicts appear.

Example:

```text
~/.claude-voice-stack/
├── venv-s2s/
├── venv-supertonic/
├── logs/
└── run/
```

Do not force incompatible MLX/ONNX/Python dependencies into the Node project.

---

# 24. Version pinning

Pin known-working versions after integration testing.

Record:

```text
qwen-audio-agent commit
speech-to-speech version/commit
supertonic version
Node version
Python version
macOS version
Claude Code version
claude-code-acp version
```

Do not follow `main` automatically in production.

---

# 25. GLM compatibility gate

Before declaring GLM support complete, run an automated startup smoke test.

## Required tests

### Basic completion

Input:

```text
Reply with exactly: OK
```

Expected:

```text
OK
```

### Streaming

Verify multiple streamed chunks arrive without malformed termination.

### Tool calling

Give GLM one mock tool:

```json
{
  "name": "delegate_to_backend",
  "description": "Delegate substantive work to Claude Code"
}
```

Input:

```text
Inspect the repository and find why tests fail.
```

Expected:

- GLM emits a tool call;
- argument JSON parses;
- no fake completion is spoken before the backend result.

### Non-delegation

Input:

```text
Repeat the last sentence more briefly.
```

Expected:

- no backend tool call.

### Constraint preservation

Input:

```text
Ask Claude to inspect the bug, but do not edit anything.
```

Expected delegated payload includes the restriction.

### Cancellation/control

Input:

```text
Cancel the active task.
```

Expected control path; do not start a new coding task.

---

# 26. Delegation payload

Prefer a structured payload.

```json
{
  "goal": "Find the cause of the login API HTTP 500.",
  "mode": "inspect",
  "constraints": [
    "do_not_edit",
    "do_not_commit",
    "do_not_use_production_data"
  ],
  "spoken_request": "Check why login is returning 500, but don't change anything."
}
```

The backend should receive the concise execution goal plus explicit constraints.

Do not force Claude to reconstruct important restrictions from an informal voice transcript.

---

# 27. Result contract

Normalize ACP completion into a small structure before giving it back to GLM.

```json
{
  "task_id": "task_42",
  "status": "completed",
  "summary": "The token refresh path can pass a null session into AuthService.",
  "changed_files": [],
  "verification": [
    "Inspected login and refresh path",
    "No files modified"
  ],
  "warnings": []
}
```

For edited tasks:

```json
{
  "status": "completed",
  "summary": "Fixed duplicate session invalidation.",
  "changed_files": [
    "src/auth/AuthService.ts"
  ],
  "verification": [
    "18 relevant tests passed"
  ]
}
```

GLM should speak the summary, not every field.

---

# 28. Speech policy

Voice responses should default to:

- 1–3 sentences;
- result first;
- no long code blocks spoken;
- no URLs spoken unless requested;
- no full stack traces;
- no giant file lists;
- ask whether the user wants details when necessary.

Example:

Bad:

```text
Claude modified src/auth/AuthService.ts at line 193...
[long technical output]
```

Preferred:

```text
Claude found the issue in session invalidation and fixed it.
All 18 relevant tests now pass.
```

---

# 29. Supertonic integration

Run Supertonic locally on loopback only by default.

Expected API:

```text
POST http://127.0.0.1:7788/v1/audio/speech
```

HF speech-to-speech owns:

- text request;
- response decoding;
- resampling;
- realtime publication;
- best-effort cancellation.

The product should not duplicate audio conversion logic in the Node Gateway unless proven necessary.

---

# 30. STT policy

Default:

```text
Parakeet TDT / MLX
```

Requirements:

- Apple Silicon optimized;
- one loaded STT model;
- auto language mode if reliable for target usage;
- support at least English and Korean workflows;
- do not retain source audio after turn processing unless debug recording is explicitly enabled.

A future optional Whisper MLX profile may be added if Korean accuracy is materially better in real tests.

The choice must be based on measured Korean/English transcription quality, not model reputation.

---

# 31. macOS first-run flow

Desired:

```text
$ voice-agent setup

Checking system...
✓ Apple Silicon
✓ Node 24
✓ Python 3.12
✓ Claude Code installed
✓ Claude Code authenticated
✓ Microphone permission
✓ Speaker available

GLM
✓ API reachable
✓ streaming works
✓ tool calling works

Installing voice components...
✓ speech-to-speech
✓ Supertonic
✓ Parakeet assets

Configuration written:
~/.claude-voice-stack/config.env

Run:
voice-agent start
```

Never print secrets.

---

# 32. `doctor` command

`voice-agent doctor` should check:

```text
OS / architecture
Node version
npm version
Python version
virtual environments
microphone access
audio output
speech-to-speech import
Parakeet model availability
Supertonic import/server
GLM API
GLM streaming
GLM tool calling
Gateway config
Claude Code executable
claude-code-acp
Claude login state
realtime WebSocket
```

Exit non-zero when a required dependency fails.

---

# 33. Test plan

## Unit

- config parsing;
- foreground prompt builder;
- context truncation;
- delegation payload preservation;
- ACP-result normalization;
- health aggregation;
- secret redaction.

## Integration

### STT

Recorded sample:

```text
"Ask Claude to inspect the authentication service, but don't edit anything."
```

Assert transcript contains the important execution constraint.

### GLM

Assert it calls the delegation tool.

### Claude ACP

Mock first, then real Claude Code.

Assert:

- task created;
- correct goal passed;
- constraints preserved;
- completion status received.

### TTS

Assert:

- spoken output generated;
- Korean and English synthesize;
- playback can be interrupted.

### Realtime

Assert:

```text
talk
→ STT
→ GLM
→ delegation
→ Claude task
→ user interrupts TTS
→ task continues
→ completion
→ spoken summary
```

---

# 34. End-to-end acceptance scenarios

## Scenario 1 — trivial conversation

User:

```text
"What did you just say?"
```

Expected:

- GLM answers;
- Claude is not invoked.

## Scenario 2 — inspect only

User:

```text
"Check why the login endpoint is failing, but don't change anything."
```

Expected:

- GLM delegates;
- Claude receives `inspect_only`;
- no files modified;
- result spoken.

## Scenario 3 — code change

User:

```text
"Fix the failing authentication test and run the relevant tests."
```

Expected:

- task delegated;
- Claude edits;
- tests run;
- spoken completion only after ACP success.

## Scenario 4 — barge-in

While TTS speaks:

```text
"Stop. Just tell me whether the tests passed."
```

Expected:

- current playback stops quickly;
- backend state remains intact;
- response is shortened.

## Scenario 5 — backend unavailable

Expected:

- GLM does not pretend execution happened;
- clear backend unavailable response.

## Scenario 6 — GLM unavailable

Expected:

- voice execution path reports degraded state;
- no fabricated delegation.

---

# 35. Performance benchmark

Create:

```text
docs/ram-benchmark.md
```

Capture:

```text
Mac model
unified RAM
macOS version
Python
Node
speech-to-speech version
Supertonic version
STT
GLM endpoint
Claude version
```

Measure:

1. baseline macOS;
2. Gateway only;
3. + STT;
4. + Supertonic;
5. + full voice session;
6. + Claude task;
7. after 10 minutes;
8. after 30 minutes.

Track:

```text
RSS / process
total used memory
memory pressure
swap
STT latency
GLM latency
TTS first audio latency
barge-in latency
```

Success is based on steady-state behavior, not a single lowest number.

---

# 36. Implementation phases

## Phase 0 — Upstream reconnaissance

Before editing:

- clone current upstream;
- run existing tests;
- identify Speech-to-Speech provider implementation;
- identify Claude ACP adapter path;
- identify realtime task/delegation tool schema;
- identify permission flow;
- identify frontend response/tool-call conversion.

Deliverable:

```text
docs/upstream-map.md
```

No code changes in this phase.

---

## Phase 1 — External voice stack proof

Without modifying the Gateway:

1. run Supertonic;
2. run HF speech-to-speech;
3. use Parakeet;
4. connect GLM Chat Completions;
5. validate streaming;
6. validate tool calling with a mock tool;
7. validate TTS;
8. validate barge-in.

Exit criterion:

```text
speech-to-speech standalone voice loop works.
```

---

## Phase 2 — Existing Gateway integration

Use upstream Speech-to-Speech provider configuration.

Do not fork protocol logic unless necessary.

Connect:

```text
Gateway
    ↕
HF realtime WebSocket
```

Keep Claude backend unchanged.

Exit criterion:

```text
voice request → existing backend delegation → Claude Code
```

works.

---

## Phase 3 — Product profile

Add:

- `.env.example`;
- foreground prompt;
- GLM startup validation;
- Supertonic config;
- macOS bootstrap;
- `doctor`;
- process lifecycle scripts.

---

## Phase 4 — RAM and latency optimization

Measure first.

Then optimize:

- remove unused local LLM assets;
- reduce chat history;
- reduce output length;
- confirm one pipeline;
- confirm one STT instance;
- confirm one TTS instance;
- tune audio playback buffer;
- eliminate duplicate service startup.

Do not perform speculative micro-optimization before profiling.

---

## Phase 5 — UX hardening

Validate:

- spoken status;
- task completion announcements;
- cancellation;
- permission prompts;
- Korean/English switching;
- startup/shutdown;
- crash recovery;
- degraded operation.

---

# 37. Upstream modification policy

Default stance:

> Minimal fork. Preserve upstream boundaries.

Before changing core Gateway code ask:

1. Can this be done through existing environment configuration?
2. Can HF speech-to-speech own it?
3. Can Supertonic own it?
4. Is there already a provider extension interface?
5. Will this change make upstream rebases harder?

Only modify core runtime when the existing extension boundary cannot satisfy the requirement.

---

# 38. Upgrade strategy

Maintain:

```text
upstream/main
your main
```

Periodically:

```bash
git fetch upstream
git merge --no-commit upstream/main
```

Before accepting an upstream merge, rerun:

- GLM compatibility tests;
- Claude ACP integration;
- barge-in;
- Supertonic;
- RAM benchmark;
- permission scenarios.

Avoid maintaining unnecessary copies of upstream files.

---

# 39. Security

Mandatory:

- bind local speech/TTS services to `127.0.0.1`;
- never expose local unauthenticated OpenAI-compatible proxy endpoints to LAN by default;
- API keys only via environment/config secret files;
- redact secrets from logs;
- native Claude permission mode by default;
- no production DB access unless explicitly configured;
- no audio recording by default;
- no transcript logging by default;
- no automatic `full` backend permissions.

---

# 40. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| GLM provider streaming differs from expected OpenAI behavior | High | Startup compatibility gate |
| GLM tool-call streaming unreliable | High | Validate before integration; pin known-good provider/model |
| Supertonic HTTP TTS adds first-audio delay | Medium | Measure and tune playback buffering |
| Parakeet Korean accuracy insufficient | High for Korean use | Real bilingual benchmark; optional Whisper MLX profile |
| HF realtime protocol differs from qwen-audio-agent expectations | High | Use current supported Speech-to-Speech provider; integration tests |
| User interruption accidentally cancels Claude work | High | Separate TTS/response cancellation from backend task cancellation |
| Voice model ignores "do not edit" | High | Structured constraints in delegation payload |
| Fork diverges heavily upstream | Medium | Configuration-first implementation |
| GLM free quota changes | Medium | Provider-swappable Chat Completions backend |
| Multiple local processes duplicate models | Medium | PID/service ownership and `doctor` checks |

---

# 41. Decisions

## D1. Claude Code stays the backend

**Accepted.**

## D2. GLM-5.3-Flash is foreground-only

**Accepted.**

It does not receive direct repository execution tools.

## D3. STT remains local

**Accepted.**

Primary: Parakeet TDT / MLX.

## D4. TTS remains local

**Accepted.**

Primary: Supertonic.

## D5. No local voice LLM by default

**Accepted.**

A local Qwen fallback can be a future profile.

## D6. Existing Speech-to-Speech protocol boundary is reused

**Accepted.**

No custom Node audio pipeline unless proven necessary.

---

# 42. Open questions to validate during implementation

These are implementation validations, not blockers to starting.

1. Does the chosen GLM hosted endpoint expose fully compatible streaming tool calls?
2. Which GLM reasoning configuration gives the lowest voice latency without hurting routing reliability?
3. Does Parakeet TDT provide acceptable Korean accuracy in the user's actual environment?
4. Which Supertonic voice/language settings sound best for mixed Korean/English technical speech?
5. Does Supertonic's HTTP response allow sufficiently fast first audio for conversational use?
6. Does current qwen-audio-agent forward all HF realtime tool-call events needed by its backend delegation path?
7. Is any fork-level code change necessary at all beyond setup/profile/process management?
8. What is the real steady-state unified-memory footprint on the reference Mac?

---

# 43. MVP definition

The MVP is complete when this interaction works reliably:

```text
User:
"Check why this API test is failing, but don't change anything."

Local STT:
accurate transcript

GLM:
short acknowledgement
+ backend delegation with inspect-only constraint

Gateway:
creates backend task

Claude Code:
inspects repository and tests
does not edit

Gateway:
receives completion

GLM:
converts result to short spoken summary

Supertonic:
speaks result

User:
can interrupt speech at any time
```

and:

- no Qwen/DashScope voice API is required;
- no local general-purpose LLM is loaded;
- Claude Code retains its existing configuration;
- the system works on Apple Silicon;
- memory does not grow without bound;
- permissions remain safe by default.

---

# 44. Definition of done

The project is ready for daily use when:

- [ ] fork rebases cleanly against the chosen upstream baseline;
- [ ] fresh macOS setup is documented;
- [ ] `doctor` identifies missing dependencies accurately;
- [ ] GLM basic completion passes;
- [ ] GLM streaming passes;
- [ ] GLM delegation/tool calling passes;
- [ ] Supertonic synthesis passes;
- [ ] English STT passes;
- [ ] Korean STT passes against agreed samples;
- [ ] Claude ACP delegation passes;
- [ ] inspect-only constraint passes;
- [ ] edit task passes;
- [ ] native permission flow passes;
- [ ] barge-in stops speech without unintentionally killing backend tasks;
- [ ] task cancellation works when explicitly requested;
- [ ] task completion is spoken;
- [ ] no transcript/audio logging by default;
- [ ] no secrets appear in logs;
- [ ] one 30-minute session shows no meaningful unbounded RAM growth;
- [ ] README includes one-command setup/start path.

---

# 45. Recommended first implementation command sequence

```bash
# 1. Fork upstream
git clone https://github.com/QwenAudio/qwen-audio-agent.git claude-voice-stack
cd claude-voice-stack

# 2. Preserve upstream remote
git remote rename origin upstream

# 3. Install upstream
npm install

# 4. Verify baseline before changes
npm test

# 5. Create the project profile
cp config/profiles/glm-supertonic-claude.env.example ~/.claude-voice-stack/config.env

# 6. Start Supertonic
supertonic serve --host 127.0.0.1 --port 7788

# 7. Start speech-to-speech with:
#    Parakeet + GLM Chat Completions + Supertonic

# 8. Smoke-test realtime WebSocket

# 9. Start Gateway with Claude backend

# 10. Run end-to-end inspect-only scenario
```

The exact npm test command and internal paths must be taken from the cloned upstream revision rather than assumed by automation.

---

# 46. Product principle

> **Spend local RAM on speech, not on duplicate reasoning.**

Claude Code is the execution intelligence.

GLM-5.3-Flash is the lightweight remote conversational/router intelligence.

Parakeet and Supertonic provide local ears and voice.

The fork should remain as close as possible to qwen-audio-agent upstream while making this configuration easy, reliable, measurable, and safe.
