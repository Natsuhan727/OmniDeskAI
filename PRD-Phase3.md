---
title: PRD - Phase 3
project: AI 视觉对话助手
phase: 3
status: ready-to-build
created: 2026-06-13
target: AI agent
requires: Phase 1+2 已跑通，Provider 架构已统一
---

# PRD: AI 视觉对话助手 — Phase 3

> Phase 1+2：核心功能完整。
> Phase 3：流式输出 + 体验打磨。不改架构，增量优化。

---

## 1. Phase 3 功能

| # | 功能 | 优先级 | 风险 | 说明 |
|---|------|:--:|:--:|------|
| F1 | **流式文字输出** | P0 | 中 | LLM 回复逐字显示，感知延迟大幅降低 |
| F2 | **设置面板** | P1 | 低 | 可折叠面板：模型选择、TTS 开关、帧质量 |
| F3 | **前端模块拆分** | P2 | 低 | index.html 拆为 app.js + ui.js（不改行为） |

> Phase 3 不碰 ASR/TTS/LLM Provider——它们已经稳定。

---

## 2. F1: 流式文字输出

### 2.1 问题

当前 LLM 返回完整回复后才显示文字。用户按住说话后等 5-8 秒看到空白页面，体验像"卡住了"。流式输出让文字逐字出现，即使总时间不变，感知延迟降低到 <1 秒。

### 2.2 方案

DashScope 支持 `stream: true`（SSE 格式）。后端改为流式转发，前端逐字渲染。

### 2.3 后端改动

```js
// llmDashScope() 中
const resp = await fetch(`${baseUrl}/chat/completions`, {
  // ... 
  body: JSON.stringify({ ..., stream: true }),  // 新增
});

// 不再等完整响应，直接返回流
return new Response(resp.body, {
  headers: {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  },
});
```

> ⚠️ 流式响应改变 handler 返回方式。在 `api/chat.js` 内通过 URL 区分路由：
> `/api/chat` → 非流式（Phase 2 行为，不变）
> `/api/chat/stream` → 流式 SSE
> `/api/tts` → TTS 独立端点
> 
> 三个路由共用 Provider 注册表和 Token 缓存（同一文件，module-level 共享）。

### 2.3a 共享 ASR 处理

`handleStream` 和 handler（非流式）都需要 ASR。提取共享函数消除重复：

```js
async function processAudio(body) {
  const parsed = parseAndValidate(body);
  if (!parsed.valid) return { error: parsed.error, status: 400 };

  const { audio, frame, history } = parsed.data;
  const asrResult = await transcribeAudio(audio);
  if (asrResult.error) return { error: asrResult.error, status: asrResult.status };
  if (!asrResult.text?.trim()) return { error: '未识别到语音内容，请重试', status: 200 };

  const model = body.model || process.env.LLM_MODEL || 'qwen-vl-plus';
  return { data: { frame, text: asrResult.text, history, model } };
}
```

两个 handler 都调用它：
```js
// handler（非流式）
const proc = await processAudio(body);
if (proc.error) return json(proc.status, { text: null, audio: null, error: proc.error });
const { frame, text, history, model } = proc.data;
const llmResult = await chatWithVision(frame, text, history, model);

// handleStream（流式）——同上
```

### 2.3b `/api/chat/stream` 路由分发

在 `api/chat.js` 的 handler 开头按 pathname 分发：

```js
const url = new URL(req.url);
const pathname = url.pathname;

if (pathname.endsWith('/tts')) return handleTTS(req);
if (pathname.endsWith('/stream')) return handleStream(req);
// 默认: 非流式（Phase 2 行为）
```

### 2.3c 流式处理（handleStream）

```js
async function handleStream(req) {
  const body = await req.json();
  const proc = await processAudio(body);
  if (proc.error) return json(proc.status, { error: proc.error });
  const { frame, text, history, model } = proc.data;

  // LLM 流式转发
  const apiKey = process.env.LLM_API_KEY;
  const baseUrl = process.env.LLM_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';

  const streamResp = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: buildMessages(frame, text, history),
      max_tokens: 300, temperature: 0.7, stream: true,
    }),
  });

  return new Response(streamResp.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
```

### 2.4 前端改动

```js
// sendToAI 改为 EventSource 或 fetch + ReadableStream
const resp = await fetch('/api/chat/stream', { ... });
const reader = resp.body.getReader();
const decoder = new TextDecoder();

// 在当前轮 AI 气泡中逐字追加
let aiBubble = appendBubble('assistant', '');
let fullText = '';

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  
  const chunk = decoder.decode(value);
  // 解析 SSE: "data: {...}\n\n"
  for (const line of chunk.split('\n')) {
    if (line.startsWith('data: ')) {
      const data = JSON.parse(line.slice(6));
      const delta = data.choices?.[0]?.delta?.content || '';
      fullText += delta;
      updateBubbleText(aiBubble, fullText);  // 更新 DOM
    }
  }
}

// 流结束后调 TTS
if (fullText) {
  const ttsResult = await fetch('/api/tts', { method: 'POST', body: JSON.stringify({ text: fullText }) });
  const ttsData = await ttsResult.json();
  playAudio(ttsData.audio);
  addToHistory('assistant', fullText);
}
```

### 2.5 新增 `/api/tts` 路由

流式场景下 TTS 不能在同一请求中完成（文字逐步生成）。在 `api/chat.js` 内新增 `handleTTS`：

```js
async function handleTTS(req) {
  const { text } = await req.json();
  if (!text) return json(400, { audio: null, error: '缺少 text' });
  const ttsResult = await synthesizeSpeech(text);
  return json(200, { audio: ttsResult.audio });
}
```

> 在 `api/chat.js` 同一文件内实现（非独立文件）。与 ASR/LLM Provider 共享 `baiduOAuth()` 缓存和 `synthesizeSpeech()`，无需重复 fetch Token。

### 2.6 降级策略

如果流式失败（网络、解析错误），回落非流式 `/api/chat`：

```js
try {
  const fullText = await streamChat(audioBase64, frame);
  // 流式成功 → 调 /api/tts 获取语音
  const ttsResult = await fetch('/api/tts', { method: 'POST', body: JSON.stringify({ text: fullText }) });
  const ttsData = await ttsResult.json();
  playAudio(ttsData.audio);
} catch (err) {
  console.error('[stream] 降级非流式:', err.message);
  // 降级: 非流式 /api/chat → 响应自带 audio 字段
  const data = await normalChat(audioBase64, frame);
  showReply(data.text);
  playAudio(data.audio);  // 非流式响应自带的 audio
}
```

> 流式路径：`/api/chat/stream` 返回文字流 → 结束后调 `/api/tts` 拿语音。
> 降级路径：`/api/chat` 非流式 → 响应同时带 `text` 和 `audio`。

---

## 3. F2: 设置面板

### 3.1 设计

折叠在页面底部，点击齿轮图标展开：

```
┌─────────────────┐
│  摄像头画面      │
│  消息列表        │
│  🎤 按住说话    │
├─────────────────┤
│ ⚙️ 设置    ▲    │  ← 点击展开/收起
├─────────────────┤
│ 模型: [qwen-vl-plus ▼]  │
│ TTS:  [开启 ○ 关闭]     │
│ 帧质量: [60% ───○──]    │
└─────────────────┘
```

### 3.2 控制项

| 设置 | 选项 | 默认 | 实现 |
|------|------|------|------|
| 模型 | `qwen-vl-plus` / `qwen-vl-max` | `qwen-vl-plus` | 前端请求带 `model` 字段，后端优先用 `body.model \|\| env.LLM_MODEL` |
| TTS | 开关 | 开 | 前端跳过 TTS 调用和 speaking 状态 |
| 帧质量 | 40% / 60% / 80% | 60% | 传给 `canvas.toDataURL('image/jpeg', quality)` |

### 3.3 后端配合

模型设置不是纯前端——需要后端接收 `model` 参数覆盖环境变量。

在 handler 和 `handleStream` 中：
```js
const model = body.model || process.env.LLM_MODEL || 'qwen-vl-plus';
```

在已有 `/api/chat` 非流式 handler 中同样加这一行。

### 3.4 实现

- 面板默认折叠，不影响主交互区域
- `settings.js` 作为设置单例访问点——其他模块通过它读写，不直接碰 `localStorage`：

```js
// js/settings.js
export const settings = {
  get model() { return localStorage.getItem('model') || 'qwen-vl-plus'; },
  set model(v) { localStorage.setItem('model', v); },
  get ttsEnabled() { return localStorage.getItem('tts') !== 'false'; },
  set ttsEnabled(v) { localStorage.setItem('tts', String(v)); },
  get frameQuality() { return parseFloat(localStorage.getItem('quality') || '0.6'); },
  set frameQuality(v) { localStorage.setItem('quality', String(v)); },
};
```

- `app.js` 通过 `settings.model` 取值发给 API，`settings.frameQuality` 传给 canvas

---

## 4. F3: 前端模块拆分

不改行为，只改结构。当前 `index.html` 329 行混在一起。

### 4.1 拆分方案

```
index.html          (~80行)  — HTML 骨架 + <script type="module">
js/
  audio-converter.js  — 已有
  chat-api.js        (~60行)  — 统一 API 调用：streamChat() + normalChat()，调用方只拿 {text, audio}
  app.js             (~100行) — 状态管理、事件绑定、init()
  ui.js              (~90行)  — renderMessages、appendBubble、showErrorBubble、lightbox
  settings.js        (~30行)  — 设置单例 + 设置面板 UI
```

### 4.2 `chat-api.js`：统一流式/非流式调用

```js
// js/chat-api.js
import { settings } from './settings.js';

export async function chatStream(audioBase64, frame, history) {
  const resp = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio: audioBase64, frame, history, model: settings.model }),
  });

  // 从 SSE 流收集完整文字
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of decoder.decode(value).split('\n')) {
      if (line.startsWith('data: ')) {
        const data = JSON.parse(line.slice(6));
        fullText += data.choices?.[0]?.delta?.content || '';
      }
    }
  }

  // 流结束 → 调 TTS
  let audio = null;
  if (settings.ttsEnabled && fullText) {
    const ttsResp = await fetch('/api/tts', { method: 'POST', body: JSON.stringify({ text: fullText }) });
    const ttsData = await ttsResp.json();
    audio = ttsData.audio;
  }

  return { text: fullText, audio };
}

export async function chatNormal(audioBase64, frame, history) {
  const resp = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio: audioBase64, frame, history, model: settings.model }),
  });
  return resp.json();  // { text, audio, error }
}
```

`app.js` 调用方只需要：
```js
async function sendToAI(audioBase64, frame) {
  try {
    const { text, audio } = await chatStream(audioBase64, frame, buildApiHistory());
    showReply(text);
    playAudio(audio);
  } catch {
    // 降级
    const { text, audio } = await chatNormal(audioBase64, frame, buildApiHistory());
    showReply(text);
    playAudio(audio);
  }
}
```

### 4.3 拆分原则

- 每个模块 `export` 需要的函数
- `app.js` 导入 `ui.js`、`chat-api.js`、`settings.js`、`audio-converter.js`
- 不改任何函数签名和行为（除 `sendToAI` 简化）
- 只改 `index.html` 的 `<script>` 块

---

## 5. API 契约

### POST /api/chat（不变）
Phase 1/2 的非流式接口保持不变。

### POST /api/chat/stream（新增）

```
Request: 同 /api/chat
Response: text/event-stream (SSE)
  data: {"choices":[{"delta":{"content":"你"}}]}
  data: {"choices":[{"delta":{"content":"好"}}]}
  data: [DONE]
```

### POST /api/tts（新增）

```
Request:  { "text": "AI 回复文字" }
Response: { "audio": "base64 mp3..." | null }
```

---

## 6. 风险控制

| 风险 | 措施 |
|------|------|
| 流式实现引入 bug | 保留 `/api/chat` 非流式作降级 |
| `/api/tts` 独立端点 | 和 `chat.js` 共享 `synthesizeSpeech()` 和 Token 缓存 |
| 模块拆分破坏功能 | 每拆一个模块验证完整链路 |
| 设置面板影响性能 | 纯 DOM 操作，零网络请求 |
| 时间不够 | 按 P0→P1→P2 顺序，随时可停 |

---

## 7. 验收标准

### 流式输出
- [ ] 用户说话后 AI 回复逐字显示
- [ ] 流式失败时自动降级非流式
- [ ] TTS 在文字全部生成后播放
- [ ] 打断逻辑在流式期间正常工作

### 设置面板
- [ ] 设置面板可折叠，默认收起
- [ ] 模型切换下一轮生效
- [ ] TTS 关闭后只显示文字
- [ ] 设置持久化到 localStorage

### 模块拆分
- [ ] index.html 的 `<script>` 块缩减到 <50 行
- [ ] 所有 Phase 1+2 功能行为不变

---

> **给 AI agent**：
> 按 F1（流式）→ F2（设置）→ F3（拆分）顺序实现。
> 每完成一步自检。F1 的 `/api/chat` 原端点不能动——新增 `/api/chat/stream` 和 `/api/tts` 两个端点。
> 如果流式遇到不可逾越的技术障碍，跳过去做 F2。
