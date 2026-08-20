# Extending Realtime Providers

A product host can inject a custom Realtime Provider without changing the Gateway voice session or backend Agent logic.

```js
import { createGatewayApplication } from 'qwen-audio-agent/gateway-application'
import {
  createRealtimeProviderRegistry,
  createQwenRealtimeProvider,
  openAiCompatibleProtocol,
} from 'qwen-audio-agent/realtime-provider'

const settings = loadProductSettings()
const provider = createQwenRealtimeProvider({
  key: 'private-realtime',
  label: 'Private Realtime',
  visibility: 'gateway-only',
  model: () => settings.model,
  voice: () => settings.voice,
  isConfigured: () => Boolean(settings.url && settings.token),
  url: () => settings.url,
  headers: () => ({ Authorization: `Bearer ${settings.token}` }),
  createProtocol: ({ connectionId }) => ({
    ...openAiCompatibleProtocol,
    connectionMessages: () => [{ type: 'start', connectionId }],
  }),
})

const realtimeProviderRegistry = createRealtimeProviderRegistry({
  providers: [provider],
  defaultProvider: provider.key,
})

createGatewayApplication({
  realtimeProviderRegistry,
  realtimeProvider: provider.key,
})
```

The extension boundary is:

- `createQwenRealtimeProvider()` reuses Qwen Audio session, tool, and result-announcement semantics while leaving the URL, headers, model, and voice under host control.
- `url()`, `headers()`, and `model()` can read the service URL, token, and model from host-owned configuration closures. The Gateway does not require product-specific environment variables.
- `createProtocol()` runs once for each Realtime connection, so connection IDs and mutable state remain isolated.
- `connectionMessages()` emits raw handshake frames after the WebSocket opens and before `session.update`.
- All later events pass through `encodeOutgoing()` and `normalizeIncoming()`, leaving Gateway tools, tasks, and client protocols unchanged.
- `visibility: 'gateway-only'` lets the host select a Provider without exposing it in desktop settings or the public Provider list.

Provider and Protocol contracts are validated during registration and connection setup, so missing methods or invalid values fail immediately.
