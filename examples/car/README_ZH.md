# Qwen Audio Agent Car

[中文](README_ZH.md) | [English](README.md)

## 车内的 Agent Presence

真实的座舱交互不应该像在缓慢菜单里下指令。驾驶员或乘客自然说话，助手持续聆听，
车辆任务在执行时也不阻塞当前对话。

**Qwen Audio Agent Car** 是 `qwen-audio-agent` 的智能座舱示例。它把车机 UI、
实时语音、文本 Agent、车辆控制、导航、音乐、淘宝闪购、天气、联网查询、记忆和
自定义技能放在一个可运行的 demo 里。当前示例刻意保持自包含，让
qwen-audio-agent 主运行时继续维持通用边界。

## 快速开始

以下命令默认在 `qwen-audio-agent` 仓库根目录执行。

### 1. 配置环境

```bash
cp examples/car/.env.example examples/car/.env.local
```

填写 `examples/car/.env.local`：

```dotenv
VITE_AMAP_KEY=your_amap_js_key
VITE_AMAP_SECRET=your_amap_js_secret
AMAP_MCP_KEY=your_amap_mcp_key

DASHSCOPE_API_KEY=your_dashscope_api_key
DASHSCOPE_MODEL=qwen3.6-plus
DASHSCOPE_WEB_SEARCH_MODEL=qwen-plus
```

可选的实时语音覆盖配置也列在 `.env.example` 中。

### 2. 启动 Agent 服务

```bash
npm install --prefix examples/car/server
npm run example:car:server
```

服务默认监听 `http://localhost:3001`。

### 3. 启动座舱 UI

另开一个终端：

```bash
npm install --prefix examples/car/react-app
npm run example:car:web
```

浏览器打开 `http://localhost:5173`。

## 核心能力

- 自然语音对话，支持全双工聆听和说话打断
- 智能座舱控制，覆盖车窗、天窗、大灯、空调和车辆状态
- 导航辅助，支持目的地搜索、路线预览和行程引导
- 音乐播放控制，支持搜歌、播放、暂停和切歌
- 淘宝闪购流程，支持外卖、饮品、购物车预览和确认下单
- 天气、联网查询和时间感知回答，辅助车内即时决策
- 个性化记忆，记住称呼、偏好、习惯和常用需求
- 自定义座舱技能，可扩展用户自己的工作流

## 架构

![Qwen Audio Agent Car 架构](docs/system-architecture.svg)

## 开发

```bash
npm run example:car:build
npm run example:car:lint
```

如果要在局域网设备上体验语音，浏览器麦克风权限通常需要 HTTPS，或把访问地址加入允许的不安全源。
`localhost` 不需要额外浏览器配置。

## 参考文档

- [系统架构](docs/system-architecture.md)
- [Agent 设计](docs/agent-design.md)
- [Tools and Skills 设计](docs/tools-and-skills.md)
- [语音交互设计](docs/voice-interaction-design.md)
