# Qwen Audio Agent Car

[中文](README_ZH.md) | [English](README.md)

## Agent Presence In The Car

Real cockpit interaction should not feel like issuing commands to a slow menu.
The driver or passenger speaks naturally, the assistant keeps listening, and
vehicle tasks continue without blocking the conversation.

**Qwen Audio Agent Car** is a smart cockpit example for
`qwen-audio-agent`. It combines a car UI, realtime speech, a text Agent,
vehicle control, navigation, music, flash-buy workflows, weather, web search,
memory, and custom skills in one runnable demo. The example is intentionally
self-contained today, so the core qwen-audio-agent runtime remains generic.

## Quick Start

Run the following commands from the `qwen-audio-agent` repository root.

### 1. Configure Environment

```bash
cp examples/car/.env.example examples/car/.env.local
```

Fill in `examples/car/.env.local`:

```dotenv
VITE_AMAP_KEY=your_amap_js_key
VITE_AMAP_SECRET=your_amap_js_secret
AMAP_MCP_KEY=your_amap_mcp_key

DASHSCOPE_API_KEY=your_dashscope_api_key
DASHSCOPE_MODEL=qwen3.6-plus
DASHSCOPE_WEB_SEARCH_MODEL=qwen-plus
```

Optional realtime voice overrides are also listed in `.env.example`.

### 2. Start The Agent Server

```bash
npm install --prefix examples/car/server
npm run example:car:server
```

The server listens on `http://localhost:3001`.

### 3. Start The Car UI

Open another terminal:

```bash
npm install --prefix examples/car/react-app
npm run example:car:web
```

Open `http://localhost:5173`.

## Features

- Natural voice conversation with full-duplex listening and interruption
- Smart cockpit controls for windows, sunroof, headlights, air conditioning,
  and vehicle status
- Navigation assistance for destination search, route preview, and driving
  guidance
- Music playback controls for search, play, pause, and song switching
- Flash-buy flows for food, drinks, shopping cart preview, and order
  confirmation
- Weather, web search, and time-aware answers for in-car decisions
- Personalized memory for names, preferences, habits, and recurring needs
- Custom cockpit skills that can extend the assistant with user-defined
  workflows

## Architecture

![Qwen Audio Agent Car architecture](docs/system-architecture.svg)

## Development

```bash
npm run example:car:build
npm run example:car:lint
```

For voice testing on a LAN device, browser microphone permissions usually
require HTTPS or an explicit insecure-origin allowlist. `localhost` works
without extra browser configuration.

## References

- [System architecture](docs/system-architecture.md)
- [Agent design](docs/agent-design.md)
- [Tools and Skills design](docs/tools-and-skills.md)
- [Voice interaction design](docs/voice-interaction-design.md)
