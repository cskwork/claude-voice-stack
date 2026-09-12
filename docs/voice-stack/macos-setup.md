# macOS setup (Apple Silicon)

## Requirements

- Apple Silicon Mac, macOS 14 or newer, 16 GB unified memory recommended
- Node.js 22.22+ (`nvm install 22`)
- Python 3.10–3.12 (`brew install python@3.12`)
- Claude Code installed and logged in (`claude` on PATH, `claude auth status`)
- A GLM-5.3-Flash Chat Completions endpoint and API key (Z.ai, Zhipu, or any OpenAI-compatible host)

## One-command setup

```bash
git clone https://github.com/cskwork/claude-voice-stack.git
cd claude-voice-stack
npm install
npm run voice-agent -- setup
```

`setup` creates `~/.claude-voice-stack/venv-s2s`, installs
`speech-to-speech[supertonic]==1.0.0`, pre-downloads the Parakeet TDT model, builds
the WebUI, and writes `~/.claude-voice-stack/config.env` from
`config/profiles/glm-supertonic-claude.env.example` (mode 600). It never prints secrets.

Edit the config and fill in the two GLM values:

```dotenv
VOICE_LLM_BASE_URL=https://api.z.ai/api/paas/v4
VOICE_LLM_API_KEY=...
```

Optionally point Claude Code at a repository:

```dotenv
CLAUDE_WORKSPACE=/path/to/your/project
```

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

## Alternative profiles

- `config/profiles/local-fallback.env.example`: local MLX router instead of GLM.
  Needs `~/.claude-voice-stack/venv-s2s/bin/pip install "speech-to-speech[mlx-lm]==1.0.0"`
  and several GB of extra memory.
- `VOICE_TTS_MODE=openai-http`: run Supertonic as a separate HTTP server
  (`services/voice/supertonic/README.md`).
- `VOICE_STT=whisper-mlx`: try Whisper if Parakeet's Korean accuracy is not
  good enough in your recordings (`ram-benchmark.md` records the comparison).

## Pinned versions (verified 2026-09-13)

| Component | Version |
|---|---|
| qwen-audio-agent baseline | a6a56b5 (1.11.0) |
| speech-to-speech | 1.0.0 |
| supertonic | 1.3.1 |
| mlx-audio | 0.4.7 |
| Parakeet | mlx-community/parakeet-tdt-0.6b-v3 |
| claude-code-acp | @zed-industries/claude-code-acp@0.16.2 (upstream launcher default) |
| Node | 22.22.3 |
| Python | 3.12.11 |
| macOS | 26.6.2 |
| Claude Code | 2.1.269 |
