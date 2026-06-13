---
title: 实时监测功能 — 架构审查与完整实现方案
project: AI 视觉对话助手
phase: 6
status: analysis
created: 2026-06-14
updated: 2026-06-14
platform: 无限制，专注功能完整性
---

# 实时监测 — 架构审查与完整实现方案

> **目标**：从"按住说话 → 松手听回复"升级为**实时视频通话式 AI 助手**——AI 持续观看画面，用户可以随时说话，AI 主动或按需回应。

---

# 一、产品形态

```
┌─────────────────────────────────────────────────┐
│              🤖 AI 视觉对话助手                   │
│                                                 │
│  ┌───────────────────────────────────────────┐  │
│  │                                           │  │
│  │           Camera (实时)                   │  │
│  │                                           │  │
│  │  🔴 监测中 · 每 2s 分析 · 上次: 刚刚      │  │
│  │                                           │  │
│  └───────────────────────────────────────────┘  │
│                                                 │
│  📋 消息：                                      │
│  ───────────────────────────────────────────    │
│  🤖 画面中有一个人，正在和镜头说话              │
│  🤖 画面变亮了，可能开了灯                      │
│  🤖 现在出现了一本书，《深入理解计算机系统》     │
│  🎤 你：这本书怎么样？                          │
│  🤖 这是计算机科学经典教材，CMU 的…             │
│                                                 │
│  ┌─────────────────────────────────────────┐    │
│  │          [🎤 按住说话]                    │    │
│  │  或: [🟢 实时对话模式]  (免持, VAD)      │    │
│  └─────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
```

**三种交互模式共存**：

| 模式 | 方式 | 适用场景 |
|------|------|----------|
| **🔴 主动监测** | AI 自动分析画面变化，主动描述 | 持续观察场景 |
| **🟢 实时对话** | VAD 检测语音，自动收音+回答 | 免持对话 |
| **🎤 按住说话** | 原有模式 | 精确控制，嘈杂环境 |

---

# 二、架构设计

## 2.1 总体架构

```
┌─ BROWSER ────────────────────────────────────────┐
│                                                   │
│  音视频层 (现有)                                   │
│  ├── getUserMedia → video/audio stream            │
│  ├── Canvas → 帧截图 (JPEG base64)                │
│  └── MediaRecorder → webm 音频                    │
│                                                   │
│  监测引擎 (新增)                                   │
│  ├── js/monitor.js                                │
│  │   ├── FrameScheduler: 帧捕获定时器              │
│  │   ├── ChangeDetector: 像素变化检测              │
│  │   ├── VAD: 语音活动检测 (可选)                 │
│  │   └── MonitorState: 状态机                     │
│  │                                                │
│  └── js/chat-api.js (扩展)                        │
│      └── monitorStream(): SSE → 实时监测流         │
│                                                   │
│  对话引擎 (现有 + 扩展)                            │
│  ├── js/app.js → sendToAI() 不变                 │
│  └── new: monitor.sendFrame() → SSE → 播报       │
│                                                   │
├───────────────────────────────────────────────────┤
│                  WebSocket / SSE                   │
├───────────────────────────────────────────────────┤
│  BACKEND                                          │
│                                                   │
│  api/chat.js (保留，不变)                          │
│  api/monitor.js (新增)                            │
│  ├── POST /api/monitor  — 单帧分析 (轮询降级)     │
│  └── 或: WS /monitor    — 持续双向 (真正实时)    │
│                                                   │
│  共用: Provider 注册表 + buildMessages()          │
└───────────────────────────────────────────────────┘
```

## 2.2 通信通道选择

| 通道 | 优点 | 缺点 | 适合 |
|------|------|------|:--:|
| **SSE / HTTP Poll** | 复用现有基础设施，零新依赖 | 单向，30s 超时，帧率受限 | MVP |
| **WebSocket** | 双向，低延迟，持续连接 | 需要 WS 服务端，不能用 Serverless | 真正实时 |
| **WebRTC DataChannel** | P2P 超低延迟 | 需要信令服务器，复杂度高 | 音视频通话 |

**推荐路径**：
- **MVP**：SSE（现有 `api/chat/stream` 同模式），1-3s 帧间隔
- **完整版**：WebSocket（Node.js 后端），< 500ms 帧间隔，双向自由通信

两种方案共用同一个 `monitor.js` 前端模块，仅通道实现不同。

---

# 三、前端模块设计

## 3.1 `js/monitor.js` — 监测引擎

```js
// js/monitor.js
// 实时视觉监测引擎 — 帧调度、变化检测、VAD、状态机

export function createMonitor({
  captureFrame,          // () → base64 帧
  getHistory,            // () → 对话历史
  onObservation,         // (text, audio?) → 处理 AI 主动观察
  onSpeaking,            // (isSpeaking) → UI 状态更新
  onError,               // (err) → 错误处理
}) {

  // ── 状态 ──
  const state = {
    mode: 'idle',        // idle | observe | converse
    lastFrame: null,     // 上一帧 base64
    lastSentAt: 0,       // 上次发送时间
    timer: null,
    frameCount: 0,
    suppressedCount: 0,  // 被变化检测跳过的帧数
  };

  // ── 帧调度器 ──
  const scheduler = {
    interval: 2000,      // 基础间隔 ms
    adaptive: true,      // 是否自适应
    minInterval: 1000,
    maxInterval: 5000,

    start() {
      state.timer = setInterval(() => tick(), this.interval);
      state.mode = 'observe';
    },

    stop() {
      clearInterval(state.timer);
      state.timer = null;
      state.mode = 'idle';
    },

    async tick() {
      const frame = captureFrame();
      if (!frame) return;

      // 变化检测
      if (changeDetector.isSimilar(frame, state.lastFrame)) {
        state.suppressedCount++;
        return; // 跳过，不发请求
      }

      state.lastFrame = frame;
      state.lastSentAt = Date.now();
      state.frameCount++;

      // 发送帧到 AI
      await sendFrame(frame, { action: 'observe' });

      // 自适应间隔
      if (this.adaptive) {
        this.adjustInterval();
      }
    },

    adjustInterval() {
      // 画面变化频繁 → 缩短间隔
      // 画面长期不变 → 拉长间隔（省 token）
      const recentRate = state.frameCount / Math.max(state.suppressedCount, 1);
      if (recentRate > 0.5) this.interval = Math.max(this.minInterval, this.interval - 200);
      else this.interval = Math.min(this.maxInterval, this.interval + 200);
    },
  };

  // ── 变化检测器 ──
  const changeDetector = {
    threshold: 0.03,     // 3% 像素差异阈值

    isSimilar(frame1, frame2) {
      if (!frame1 || !frame2) return false; // 第一帧总是发送

      // 轻量比较：在小 canvas 上抽样像素
      // 不做全像素比较——在 32x24 缩略图上比较即可
      const thumb1 = thumbnailDiff(frame1);
      const thumb2 = thumbnailDiff(frame2);
      if (!thumb1 || !thumb2) return false;

      let diff = 0;
      for (let i = 0; i < thumb1.length; i += 4) {
        diff += Math.abs(thumb1[i] - thumb2[i]) +      // R
                Math.abs(thumb1[i+1] - thumb2[i+1]) +   // G
                Math.abs(thumb1[i+2] - thumb2[i+2]);    // B
      }
      const totalPixels = thumb1.length / 4;
      const avgDiff = diff / (totalPixels * 3 * 255);
      return avgDiff < this.threshold;
    },
  };

  // ── VAD (简易语音活动检测) ──
  const vad = {
    enabled: false,
    threshold: 0.02,    // 音量阈值
    silenceDuration: 1500, // 静音多久认为说话结束 (ms)
    analyser: null,
    silenceTimer: null,

    init(stream) {
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 256;
      source.connect(this.analyser);
    },

    isSpeaking() {
      if (!this.analyser) return false;
      const data = new Uint8Array(this.analyser.frequencyBinCount);
      this.analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b) / data.length;
      return avg / 255 > this.threshold;
    },

    onSpeechEnd(callback) {
      // 持续检测 silenceDuration 毫秒静音后触发回调
      // callback 中执行 ASR → LLM → TTS
    },
  };

  // ── 发送帧到 AI ──
  async function sendFrame(frame, { action }) {
    state.mode = 'sending';
    onSpeaking(true);

    try {
      // 通过 SSE 流式接收 AI 观察结果
      const result = await monitorStream({
        frame,
        recentFrames: [state.lastFrame].filter(Boolean), // 可选：最近帧
        history: getHistory(),
        personalContext: personalContext.get(),
        action,
      });

      if (result.observation && result.observation !== 'no_change') {
        onObservation(result.observation, result.audio);
      }
    } catch (err) {
      onError(err);
    } finally {
      state.mode = 'observe';
      onSpeaking(false);
    }
  }

  return {
    start: scheduler.start.bind(scheduler),
    stop: scheduler.stop.bind(scheduler),
    pause: () => { scheduler.stop(); },
    resume: () => { scheduler.start(); },
    setInterval: (ms) => { scheduler.interval = ms; },
    getState: () => state,
    enableVAD: () => { vad.enabled = true; },
    disableVAD: () => { vad.enabled = false; },
  };
}
```

## 3.2 `js/chat-api.js` 扩展 — `monitorStream()`

```js
// js/chat-api.js — 新增

export async function monitorStream({ frame, recentFrames, history, personalContext, action }) {
  const resp = await fetch('/api/monitor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      frame,
      recentFrames: recentFrames || [],
      history,
      personalContext,
      action,
      llm_provider: settings.llmProvider,
      llm_api_key: settings.llmApiKey,
      llm_base_url: settings.llmBaseUrl || undefined,
    }),
  });

  if (!resp.ok) throw new Error(`Monitor HTTP ${resp.status}`);

  // SSE 流式解析（复用现有 streamChat 的 buffer 逻辑）
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let observation = '';
  let audio = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const jsonStr = line.slice(6);
      if (jsonStr === '[DONE]') break;

      try {
        const data = JSON.parse(jsonStr);
        if (data.type === 'observation') {
          observation = (observation ? observation + data.text : data.text);
        } else if (data.type === 'audio') {
          audio = data.audio;
        }
      } catch (e) { /* skip */ }
    }
  }

  return { observation, audio };
}
```

---

# 四、后端设计

## 4.1 新端点：`POST /api/monitor`

```
请求:
{
  frame: "data:image/jpeg;base64,...",
  recentFrames: ["data:...", "data:..."],
  history: [{role, text, frame?, timestamp?}, ...],
  personalContext: "用户自定义文本",
  action: "observe",
  llm_api_key: "...", llm_provider: "...", llm_base_url: "..."
}

System Prompt:
  你是实时视觉监测助手。你每隔几秒收到一张用户摄像头的画面。
  你的任务是观察画面变化并简短描述。

  规则：
  - 如果画面与上次描述的基本相同 → 回复文本 "NO_CHANGE"
  - 如果有值得注意的新物体、人物、变化 → 简短描述（20字以内），口语化
  - 如果有潜在危险或需要提醒的事 → 用关心的语气提醒
  - 不需要"我看到了..."开场白，直接描述
  - 回复格式：先描述变化（如果有），然后可附加一句 contextual advice

SSE 响应:
  data: {"type":"observation","text":"画面中出现了一个红色水杯"}
  data: {"type":"observation","text":"，旁边有一本打开的书"}
  data: {"type":"audio","audio":"base64..."}
  data: [DONE]

  如果无变化:
  data: {"type":"observation","text":"NO_CHANGE"}
  data: [DONE]
```

## 4.2 端点实现（在 `api/chat.js` 路由中分发）

```js
// api/chat.js — 新增路由

if (pathname.endsWith('/monitor')) return handleMonitor(req);

async function handleMonitor(req) {
  let body;
  try { body = await req.json(); } catch {
    return json(400, { error: '请求格式错误' });
  }

  const { frame, recentFrames, history, personalContext, action } = body;

  if (!frame) return json(400, { error: '缺少 frame' });

  const llmCfg = {
    provider: body.llm_provider || 'dashscope',
    apiKey: body.llm_api_key,
    baseUrl: body.llm_base_url || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  };

  if (!llmCfg.apiKey) return json(500, { error: '未配置 LLM Key' });

  // 构建监测专用的 messages
  const messages = buildMonitorMessages(frame, recentFrames, history, personalContext, action);

  // SSE 流式返回
  const streamResp = await fetch(`${llmCfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${llmCfg.apiKey}`,
    },
    body: JSON.stringify({
      model: body.model || 'qwen-vl-plus',
      messages,
      max_tokens: 100,
      temperature: 0.3,
      stream: true,
    }),
    signal: AbortSignal.timeout(25_000),
  });

  if (!streamResp.ok) return json(streamResp.status, { error: `LLM 错误 (${streamResp.status})` });

  const encoder = new TextEncoder();

  const combined = new ReadableStream({
    async start(controller) {
      const reader = streamResp.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
      } finally {
        reader.releaseLock();
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      }
    },
  });

  return new Response(combined, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

// ── 监测消息构建 ──
function buildMonitorMessages(frame, recentFrames, history, personalContext, action) {
  const systemParts = [
    '你是实时视觉监测助手。用户开启了摄像头，你每隔几秒收到一张画面。',
    '观察画面变化并简短描述。20字以内，口语化，中文。',
    '如果画面无明显变化，只回复 "NO_CHANGE"（不要解释）。',
    '如果有新物体、人物或值得注意的变化，简短描述。',
    '不要编造不存在的内容。不需要"我看到了..."开场白。',
  ];

  if (personalContext) {
    systemParts.push(`[用户自定义上下文]\n${personalContext}`);
  }

  const messages = [{ role: 'system', content: systemParts.join(' ') }];

  // 注入最近的对话历史
  if (history?.length) {
    for (const h of history.slice(-6)) {
      if (h.role === 'user' && h.frame) {
        messages.push({
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: h.frame } },
            { type: 'text', text: h.text || '' },
          ],
        });
      } else {
        messages.push({ role: h.role, content: h.text || '' });
      }
    }
  }

  // 当前帧
  const currentContent = [{ type: 'image_url', image_url: { url: frame } }];

  // 如果 action 是 describe，加引导文字
  if (action === 'describe') {
    currentContent.push({ type: 'text', text: '详细描述画面中有什么。' });
  } else {
    currentContent.push({ type: 'text', text: '观察画面。如果与上次无明显变化，回复 NO_CHANGE。如果有变化，简短描述。' });
  }

  messages.push({ role: 'user', content: currentContent });
  return messages;
}
```

---

# 五、前端接入 `app.js`

```js
// js/app.js — 新增部分

import { createMonitor } from './monitor.js';
import { personalContext } from './personal-context.js';

let monitor = null;

// 在 init() 末尾
document.getElementById('monitorToggle').addEventListener('click', () => {
  if (monitor && monitor.getState().mode !== 'idle') {
    monitor.stop();
  } else {
    startMonitoring();
  }
});

function startMonitoring() {
  monitor = createMonitor({
    captureFrame() {
      ctx.drawImage(video, 0, 0, 640, 480);
      return canvas.toDataURL('image/jpeg', settings.frameQuality);
    },
    getHistory() {
      return buildApiHistory();
    },
    onObservation(text, audio) {
      if (text === 'NO_CHANGE') return; // 静默
      appendBubble('assistant', text);
      if (audio && settings.ttsEnabled) {
        playAudio(audio); // 复用现有 TTS 播放
      }
    },
    onSpeaking(isSpeaking) {
      // 更新 UI 状态指示器
    },
    onError(err) {
      console.error('[monitor]', err.message);
    },
  });

  monitor.start();
}

// 用户按住说话时暂停监测
function onButtonDown(e) {
  if (monitor && monitor.getState().mode === 'observe') {
    monitor.pause();
  }
  // ... 原有录音逻辑 ...
}

// 用户说完话恢复监测
// 在 sendToAI 的 finally 中：
if (monitor) monitor.resume();
```

---

# 六、实现计划

## MVP（~6h）

| # | 任务 | 内容 | 工作量 |
|---|------|------|:--:|
| 1 | `js/monitor.js` | 监测引擎：帧调度器 + 变化检测 + 状态机 | 2h |
| 2 | `api/chat.js` 扩展 | `/monitor` 路由 + `buildMonitorMessages()` | 1.5h |
| 3 | `js/chat-api.js` 扩展 | `monitorStream()` SSE 解析 | 0.5h |
| 4 | `app.js` 接入 | 监测启停 + 与现有问答的互动控制 | 1h |
| 5 | `index.html` | 监测模式开关 + 状态指示器 | 1h |

## 增强（Phase 6.1）

| # | 能力 | 工作量 |
|---|------|:--:|
| 6 | VAD 免持对话 | 2h |
| 7 | 自适应帧间隔 | 0.5h |
| 8 | WebSocket 后端（替换 SSE） | 3h |
| 9 | 画面历史回放（最近 N 帧） | 1h |
| 10 | 报警模式（"看到 X 提醒我"） | 2h |

---

# 七、对现有代码的影响

```
完全复用 (0 改动):
  storage-backend.js      ✅
  personal-context.js     ✅
  audio-converter.js      ✅
  ui.js                   ✅
  settings.js             ✅ (仅需加一个开关选项)

需扩展:
  api/chat.js             +80 行 (新路由 + buildMonitorMessages)
  js/chat-api.js          +40 行 (monitorStream)
  js/app.js               +30 行 (监测启停 + 互动控制)
  index.html              +20 行 (开关按钮)

新增:
  js/monitor.js           ~200 行 (完整监测引擎)
```

**总新增代码量**：~370 行。修改现有代码：~170 行。改动集中，不改核心逻辑。
