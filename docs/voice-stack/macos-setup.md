# macOS setup (Apple Silicon)

## Requirements

- Apple Silicon Mac, macOS 14 or newer, 16 GB unified memory recommended
- Node.js 22.22+ (`nvm install 22`)
- Python 3.10–3.12 (`brew install python@3.12`)
- Your selected CLI installed and authenticated: Claude Code, Codex, or Pi
- A GLM-5.3-Flash Chat Completions endpoint and API key (Z.ai, Zhipu, or any OpenAI-compatible host)

## One-command setup

```bash
git clone https://github.com/cskwork/claude-voice-stack.git
cd claude-voice-stack
npm install
npm run voice-agent -- setup
```

`setup` creates `~/.claude-voice-stack/venv-s2s`, installs
`speech-to-speech[supertonic,whisper-mlx]==1.0.0`, pre-downloads Whisper small into `~/.claude-voice-stack/mlx_models/small`, builds
the WebUI, and writes `~/.claude-voice-stack/config.env` from
`config/profiles/glm-supertonic-claude.env.example` (mode 600). It never prints secrets.

Edit the config and fill in the two GLM values:

```dotenv
VOICE_LLM_BASE_URL=https://api.z.ai/api/paas/v4
VOICE_LLM_API_KEY=...
```

## Choose a backend

Set `AGENT_PROTOCOL` in the same `config.env`. One Gateway uses one agent at a
time; Claude Code remains the default. This applies to both GLM and local MLX
router profiles.

| Agent | Selection | Optional repository | Executable override |
|---|---|---|---|
| Claude Code | `AGENT_PROTOCOL=claude` | `CLAUDE_WORKSPACE=/path/to/project` | `CLAUDE_CODE_EXECUTABLE` |
| Codex | `AGENT_PROTOCOL=codex` | `CODEX_WORKSPACE=/path/to/project` | `CODEX_PATH` |
| Pi | `AGENT_PROTOCOL=pi` | `PI_WORKSPACE=/path/to/project` | `PI_ACP_PI_COMMAND` or `PI_BIN` |

Install the selected CLI and authenticate it using `claude`, `codex login`, or
Pi's interactive `/login`. Pi requires version 0.80.4 or later. The existing
Gateway launchers use an installed ACP adapter when available, otherwise fetch
their pinned package through `npx`. Adapter overrides are `CLAUDE_CODE_ACP_BIN`,
`CODEX_ACP_BIN`, and `PI_ACP_BIN`. See the [upstream backend configuration](../backends/configuration.md)
for installation and provider settings.

Keep `QWEN_AUDIO_AGENT_BACKEND_MODEL` empty to use the selected agent's model.
Each backend retains its own credentials and sessions. The workspace defaults
to the upstream shared workspace when its setting is empty.

Claude Code and Codex use `QWEN_AUDIO_AGENT_BACKEND_PERMISSION_MODE=native`.
Pi runs as your user without approval prompts even when this value is `native`.
Selecting Pi enables that behavior directly. Its adapter does not expose Gateway
MCP tools or create separate delegated sessions; it completes tasks with Pi's own
tools. See [Pi adapter limitations](https://github.com/svkozak/pi-acp#limitations).

To switch, run `npm run voice-agent -- stop`, edit `AGENT_PROTOCOL` and the
matching workspace, then run `doctor` and `start --tui`. Shell environment values
have precedence over `config.env`. Existing tasks and conversation history do
not move between agents. `start` refuses to reuse a Gateway running a different
backend, and `status` reports the mismatch.

`doctor` checks the selected executable and its authentication status, including
custom executable paths and config directories. Unknown authentication remains
explicitly unverified. The ACP launcher check verifies the local launcher file;
Gateway health reports whether the adapter actually connected.

## Check, start, talk

```bash
npm run voice-agent -- doctor      # exits non-zero on a missing requirement
npm run voice-agent -- start       # speech-to-speech + Gateway
npm run tui                        # or: npm run voice-agent -- start --tui
npm run voice-agent -- status
npm run voice-agent -- stop
```

`start` runs the GLM basic check, launches speech-to-speech (first start can take
a couple of minutes while models warm up), waits for `ws://127.0.0.1:8765/v1/realtime`,
launches the Gateway on `http://127.0.0.1:3101`, and prints component health.

Grant microphone access to your terminal application when macOS asks. Use
headphones or the built-in echo cancellation to avoid the assistant hearing itself.

## Global command

`npm link` (or `npm run install:global`) exposes `voice-agent` on PATH; the npm
script form works without it.

## Test the full voice and coding path

```bash
npm run test:voice-stack:e2e
# Optional: -- --backends codex --config /path/to/router.env --output /tmp/my-voice-test
```

This opt-in test uses the configured remote router and actual Claude Code,
Codex, and Pi accounts, so normal provider usage charges apply. It starts its
own speech service and Gateway on free loopback ports, sends a synthesized
Korean recording through the same audio input protocol as the TUI, and checks
that the selected agent reads a unique instruction file, writes and verifies
the expected result, and returns a spoken completion through the Gateway.

Each agent gets a separate temporary workspace and Gateway configuration.
Native approval requests are accepted only when their concrete file locations
are inside that workspace. Agents retain their normal authentication and
session stores. `results.json`, event logs, the input recording, and each
agent's response recording are saved in the printed artifact directory.

The test uses recorded digital audio and simulated playback receipts. Physical
microphone capture, speakers, and acoustic echo cancellation need a separate
hands-on check. `test:voice-stack:integration` remains the offline-router test
of the speech service alone; it does not execute coding agents.

## Alternative profiles

- `config/profiles/local-fallback.env.example`: local MLX router instead of GLM.
  Needs `~/.claude-voice-stack/venv-s2s/bin/pip install "speech-to-speech[mlx-lm]==1.0.0"`
  and several GB of extra memory.
- `VOICE_TTS_MODE=openai-http`: run Supertonic as a separate HTTP server
  (`services/voice/supertonic/README.md`).
- `VOICE_STT=parakeet-tdt`: smaller, faster STT for English-only sessions
  (`voice-agent setup --with-parakeet` pre-downloads it). Measured on
  2026-09-13: Parakeet TDT v3 transcribes Korean as garbage (it detects
  Lithuanian/German); Whisper small transcribed both test sentences exactly
  with auto language detection. That measurement is why Whisper small is the
  default. Keep `VOICE_STT_LANGUAGE` empty for mixed Korean/English.

## Pinned versions (verified 2026-09-13)

| Component | Version |
|---|---|
| qwen-audio-agent baseline | a6a56b5 (1.11.0) |
| speech-to-speech | 1.0.0 |
| supertonic | 1.3.1 |
| mlx-audio | 0.4.7 |
| STT (default) | whisper-mlx `small` (mlx-community/whisper-small-mlx via lightning-whisper-mlx 0.0.10) |
| STT (English-only option) | mlx-community/parakeet-tdt-0.6b-v3 |
| claude-code-acp | @zed-industries/claude-code-acp@0.16.2 (upstream launcher default) |
| Node | 22.22.3 |
| Python | 3.12.11 |
| macOS | 26.6.2 |
| Claude Code | 2.1.269 |
