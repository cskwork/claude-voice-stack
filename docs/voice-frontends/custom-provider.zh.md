# 扩展 Realtime Provider

业务宿主可以注入自定义 Realtime Provider，而不必修改 Gateway 的语音会话与后台 Agent 逻辑。

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

扩展边界如下：

- `createQwenRealtimeProvider()` 复用 Qwen Audio 的 Session、工具与结果播报语义；URL、请求头、模型和音色仍由宿主配置。
- `url()`、`headers()`、`model()` 可从宿主配置闭包读取服务地址、令牌和模型；Gateway 不要求为业务 Provider 增加环境变量。
- `createProtocol()` 每条 Realtime 连接调用一次，适合生成连接级 ID 和隔离状态。
- `connectionMessages()` 在 WebSocket 打开后、`session.update` 之前发送原始握手帧。
- 其余事件通过 `encodeOutgoing()` 与 `normalizeIncoming()` 转换，Gateway 的工具调用、任务和客户端协议保持不变。
- `visibility: 'gateway-only'` 可让 Provider 仅供宿主选择，不出现在桌面设置和公共 Provider 列表中。

Provider 和 Protocol 会在注册与建连时校验；缺少方法或返回无效结构会立即报错。
