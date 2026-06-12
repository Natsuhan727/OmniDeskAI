---
title: PRD - Phase 2
project: AI 视觉对话助手
phase: 2
status: ready-to-build
created: 2026-06-13
target: AI agent
requires: Phase 1 MVP 已跑通
---

# PRD: AI 视觉对话助手 — Phase 2

> Phase 1 已完成：摄像头 + 语音 → AI 文字回复。
> Phase 2 目标：**让 AI 说出口，让对话有记忆。**

---

## 1. Phase 2 新增功能

| # | 功能 | 优先级 | 说明 |
|---|------|:--:|------|
| F1 | **TTS 语音播报** | P0 | AI 回复用语音读出来 |
| F2 | **多轮对话** | P0 | AI 记住最近几轮对话 |
| F3 | **打断** | P1 | 用户说话时停止 TTS |
| F4 | **消息列表** | P1 | 对话气泡展示历史 |
| F5 | **错误分级降级** | P2 | ASR 失败 / LLM 超时优雅处理 |

> P0 = 必须实现，P1 = 尽量实现，P2 = 有时间就做。

---

## 2. F1: TTS 语音播报

### 2.1 方案

**使用浏览器 Web Speech Synthesis API**。

```js
const utterance = new SpeechSynthesisUtterance(text);
utterance.lang = 'zh-CN';
utterance.rate = 1.1;
speechSynthesis.speak(utterance);
```

- 浏览器内置，零 API 调用，零成本
- 中文语音自然度可接受
- Chrome 桌面端完全支持
- 不需要后端改动

### 2.2 交互设计

```
AI 文字回复显示 → 同时开始 TTS 播报 → 播完自动停止
```

- 显示文字的同时播放语音，用户可以"看"也可以"听"
- 播报期间按钮禁用，显示 "🔊 AI 回复中..."

### 2.3 实现要点

```js
// sendToAI 成功后
showReply(data.text);
speakReply(data.text);   // 新增

function speakReply(text) {
  setButtonState('speaking');
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'zh-CN';
  utterance.rate = 1.1;
  utterance.onend = () => resetToIdle();
  utterance.onerror = () => resetToIdle();  // TTS 失败不影响文字显示
  speechSynthesis.speak(utterance);
}
```

### 2.4 按钮状态新增

| 状态 | 按钮文字 | 说明 |
|------|---------|------|
| speaking | `🔊 AI 回复中...` | TTS 播放中，禁用点击 |

---

## 3. F2: 多轮对话

### 3.1 方案

前端保留最近 N 轮对话记录，每次请求把历史传给后端 LLM。

### 3.2 数据结构

```js
// 前端维护的历史记录
let conversationHistory = [];  // 最多 6 条（3 轮 Q&A）

// 每条记录格式
{
  role: 'user' | 'assistant',
  content: '...',
  // user 消息额外带 frame
}
```

### 3.3 API 改动

```diff
POST /api/chat
{
  audio: "...",      // base64 PCM
  pcmLen: 1234,
  frame: "...",      // 当前帧
+ history: [         // 新增
+   { role: "user", content: "这是什么？" },
+   { role: "assistant", content: "这是一个水杯。" },
+   { role: "user", content: "它是什么颜色？" },
+ ]
}
```

### 3.4 后端 LLM 请求构造

```js
messages: [
  { role: 'system', content: '...' },
  ...history,                                          // 历史对话
  { role: 'user', content: [
    { type: 'image_url', image_url: { url: frame } },
    { type: 'text', text: currentText },
  ]},
]
```

### 3.5 约束

- 历史只保留最近 3 轮（6 条消息），控制 token 消耗
- 历史中不带历史帧（只带当前帧），大幅减少 token
- 每轮完成后更新 history

---

## 4. F3: 打断

### 4.1 交互

AI 正在 TTS 播报时，用户按住按钮 → 停止 TTS → 开始新一轮录音。

### 4.2 实现

```js
function onButtonDown(e) {
  // 如果正在播报 → 打断
  if (speechSynthesis.speaking) {
    speechSynthesis.cancel();
    // 继续执行录音流程
  }
  // ... 原有录音逻辑
}
```

---

## 5. F4: 消息列表（对话气泡 UI）

### 5.1 当前

```
┌─────────────────┐
│  摄像头画面      │
├─────────────────┤
│  AI 回复文字    │  ← 只有一个回复区，每次覆盖
├─────────────────┤
│  🎤 按住说话    │
└─────────────────┘
```

### 5.2 改为

```
┌─────────────────┐
│  摄像头画面      │
├─────────────────┤
│  👤 这是什么？   │  ← 用户消息气泡
│  🤖 这是一个... │  ← AI 回复气泡
│  👤 它是什么材  │
│     质的？      │
│  🤖 这是玻璃制  │
│     的...       │
├─────────────────┤
│  🎤 按住说话    │
└─────────────────┘
```

- 消息列表可滚动，自动滚到最新
- 用户消息气泡靠右，AI 靠左
- 每条用户消息旁显示当时的缩略帧

---

## 6. F5: 错误分级降级（P2）

| 错误 | 当前 | 改进 |
|------|------|------|
| ASR 失败 | "语音识别失败" | 展示具体原因 + 重试按钮 |
| ASR 为空 | "未检测到语音" | 保持不变 |
| LLM 超时 | "AI 响应超时" | 自动重试 1 次，再失败才报错 |
| TTS 失败 | — | 静默降级：文字照常显示 |

---

## 7. 成本控制策略更新

> Phase 1 已做：640×480 JPEG Q=60 帧压缩、按需发帧（只在提问时发一帧）、isProcessing 防重复。

Phase 2 新增或改进：

| # | 策略 | 实现 |
|---|------|------|
| C-1 | 帧压缩 | 已做（640×480 Q=60） |
| C-2 | 按需发帧 | 已做（只在用户提问时发一帧） |
| C-3 | 对话历史 Token 控制 | 历史不带帧、只保留 3 轮 |
| C-4 | 百度 OAuth Token 缓存 | 已做（29 天有效期，module-level） |
| C-5 | TTS 本地执行 | Web Speech Synthesis，零 API 调用 |
| C-6 | 短音频过滤 | audioBlob < 1000 bytes 不发送 |

---

## 8. 文件结构（不变）

```
project-root/
├── index.html              # 前端（消息列表、TTS、历史）
├── api/
│   └── chat.js             # 后端（支持 history 参数）
├── package.json
├── vite.config.js
├── vercel.json
├── .gitignore
└── README.md
```

> Phase 2 不改文件结构。所有新增功能都在现有文件中实现。

---

## 9. 构建顺序

### PR #7: TTS 语音播报 (F1)

```
改动: index.html
- 新增 speakReply() 函数
- 新增 'speaking' 按钮状态
- sendToAI 成功后调用 speakReply
- onButtonDown 增加打断逻辑
```

### PR #8: 多轮对话 + 消息列表 (F2 + F4)

```
改动: index.html + api/chat.js
前端:
- conversationHistory[] 维护
- 消息列表 UI（替代单行回复区）
- API 请求新增 history 字段

后端:
- 接收 history 参数
- LLM messages 构造改为 [system, ...history, user(frame+text)]
```

### PR #9: 错误处理打磨 (F5)

```
改动: index.html + api/chat.js
- 错误分级展示
- LLM 超时自动重试
- 控制台清理（去掉调试日志）
```

---

## 10. 验收标准

### PR #7 (TTS)
- [ ] AI 回复显示后，浏览器自动朗读
- [ ] 朗读期间按钮显示 "🔊 AI 回复中..."
- [ ] 朗读完毕按钮恢复 "🎤 按住说话"
- [ ] TTS 失败时文字照常显示，不影响功能

### PR #8 (多轮对话)
- [ ] 第 2 轮对话时 AI 能引用第 1 轮的内容
- [ ] 消息列表显示历史对话气泡
- [ ] 历史中不带旧帧（token 控制）
- [ ] 超过 3 轮后旧消息自动丢弃

### PR #9 (错误打磨)
- [ ] ASR 失败时显示具体原因
- [ ] LLM 超时自动重试 1 次

---

> **给 AI agent**：按 PR #7 → #8 → #9 顺序实现。每完成一个 PR 自检验收。不要在同一个 PR 里做多个功能。Phase 1 已经跑通的代码不要动，在此基础上增量修改。
