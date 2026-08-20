# Tools and Skills Design

## 分层模型

当前 Agent 能力分为三层：

| 层级 | 定义 | 面向对象 | 代码位置 |
|---|---|---|---|
| Atomic Tools | 最小确定性执行原语，负责副作用或底层服务调用 | Built-in Skills 内部 | `server/tools/`、`server/amap-mcp.mjs` |
| Built-in Skills | 系统内置大类能力，对 LLM 暴露为 function calling | LLM / Agent | `server/skills/builtin/` |
| Custom Skills | 用户通过对话创建的 Markdown 流程编排 | 用户 / LLM | `server/custom-skills/{clientId}/{skillName}/SKILL.md` |

核心原则：LLM 优先调用 Built-in Skills；Atomic Tools 是实现细节；Custom Skills 编排 Built-in Skills 和少量基础系统工具。

## 当前 Built-in Skills

| Skill | function name | 内部 Atomic Tools |
|---|---|---|
| 车控 | `vehicle_control` | `get_vehicle_state`, `car_control` |
| 导航 | `navigation` | `maps_text_search`, `maps_geo`, `maps_search_detail`, `maps_direction_driving`, `navigation` |
| 音乐 | `music` | `music_playback_control` |
| 淘宝闪购 | `flashbuy` | `flashbuy_search`, `flashbuy_update_cart`, `flashbuy_preview_order`, `flashbuy_confirm_order`, `flashbuy_cancel_order` |
| 天气 | `weather` | `maps_weather` |
| 联网查询 | `web_search` | `dashscope_web_search` |

`server/tools/index.mjs` 是可见能力注册出口。它会跳过以下 Atomic Tool 文件，再追加 `server/skills/builtin/` 中的 Built-in Skills：

```text
car-control.mjs
get-vehicle-state.mjs
music.mjs
navigation.mjs
flashbuy.mjs
weather.mjs
web-search.mjs
```

这样可以避免 LLM 直接依赖底层实现，也让调试面板中同时看到大类 Skill 和内部 Atomic Tool。

## 当前 LLM 可见能力

| function name | 类型 | 说明 |
|---|---|---|
| `vehicle_control` | Built-in Skill | 车窗、天窗、大灯、空调控制与车辆状态查询 |
| `navigation` | Built-in Skill | 地点搜索、路线规划、开始/停止导航 |
| `music` | Built-in Skill | 播放、暂停、切歌、搜索音乐 |
| `flashbuy` | Built-in Skill | 淘宝闪购外卖/奶茶搜索、加购、试算订单、确认下单 |
| `weather` | Built-in Skill | 查询当前城市或指定城市天气 |
| `web_search` | Built-in Skill | 查询最新、实时、新闻、政策、价格、活动等联网信息 |
| `memory_read` / `memory_write` / `memory_delete` | 系统工具 | 长期记忆管理 |
| `skill_create` / `skill_run` | 系统工具 | Custom Skill 创建和加载 |
| `get_time` / `get_location` | 系统工具 | 当前时间与车辆位置 |
| `notify_user` | 系统工具 | 主动通知 |
| `timer_set` / `timer_cancel` | 系统工具 | 提醒定时器 |
| `context_compact` | 系统工具 | 对话历史压缩 |

## Skill 路由规则

`server/agent.mjs` 会在系统 prompt 和 `inferRequiredSkill()` 中强化以下路由：

- 车控、车况、空调、车窗、天窗、大灯 → `vehicle_control`
- 导航、路线、目的地、途经点、停止导航 → `navigation`
- 播放、暂停、切歌、点歌、歌单 → `music`
- 外卖、奶茶、咖啡、点餐、淘宝闪购、下单 → `flashbuy`
- 天气、气温、下雨、带伞、穿衣、冷不冷、热不热、风力 → `weather`
- 最新、实时、新闻、政策、公告、活动、价格、股价、汇率、油价、金价、赛事、限行、网上查 → `web_search`

如果用户请求命中明确技能，Agent 会使用 `tool_choice` 强制首轮调用对应 Skill，降低模型直接回复、不调用工具的概率。

## Built-in Skill 设计

### `vehicle_control`

用于车辆状态查询和控制。内部先读车辆状态，再调用车控 Atomic Tool，最后返回 UI actions。

典型参数：

```json
{ "action": "open", "part": "windows" }
{ "action": "set_temp", "part": "ac", "temperature": 23 }
{ "action": "query", "part": "all" }
```

前端 action 示例：

```json
{ "type": "car_control", "part": "windowFL", "state": 1 }
```

### `navigation`

用于地点搜索、路线规划、导航开始/停止。它会向前端发阶段进度和地图 actions：

- `searching_destination`：正在查找目的地。
- `destination_locked`：已锁定目的地。
- `planning_route`：正在规划路线。
- `route_ready`：路线规划完成。
- `navigation_started`：开始导航。

前端 action 示例：

```json
{
  "type": "navigation",
  "action": "start",
  "destination": "西湖",
  "route": {
    "distanceText": "23.6km",
    "durationText": "52分钟"
  }
}
```

### `music`

用于播放、暂停、上一首、下一首和搜索歌曲。

```json
{ "type": "music", "action": "play", "query": "晴天" }
```

### `flashbuy`

用于淘宝闪购伪实现。当前支持外卖和奶茶两类商品，语音可以驱动搜索、加购、试算和确认下单。

关键约束：

- 下单前必须先预览订单。
- 只有用户明确确认时才能 `confirm_order`。
- Skill 会发 `flashbuy` actions 打开闪购应用、更新商品列表、购物车、订单预览和配送状态。

典型流程：

```text
用户：帮我点一杯热奶茶
flashbuy(search/add_to_cart) → 搜索附近商品 → 加入购物车 → 试算订单
助手：我找到一杯厚芋泥鲜奶，预计 20 分钟送到，总价 24 元，要下单吗？
用户：确认
flashbuy(confirm_order) → 模拟下单
```

### `weather`

用于天气、气温、下雨、穿衣和带伞建议。内部调用高德 MCP 的 `maps_weather`。

前端 action 会更新 TopBar 天气状态：

```json
{ "type": "weather", "weather": { "city": "杭州", "dayweather": "多云", "daytemp": "28" } }
```

### `web_search`

用于强时效或需要联网的问题。内部调用 DashScope/通义文本生成接口，并开启联网搜索：

- `enable_search: true`
- `forced_search: true`
- `enable_source: true`
- `enable_citation: true`

返回内容包含简洁答案和最多 6 条来源摘要。天气优先用 `weather`，导航优先用 `navigation`，车控优先用 `vehicle_control`，闪购优先用 `flashbuy`。

## Custom Skill 编写约定

用户自定义 Skill 应优先编排 Built-in Skills：

```markdown
---
name: 下班回家
description: 一键设置回家路线、播放音乐、调节车内环境
---

1. 调用 navigation，目的地为“家”。
2. 调用 music，播放用户喜欢的音乐。
3. 调用 vehicle_control，关闭所有车窗。
4. 如果用户想顺路买东西，可以调用 flashbuy。
5. 如果需要判断天气或限行，分别调用 weather 或 web_search。
```

只有时间、位置、记忆、通知、定时器等基础能力才直接使用系统工具，例如 `get_time`、`get_location`、`memory_read`、`notify_user`。

## 调试信息

Built-in Skills 可以通过 `context.onProgress()` 上报阶段进度，通过 `context.onSubCall()` 上报 Atomic Tool 调用。文本和语音链路都会把这些信息放进调试面板：

- `progress`：阶段名称、中文文案、领域标签、播报策略。
- `tool_calls`：工具名、参数、结果、耗时。
- `thinking`：模型思考内容，只有开启 thinking 时显示。
- `usage` / `duration_ms`：token 和耗时。
