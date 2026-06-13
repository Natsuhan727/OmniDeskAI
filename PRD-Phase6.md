---
title: PRD - Phase 6 — 实时视觉监测
project: AI 视觉对话助手
phase: 6
status: ready-to-build
created: 2026-06-14
target: AI agent
requires: Phase 1-5 已完成
---

# PRD: AI 视觉对话助手 — Phase 6

> **Phase 6 目标**：从"按住说话"升级为**实时 AI 视觉监测**——AI 持续观看摄像头画面，自动发现变化并主动播报。用户可随时说话打断。

---

# 第一部分：功能描述

## 产品形态

新增第三种交互模式——**实时监测**。与现有两种模式共存：

| 模式 | 触发方式 | 说明 |
|------|----------|------|
| 🎤 按住说话 | 按住按钮 → 松开发送 | **Phase 1-5 原有，不变** |
| 🔴 实时监测 | 点击开关 → AI 持续观察 | **Phase 6 新增** |
| 🟢 实时对话 | VAD 免持 | Phase 6.1（不做） |

监测模式下：AI 每隔 2-3 秒自动捕获一帧画面，分析画面变化。如果画面有明显变化，AI 主动通过 TTS 播报观察结果。如果画面没变化，静默（不发请求）。

---

# 第二部分：功能清单

## M1: 监测引擎 — `js/monitor.js`

| 属性 | 内容 |
|------|------|
| **作用** | 帧捕获调度 + 变化检测 + 状态机 |
| **用户价值** | 核心能力——AI 能"看见时间"，不只是"看见一帧" |
| **技术复杂度** | 中 |
| **依赖** | 无（独立模块） |

### 功能详述

**帧调度器 (FrameScheduler)**：
- 启动后每隔 N 毫秒捕获一帧（可配置，默认 2000ms）
- 调用变化检测，画面相似则跳过、不发请求
- 支持外部暂停/恢复（用户说话时暂停）
- 支持调整间隔

**变化检测器 (ChangeDetector)**：
- 比较当前帧与上一帧的像素差异
- 在缩略图（32×24 像素）上逐像素比较 RGB 值
- 平均差异 < 阈值（默认 3%）→ 视为相同，不发请求
- 第一帧总是发送

**TTS 防轰炸 (Cooldown)**：
- 每次播报后进入冷却期（默认 5s），冷却期内所有观察静默丢弃
- 连续两帧观察内容相似（字符串相似度 > 70%）→ 不播报
- 冷却期内画面剧烈变化（差异 > 10% 阈值）→ 可打破冷却（紧急场景）

**观察上下文 (ObservationContext)**：
- 维护最近 3 条 AI 观察摘要的滚动数组
- 每次成功观察后追加：`{ time, text, frameHash }`
- 发送帧时携带上下文，让 AI 知道"刚才看到了什么"
- 上下文不超过 200 字（自动截断旧条目）

**监测历史隔离**：
- 监测产生的 AI 观察消息**不进入 `conversationHistory`**
- `conversationHistory` 只存用户问答（保持 12 条上限不被污染）
- 监测观察消息单独存入 `monitorHistory`（最多 20 条）
- 前端渲染时两条消息列表合并显示，但存储和 API 层面隔离

**状态机**：
```
IDLE ── start() ──→ OBSERVING ── tick() ──→ SENDING ── done ──→ OBSERVING
  ↑                    ↑                       ↑
  └── stop() ──────────┴── pause() ────────────┘
```

### 接口定义

```js
// js/monitor.js 导出

export function createMonitor(deps) {
  // deps = {
  //   captureFrame,         // () → base64 帧
  //   getConversationHistory, // () → 用户问答历史（不含监测观察）
  //   onObservation,         // (text, audio?) → 处理 AI 观察结果（UI 渲染 + TTS）
  //   onSpeaking,            // (isSpeaking) → UI 状态更新
  //   onError,               // (err) → 错误处理
  // }
  return {
    start(intervalMs?),      // 启动监测，默认 2000ms
    stop(),                  // 停止监测
    pause(),                 // 暂停（用户说话时）
    resume(),                // 恢复
    setInterval(ms),         // 调整间隔
    setCooldown(ms),         // 调整 TTS 冷却期，默认 5000ms
    getState(),              // → { mode, lastFrame, frameCount, suppressedCount }
    getObservationContext(), // → [{ time, text, frameHash }] 最近 3 条
  };
}
```

### 验收标准

- [ ] `monitor.start()` → 每隔 interval 毫秒自动调用 `captureFrame()`
- [ ] 画面不变时 → `suppressedCount` 递增，不发请求
- [ ] 画面变化时 → 发送帧到后端 → SSE → `onObservation(text, audio)`
- [ ] **TTS 冷却期**：播报后 5s 内新观察静默（除非画面差异 > 10%）
- [ ] **内容去重**：连续两帧观察文字相似度 > 70% → 跳过播报
- [ ] **观察上下文**：每次发送帧携带 `observationContext`（最近 3 条摘要）
- [ ] **监测历史隔离**：监测观察存入 `monitorHistory`，不污染 `conversationHistory`
- [ ] `monitor.pause()` → 停止定时器
- [ ] `monitor.resume()` → 恢复定时器
- [ ] `monitor.stop()` → 停止定时器，状态回 IDLE
- [ ] 变化检测阈值可配（默认 0.03），第一帧总是发送

---

## M2: 后端监测端点 — `POST /api/monitor`

| 属性 | 内容 |
|------|------|
| **作用** | 接收单帧画面，返回 AI 的视觉观察结果（SSE 流式） |
| **用户价值** | 让 AI 持续"看"画面 |
| **技术复杂度** | 中 |
| **依赖** | 现有 LLM Provider 注册表、SSE 管道 |

### 功能详述

复用现有 SSE 流式管道，与 `/api/chat/stream` 同模式：

**请求**：
```json
{
  "frame": "data:image/jpeg;base64,...",
  "prevFrame": "data:image/jpeg;base64,...",    // 上一帧（用于 AI 感知连续性）
  "observationContext": [                        // 最近 3 条 AI 观察摘要
    { "time": 1718300000, "text": "桌上有个红色水杯" },
    { "time": 1718300003, "text": "一只手出现在画面中" }
  ],
  "history": [...],                              // 用户问答历史（不含监测观察）
  "personalContext": "...",
  "action": "observe",
  "llm_api_key": "...", "llm_provider": "...", "llm_base_url": "..."
}
```

**SSE 响应**：
```
data: {"type":"observation","text":"画面中出现了一个红色水杯"}
data: {"type":"observation","text":"，旁边有一本打开的书"}
data: [DONE]
```

无变化时：
```
data: {"type":"observation","text":"NO_CHANGE"}
data: [DONE]
```

**System Prompt（监测专用）**：
```
你是实时视觉监测助手。每隔几秒你会收到一张用户摄像头的画面。

[你的记忆]
以下是你在过去几秒内观察到的事情（按时间从旧到新）：
- (2秒前) 桌上有个红色水杯
- (刚刚) 一只手出现在画面中

[规则]
- 你会同时收到上一帧画面和当前帧画面，比较两者的差异
- 如果画面与上次无明显变化，只回复 NO_CHANGE
- 如果有新物体、人物、值得注意的变化，简短描述（15字以内），口语化
- 如果之前观察到的物体消失了，也可以提及
- 不需要"我看到了..."开场白，直接描述
- 不编造不存在的内容
```

### 路由接入

在 `api/chat.js` 的路由分发中新增（在 POST 方法检查之后）：

```js
if (pathname.endsWith('/monitor')) return handleMonitor(req);
```

无需修改 `vercel.json`——复用现有路由模式。

### 验收标准

- [ ] `POST /api/monitor` → SSE 流式返回
- [ ] 当前帧 + 上一帧（prevFrame）正确传递给 LLM（两张图片消息）
- [ ] `observationContext`（最近 3 条观察摘要）正确注入 System Prompt
- [ ] `personalContext` 正确注入 System Prompt
- [ ] LLM 返回 "NO_CHANGE" 时前端不播报
- [ ] LLM 返回观察文字时正确流式输出
- [ ] `history` 只包含用户问答（不含监测观察），最近 6 条
- [ ] 超时处理（25s AbortSignal）与现有端点一致
- [ ] `buildMonitorMessages()` 将 prevFrame + currentFrame 作为连续两帧传给 VLM

---

## M3: 监测前端接入 — `js/chat-api.js` + `js/app.js`

| 属性 | 内容 |
|------|------|
| **作用** | 将监测引擎接入现有对话系统 |
| **用户价值** | 监测模式与手动问答模式无缝切换 |
| **技术复杂度** | 低 |
| **依赖** | M1, M2 |

### 功能详述

**`js/chat-api.js` 新增**：
```js
export async function monitorStream({ frame, prevFrame, observationContext, history, personalContext, action }) {
  // POST /api/monitor → SSE 解析 → { observation, audio }
  // 复用 streamChat 的 SSE buffer 逻辑
}
```

**`js/app.js` 修改**：
- `init()` 中新增加载监测开关的 DOM 引用和事件绑定
- **新增 `monitorHistory` 数组**（独立于 `conversationHistory`）：存储监测产生的 AI 观察消息
- **新增 `observationContext` 数组**：最近 3 条观察摘要的滚动窗口
- `onButtonDown()` 中：如果监测正在运行，先 `monitor.pause()`
- `sendToAI()` 完成后：如果之前暂停了监测，`monitor.resume()`
- `playAudio()` 中：AI 监测播报时按钮状态显示 `speaking`，可打断
- 每次监测观察结束后更新 `observationContext`

**监测与问答的历史隔离**：
```
conversationHistory (用户问答)          monitorHistory (监测观察)
─────────────────────                   ─────────────────────
[user] 这是什么？                       [monitor] 画面中出现红色水杯
[assistant] 这是...                     [monitor] 水杯被拿走了
[user] 那个呢？                         [monitor] 出现一本书
─────────────────────                   ─────────────────────
MAX 12 条，不受监测污染                  MAX 20 条，独立管理
─────────────────────                   ─────────────────────
                    ↓ 合并渲染 ↓
          UI: 消息列表按时间戳排序显示
```

**用户说话打断监测的完整流程**：
```
监测中 → 用户按住按钮 → pause 监测 → 录音 → 发送问答 → AI 回复 → resume 监测
```

### 验收标准

- [ ] 监测运行中，用户按住说话 → 监测暂停，录音正常
- [ ] 用户松手 → AI 问答回复完成 → 监测自动恢复
- [ ] 监测运行的 AI 播报中，用户按住按钮 → 打断播报 + 暂停监测
- [ ] 监测关闭后，所有行为与 Phase 5 完全一致（向后兼容）
- [ ] **监测观察不进入 `conversationHistory`**——`conversationHistory` 只存用户问答
- [ ] **`monitorHistory` 独立存储**监测观察，最多 20 条
- [ ] **`observationContext` 正确维护**——每次观察后更新，始终保留最近 3 条
- [ ] 发送监测帧时携带 `prevFrame` + `observationContext`
- [ ] 用户问答的 `history`（传给 `/api/monitor`）不包含监测观察

---

## M4: 监测 UI — `index.html` + `js/settings.js`

| 属性 | 内容 |
|------|------|
| **作用** | 监测开关按钮 + 运行状态指示 |
| **用户价值** | 用户一眼看到监测状态 |
| **技术复杂度** | 低 |
| **依赖** | M1, M3 |

### 功能详述

**开关按钮**（在摄像头画面和消息列表之间）：
```
┌─────────────────────────────────┐
│  [🔴 监测中 · 每 2s · 已跳过 5 帧] │
│  [⏸ 暂停监测]                    │
└─────────────────────────────────┘
```

状态指示器文本：
- 未启动：`▶ 开启实时监测`
- 运行中：`🔴 监测中 · 每 2s`（显示跳过的帧数）
- 发送中：`⏳ AI 正在观察...`
- 暂停中：`⏸ 已暂停`

### 验收标准

- [ ] 点击按钮 → 开启监测 → 按钮文案变为 `⏸ 暂停监测`
- [ ] 再次点击 → 停止监测 → 按钮文案变为 `▶ 开启实时监测`
- [ ] 监测中 → 状态指示器显示帧间隔和跳过帧数
- [ ] 无法获取摄像头时按钮 disabled
- [ ] UI 风格与现有 Tailwind 暗色主题一致

---

# 第三部分：实施计划

## 新增/修改文件

```
js/monitor.js       (新增) — 监测引擎（帧调度+变化检测+状态机）
js/chat-api.js      (修改) — +monitorStream() 函数
js/app.js           (修改) — +监测启停 + 与问答互动控制
api/chat.js         (修改) — +/monitor 路由 + buildMonitorMessages()
index.html          (修改) — +监测开关按钮 + 状态指示器
js/settings.js      (不改) — 现有设置不影响
```

## 实施顺序

```
Step 1: M1 监测引擎 (js/monitor.js)           ~2h
Step 2: M2 后端端点 (api/chat.js 扩展)        ~1.5h
Step 3: M3 前端接入 (chat-api.js + app.js)    ~1h
Step 4: M4 监测 UI (index.html)               ~1h
```

**总工作量：~5.5h。** 不新增外部依赖，全部复用现有设施。

---

# 第四部分：与现有功能的兼容性

| 现有功能 | 影响 |
|----------|------|
| **按住说话** | 零影响。与监测互斥，说话时暂停监测 |
| **对话持久化** | 监测产生的 AI 观察消息也持久化 |
| **Personal Context** | 注入到监测的 System Prompt |
| **TTS 播报** | 监测观察结果通过同一 TTS 播放 |
| **流式 SSE** | 复用 streamChat 的 buffer 逻辑 |
| **Provider 注册表** | 复用 LLM Provider |
| **记忆 UI** | 不影响 |

---

# 第五部分：完整验收清单

## M1: 监测引擎

- [ ] `monitor.start()` 启动定时器，周期性捕获帧
- [ ] 变化检测正确跳过相似帧（差异 < 3%）
- [ ] 变化检测正确发送变化帧（差异 ≥ 3%）
- [ ] **TTS 冷却期**：播报后 5s 内新观察静默（画面剧变 > 10% 除外）
- [ ] **内容去重**：连续两帧观察文字相似度 > 70% → 不播报
- [ ] **观察上下文**：`observationContext` 维护最近 3 条，每帧携带
- [ ] **监测历史隔离**：`monitorHistory` 独立，不进入 `conversationHistory`
- [ ] `pause()` 停止定时器，`resume()` 恢复
- [ ] `stop()` 停止定时器并回到 IDLE
- [ ] `getState()` 返回实时状态（mode, frameCount, suppressedCount）

## M2: 后端监测端点

- [ ] `POST /api/monitor` 返回 SSE 流
- [ ] 当前帧 + 上一帧正确传递给 VLM（两张图片消息）
- [ ] `observationContext` 注入 System Prompt（"你的记忆"段落）
- [ ] System Prompt 包含监测专用指令 + Personal Context
- [ ] LLM 返回 "NO_CHANGE" 时正常结束
- [ ] LLM 返回观察文字时 SSE 流式输出
- [ ] `history` 只包含用户问答（不含监测观察）
- [ ] 向后兼容——现有 `/api/chat` 不受影响

## M3: 前端接入

- [ ] 监测运行中，按住说话 → 暂停监测 → 录音 → 回答 → 恢复监测
- [ ] 监测播报中，按住说话 → 打断播报 → 暂停监测 → 录音
- [ ] 监测观察不污染 `conversationHistory`
- [ ] `monitorHistory` 独立存储，`observationContext` 正确维护
- [ ] 监测关闭后，所有行为与 Phase 5 一致

## M4: 监测 UI

- [ ] 开关按钮可用，文案随状态变化
- [ ] 状态指示器实时显示帧间隔和跳过帧数
- [ ] UI 风格与现有一致
- [ ] 无权限时按钮 disabled

---

> **给 AI agent**：
> 
> 实现顺序：M1 → M2 → M3 → M4。
> 
> 关键原则：
> 1. 监测模式与手动模式完全互斥——同一时间只有一种在运行
> 2. 变化检测在 32×24 缩略图上做，不要全像素比较（性能）
> 3. SSE 解析复用 `streamChat` 的 buffer 模式
> 4. 不修改 vercel.json——新路由在 `api/chat.js` 内部分发
> 5. 用户说话优先级最高——监测播报可被打断
> 6. 向后兼容——监测关闭时所有行为与 Phase 5 完全一致
> 7. **【重要】监测历史隔离**：`conversationHistory` 只存用户问答，监测观察存 `monitorHistory`，二者互不污染。传给 `/api/monitor` 和 `/api/chat` 的 `history` 字段只包含用户问答。
> 8. **【重要】TTS 防轰炸**：播报后 5s 冷却期 + 内容相似度去重（> 70% 跳过），冷却期内画面剧变（> 10%）可打破冷却。
> 9. **【重要】视觉连续性**：每次请求携带 `prevFrame`（上一帧）+ `observationContext`（最近 3 条 AI 观察摘要），让 LLM 感知时间维度和画面连续性。
