---
title: PRD - Phase 2
project: AI 视觉对话助手
phase: 2
status: ready-to-build
created: 2026-06-13
target: AI agent
requires: Phase 1 已跑通，Provider 架构已合入
---

# PRD: AI 视觉对话助手 — Phase 2

> Phase 1：摄像头 + 语音 → AI 文字回复。Provider 骨架已建立（`transcribeAudio` / `chatWithVision`）。
> Phase 2：让 AI 说出口，让对话有记忆。

---

## 1. Phase 2 新增功能

| # | 功能 | 优先级 | 依赖 |
|---|------|:--:|------|
| F1 | **TTS 语音播报** | P0 | Provider 架构已有 |
| F2 | **多轮对话 + 视觉记忆** | P0 | 前端 history + 后端透传 |
| F3 | **打断** | P0 | TTS 存在后一行代码 |
| F4 | **消息列表 UI** | P1 | 多轮对话后自然延伸 |
| F5 | **错误降级** | P2 | 不阻塞 |

---

## 2. 架构现状（Phase 1 已建立）

```
api/chat.js:
  handler(req)
    ├── transcribeAudio(audio)     → ASR_PROVIDER 路由
    │     └── asrBaidu()           ← 默认实现
    └── chatWithVision(frame,text) → LLM_PROVIDER 路由
          └── llmDashScope()       ← 默认实现

环境变量:
  ASR_PROVIDER=baidu | ASR_API_KEY | ASR_SECRET_KEY
  LLM_PROVIDER=dashscope | LLM_API_KEY | LLM_BASE_URL | LLM_MODEL
```

Phase 2 在现有骨架上增量添加，不改变已有 Provider 接口。

---

## 3. 记忆模型

> Phase 1 每轮独立。Phase 2 让 AI 知道"刚才聊了什么、刚才看到了什么"。

### 3.1 两类记忆

| 记忆 | 保留量 | 传 LLM 的方式 |
|------|:--:|------|
| **对话历史** | 最近 3 轮（6 条消息） | `history[]` 字段 |
| **视觉记忆** | 最近 1 轮的画面帧 | 附在上一轮 user 消息中 |

### 3.2 工作原理

```
Turn 1: 画面(水杯) → "这是什么？" → AI: "不锈钢保温杯"
Turn 2: 画面(键盘) → "它多少钱？"

LLM 收到的 messages:
  [system prompt]
  [user: 水杯.jpg + "这是什么？"]     ← 视觉记忆
  [assistant: "不锈钢保温杯"]
  [user: 键盘.jpg + "它多少钱？"]     ← 当前
```

LLM 看到历史帧(水杯) + 当前帧(键盘) + 当前问题("它多少钱？") → 理解"它"=水杯。

### 3.3 设计决策

- **视觉记忆只要 1 帧**：连续两轮用户大概率看同一物体。更早的帧已移出镜头。每多一帧多 200-400 token。
- **对话历史只要 3 轮**：超过 3 轮的旧话题自然淡出。控制 token 成本。
- **ASR 不需要单独记忆**：识别结果以文字形式进入对话历史。

---

## 4. F1+F3: TTS 语音播报 + 打断

### 4.1 方案

后端 `/api/chat` 在 LLM 返回后调用 TTS Provider，将 base64 MP3 随文字一起返回。前端 `<audio>` 播放。

TTS 作为新 Provider 加入现有注册表模式，默认实现为云端 TTS 服务（中文女声，MP3 格式）。

### 4.2 Provider 接口

```
TTS Provider:
  输入: text: string
  输出: { audio: string | null, error: string | null }
        audio 为 base64 MP3，失败时为 null（静默降级）
```

### 4.3 后端编排

在 handler 中 LLM 返回后插入一步：

```js
// 现有: ASR → LLM
const asrResult = await transcribeAudio(audio);
const llmResult = await chatWithVision(frame, asrResult.text);

// 新增: TTS
const ttsResult = await synthesizeSpeech(llmResult.text);
// ttsResult.audio 为 base64 或 null

return json(200, {
  text: llmResult.text,
  audio: ttsResult.audio,   // null 时前端跳过播放
  error: null,
});
```

### 4.4 Provider 注册表扩展

```js
const TTS_PROVIDER = process.env.TTS_PROVIDER || 'baidu';

const ttsProviders = {
  baidu: async (text) => {
	    // 复用已有的 baiduOAuth() → cachedBaiduToken（module-level，与 ASR 共享缓存）
    // POST https://tsn.baidu.com/text2audio
    // 参数: tok(OAuth), tex(text), cuid, ctp=1, lan=zh,
    //       spd=5, pit=5, vol=5, per=0(女声), aue=3(MP3)
    //
    // ⚠️ 百度 TTS 成功返回 Content-Type: audio/mp3
    //    失败返回 Content-Type: application/json
    //    必须检查 content-type，不能只看 HTTP 状态码
    //
    // 返回 { audio: base64 | null, error: null | "错误描述" }
  },
};

async function synthesizeSpeech(text) {
  const fn = ttsProviders[TTS_PROVIDER];
  if (!fn) return { audio: null, error: `未知 TTS 供应商: ${TTS_PROVIDER}` };
  try {
    return await fn(text);
  } catch (err) {
    return { audio: null, error: err.message };
  }
}
```

### 4.5 前端播放

```js
function playAudio(audioBase64) {
  if (!audioBase64) return;   // TTS 降级，静默
  setButtonState('speaking');
  currentAudio = new Audio('data:audio/mp3;base64,' + audioBase64);
  currentAudio.onended = () => { currentAudio = null; resetToIdle(); };
  currentAudio.onerror = () => { currentAudio = null; resetToIdle(); };
  currentAudio.play();
}
```

### 4.6 打断

```js
function onButtonDown(e) {
  if (currentAudio && !currentAudio.paused) {
    currentAudio.pause();
    currentAudio = null;
    resetToIdle();
    return;  // 打断后不进入录音，等用户再次按住
  }
  // 正常录音流程...
}
```

> 打断后不直接开始录音——用户松开后再按住才是新一轮。一次操作只做一件事。

### 4.7 按钮状态

| 状态 | 按钮文字 |
|------|---------|
| idle | `🎤 按住说话` |
| recording | `🔴 录音中...松开发送` |
| sending | `⏳ AI 思考中...` |
| speaking | `🔊 AI 回复中...` |

---

## 5. F2+F4: 多轮对话 + 消息列表

### 5.1 数据结构

```js
// 前端维护
let conversationHistory = [];
// 最多 6 条（3 轮 Q&A）

// user 消息:
{ role: 'user', text: '...', frame: 'data:image/jpeg;base64,...' }

// assistant 消息:
{ role: 'assistant', text: '...' }
```

### 5.2 视觉记忆规则

- 最近 1 轮 user 消息带 `frame`
- 更早轮次 `frame: null`
- assistant 永远不带 frame
- **仅在请求成功（`data.text` 非空且 `data.error` 为 null）后**才将本轮 Q&A 加入 history。失败轮次不污染记忆

### 5.3 API 请求新增 `history` 字段（可选）

```
POST /api/chat
{
  audio: "...",
  frame: "...",
  history: [                                 // 新增，可选。省略或 [] 时等同 Phase 1
    { role: 'user', text: '这是什么？', frame: '水杯.jpg' },
    { role: 'assistant', text: '不锈钢保温杯。' },
    { role: 'user', text: '它多少钱？', frame: null },
    { role: 'assistant', text: '50-200元。' },
  ]
}
```

> `history` 可选。后端需兼容：未传 → `[]`，非数组 → 返回 400。

### 5.4 后端 LLM 消息构造

```js
const messages = [{ role: 'system', content: '...' }];

for (const h of history) {
  if (h.role === 'user' && h.frame) {
    messages.push({
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: h.frame } },
        { type: 'text', text: h.text },
      ],
    });
  } else {
    messages.push({ role: h.role, content: h.text });
  }
}

// 当前轮（总是带帧）
messages.push({
  role: 'user',
  content: [
    { type: 'image_url', image_url: { url: frame } },
    { type: 'text', text: currentText },
  ],
});
```

### 5.5 消息列表 UI

```
┌─────────────────┐
│  摄像头画面      │
├─────────────────┤
│  👤 📷 这是什么？ │  ← 用户气泡 + 缩略帧
│  🤖 不锈钢保温杯 │  ← AI 气泡
│  👤 📷 它多少钱？ │
│  🤖 50-200元    │
├─────────────────┤
│  🔊 AI 回复中... │
└─────────────────┘
```

- 用户气泡靠右，AI 靠左
- 缩略帧：`<img>` + CSS `width:64px;height:48px`（复用原帧，无需重新生成）
- 可滚动，自动滚到最新
- 超出 3 轮自动丢弃

---

## 6. API 契约

### POST /api/chat

```
Request:
{
  "audio": "base64 PCM Int16...",
  "frame": "data:image/jpeg;base64,...",
  "history": [                            // 可选字段，省略或 [] 时后退到 Phase 1 模式
    { "role": "user", "text": "...", "frame": "data:image/jpeg;..." | null },
    { "role": "assistant", "text": "..." }
  ]
}

Response 200 (成功):
{
  "text": "AI 的回复文字",
  "audio": "//uQxAAAA...base64 mp3...",   // TTS 成功
  "error": null
}

Response 200 (TTS 降级):
{
  "text": "AI 的回复文字",
  "audio": null,                           // TTS 失败，静默降级
  "error": null
}

Response 200 (ASR 为空):
{
  "text": null,
  "audio": null,
  "error": "未识别到语音内容，请重试"
}
```

---

## 7. F5: 错误降级

| 环节 | 策略 |
|------|------|
| ASR 出错 | 返回 error，前端显示 |
| ASR 为空 | 返回 error: "未识别到语音" |
| LLM 超时 | Provider 内部重试 1 次，再失败报错 |
| LLM 其他错误 | 报错，不重试 |
| TTS 出错 | **静默降级**：`audio` 为 null，文字照常返回，前端只显示不播放 |

### TTS 降级实现

```js
// synthesizeSpeech()（§4.4 定义）内部已包含 try-catch:
try {
  return await fn(text);     // fn = ttsProviders[TTS_PROVIDER]
} catch (err) {
  console.error('[tts] 降级:', err.message);
  return { audio: null, error: err.message };
}

// handler 中直接调用 synthesizeSpeech():
const ttsResult = await synthesizeSpeech(reply);
return json(200, { text: reply, audio: ttsResult.audio, error: null });
// ttsResult.error 只打日志，不抛给用户
```

---

## 8. 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `ASR_PROVIDER` | `baidu` | 已有 |
| `ASR_API_KEY` | （必填） | 已有 |
| `ASR_SECRET_KEY` | （必填） | 已有 |
| `LLM_PROVIDER` | `dashscope` | 已有 |
| `LLM_API_KEY` | （必填） | 已有 |
| `LLM_BASE_URL` | `https://dashscope.aliyuncs.com/compatible-mode/v1` | 已有 |
| `LLM_MODEL` | `qwen-vl-plus` | 已有 |
| `TTS_PROVIDER` | `baidu` | **新增** |

> TTS Provider 默认复用 ASR 的 OAuth Token，不需要额外 Key。

---

## 9. 成本控制策略

| # | 策略 | Phase |
|---|------|:--:|
| C-1 | 帧压缩 640×480 Q=60 | 1 |
| C-2 | 按需发帧（只发当前帧 + 视觉记忆帧） | 1 |
| C-3 | 短音频过滤（<1000 bytes 不发送） | 1 |
| C-4 | OAuth Token 缓存（跨请求复用） | 1 |
| C-5 | Provider 架构：切换厂商零代码改动 | 1 |
| C-6 | 对话历史仅 3 轮，视觉记忆仅 1 帧 | 2 |
| C-7 | TTS 失败静默降级 | 2 |
| C-8 | LLM 仅超时重试（非业务错误不重试） | 2 |

---

## 10. 文件结构

```
├── index.html              # 前端（TTS 播放、打断、消息列表、history 管理）
├── api/
│   └── chat.js             # 后端（Provider 注册表 + ASR/LLM/TTS 编排）
├── package.json / vite.config.js / vercel.json / .gitignore / README.md
```

> 不变。所有新增功能在现有文件中增量实现。

---

## 11. 验收标准

### TTS + 打断
- [ ] AI 回复显示后自动播放语音，声音自然
- [ ] 播放期间按钮 "🔊 AI 回复中..."
- [ ] 播放期间按住按钮 → 停止播放（打断后不开始录音）
- [ ] TTS 失败时文字照常显示，无报错

### 多轮对话 + 视觉记忆
- [ ] AI 能理解上一轮的指代（"它"/"这个"）
- [ ] 消息列表显示对话气泡 + 缩略帧
- [ ] 最近 1 轮带帧，更早不带
- [ ] 失败轮次不进入历史

### Provider
- [ ] TTS Provider 注册表模式与 ASR/LLM 一致
- [ ] `TTS_PROVIDER` 环境变量切换生效

### 错误降级
- [ ] LLM 超时自动重试
- [ ] TTS 失败不影响文字返回

---

> **给 AI agent**：
> 代码在 Provider 骨架上增量添加。实现顺序：TTS Provider → 多轮对话 + 消息列表 → 错误降级。
