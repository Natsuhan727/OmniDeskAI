---
title: PRD - Phase 1 MVP
project: AI 视觉对话助手
phase: 1
status: ready-to-build
created: 2026-06-12
updated: 2026-06-13
target: AI agent
---

# PRD: AI 视觉对话助手 — Phase 1 MVP

> **本文档写给 AI agent 执行。指令精确、无歧义、可验证。**

---

## 1. 产品定义

**一句话**：用户打开网页，看到摄像头画面，按住按钮说话，AI 结合画面用文字回复。

**核心链路**：
```
用户按住按钮 → AudioContext 采集 PCM → WebSocket → 云端实时 ASR 识别
    → 识别完成 → Canvas 抓帧 → POST /api/chat { frame, text }
    → 后端调多模态 LLM 看图+文字 → 返回文字回复 → 页面展示
```

**硬约束**：
- 不做 TTS 语音播报
- 不做多轮对话历史
- 不做流式输出（LLM 回复一次性返回）
- 不做移动端适配
- 只做桌面 Chrome 浏览器

---

## 2. 技术栈

| 层 | 技术 | 用途 |
|---|------|------|
| 前端 | Vite + Vanilla JS | 开发服务器 + 打包 |
| 样式 | Tailwind CSS CDN | UI（不装 npm 包） |
| 音频采集 | Web Audio API (AudioContext) | PCM 16kHz 重采样 |
| 实时 ASR | 云端实时语音识别 WebSocket API | 流式识别，服务端 VAD 自动断句 |
| 抓帧 | Canvas API | video → JPEG base64 |
| 多模态 LLM | 云端多模态 LLM（OpenAI 兼容 API） | 视觉理解 + 文本生成 |
| 后端 | Vercel Edge Function | LLM API 代理（隐藏 Key） |
| 部署 | Vercel | 前端 + Function 一体部署 |

**为什么 ASR 走 WebSocket 实时识别而非 REST 异步**：
- 实时流式识别延迟低，边说边识别，体验接近对话
- 服务端 VAD 自动检测说话结束，前端无需手动判断静音
- 和 LLM 共用一个平台同一套鉴权，零额外依赖
- 音频数据流式发送，不需要云存储中转

**为什么后端只做 LLM 代理**：
ASR 已在浏览器端通过 WebSocket 完成。后端只负责拿着识别文字 + 画面帧调 LLM。职责单一，代码量最小。

---

## 3. 文件结构

```
project-root/
├── index.html              # 前端页面（HTML + CSS + JS）
├── api/
│   └── chat.js             # Vercel Edge Function（LLM 代理）
├── package.json
├── vite.config.js
├── vercel.json
├── .gitignore
└── README.md
```

> **7 个文件。API Key 通过 Vercel 环境变量注入，不落地代码。**

---

## 4. 构建顺序

### Step 1: 项目初始化

```bash
npm init -y
npm install vite --save-dev
```

### Step 2: 创建 `package.json`

```json
{
  "name": "ai-visual-chat",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "devDependencies": {
    "vite": "^5.4.0"
  }
}
```

### Step 3: 创建 `vite.config.js`

```js
import { defineConfig } from 'vite';
export default defineConfig({
  server: { port: 3000 },
  build: { outDir: 'dist' },
});
```

### Step 4: 创建 `.gitignore`

```
node_modules
dist
```

### Step 5: 创建 `vercel.json`

```json
{
  "functions": {
    "api/chat.js": {
      "memory": 512,
      "maxDuration": 30
    }
  }
}
```

---

### Step 6: 创建 `index.html` — 前端页面

#### 6.1 页面布局

```
┌─────────────────────────────────┐
│       🤖 AI 视觉对话助手          │
├─────────────────────────────────┤
│    ┌─────────────────────┐      │
│    │   摄像头实时画面     │      │
│    │   <video> 640×480   │      │
│    └─────────────────────┘      │
│    ┌─────────────────────┐      │
│    │  AI 回复文字显示区   │      │
│    └─────────────────────┘      │
│    ┌─────────────────────┐      │
│    │   🎤 按住说话        │      │
│    └─────────────────────┘      │
└─────────────────────────────────┘
```

- 隐藏 `<canvas width="640" height="480">` 用于抓帧
- Tailwind CSS CDN：`<script src="https://cdn.tailwindcss.com">`

#### 6.2 核心逻辑（伪代码，agent 翻译为实际 JS）

```
全局变量:
  stream: MediaStream | null
  isProcessing: boolean = false
  audioContext: AudioContext | null
  processor: ScriptProcessorNode | null
  websocket: WebSocket | null
  finalText: string | null = null
  wsReady: boolean = false
  silenceTimer: number | null = null

常量:
  ASR_WS_URL = 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=qwen-asr-realtime'
  API_KEY = 'sk-xxx'   // DASHSCOPE_API_KEY（hackathon demo 放前端可接受）

页面加载:
  1. 检测 getUserMedia → 不支持则"请使用 Chrome"
  2. 请求摄像头 + 麦克风:
     stream = await navigator.mediaDevices.getUserMedia({
       video: { width: 640, height: 480 },
       audio: true
     })
     失败 → "需要摄像头和麦克风权限"
  3. video.srcObject = stream, 标签: autoplay playsinline muted
  4. 绑定按钮事件

mousedown (和 touchstart):
  e.preventDefault()
  if isProcessing → 忽略
  isProcessing = true, finalText = null
  
  // AudioContext — 必须 16000Hz
  audioContext = new AudioContext({ sampleRate: 16000 })
  const source = audioContext.createMediaStreamSource(stream)
  processor = audioContext.createScriptProcessor(4096, 1, 1)
  
  // WebSocket 连接 ASR
  websocket = new WebSocket(ASR_WS_URL)
  websocket.binaryType = 'arraybuffer'
  
  websocket.onopen = () => {
    // 配置服务端 VAD
    websocket.send(JSON.stringify({
      type: 'session.update',
      session: { turn_detection: { type: 'server_vad' } }
    }))
    wsReady = true
  }
  
  websocket.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.type === 'transcription.completed' && msg.transcription?.text) {
      finalText = msg.transcription.text
    }
    if (msg.type === 'session.finished') {
      finish()
    }
  }
  
  websocket.onerror = () => {
    cleanupAudio()
    showError('语音识别连接失败')
    resetToIdle()
  }
  
  // 音频处理：Float32 → Int16 PCM → WebSocket 发送
  processor.onaudioprocess = (e) => {
    if (!wsReady) return
    const input = e.inputBuffer.getChannelData(0)
    const pcm = new Int16Array(input.length)
    for (let i = 0; i < input.length; i++) {
      pcm[i] = Math.max(-32768, Math.min(32767, input[i] * 32768))
    }
    websocket.send(pcm.buffer)
  }
  
  source.connect(processor)
  // ScriptProcessor 必须 connect 到 destination 才会触发 onaudioprocess
  // 但直接连会导致回声 → 通过 GainNode 静音
  const gainNode = audioContext.createGain()
  gainNode.gain.value = 0
  processor.connect(gainNode)
  gainNode.connect(audioContext.destination)
  
  setButtonState('recording')
  
  // 15 秒超时保护
  silenceTimer = setTimeout(() => {
    cleanupAudio()
    showError('识别超时，请重试')
    resetToIdle()
  }, 15000)

mouseup (和 touchend, mouseleave):
  e.preventDefault()
  // 通知服务端提交音频缓冲区
  if (websocket && websocket.readyState === WebSocket.OPEN) {
    websocket.send(JSON.stringify({ type: 'input_audio_buffer.commit' }))
  }
  setButtonState('sending')

finish():
  clearTimeout(silenceTimer)
  cleanupAudio()
  
  if (finalText && finalText.trim()) {
    console.log('识别文字:', finalText)
    sendToAI(finalText)
  } else {
    showError('未检测到语音，请重试')
    resetToIdle()
  }

cleanupAudio():
  if (processor) { processor.disconnect(); processor = null }
  if (audioContext) { audioContext.close(); audioContext = null }
  if (websocket) { websocket.close(); websocket = null }
  wsReady = false

sendToAI(text):
  ctx.drawImage(video, 0, 0, 640, 480)
  const frame = canvas.toDataURL('image/jpeg', 0.6)
  console.log('frame 前50字符:', frame.slice(0, 50))
  
  try {
    const resp = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ frame, text }),
    })
    const data = await resp.json()
    if (resp.ok && data.text) {
      showReply(data.text)
    } else {
      showError(data.error || '请求失败')
    }
  } catch (err) {
    showError('网络错误，请检查连接')
  }
  resetToIdle()

resetToIdle():
  isProcessing = false
  setButtonState('idle')
```

#### 6.3 按钮状态

| 状态 | 按钮文字 | 样式 |
|------|---------|------|
| idle | `🎤 按住说话` | 蓝色 |
| recording | `🔴 录音中...松开发送` | 红色 |
| sending | `⏳ AI 思考中...` | 灰色，禁用点击 |

#### 6.4 关键细节

- `isProcessing` 锁：录音或等待回复时为 `true`，忽略所有点击
- `AudioContext` 采样率**精确 16000Hz**，ScriptProcessor bufferSize 4096
- `<video>` 必须 `muted`，否则 Chrome 阻止 AudioContext
- AudioContext 在第一次用户手势（mousedown）时才创建——满足浏览器自动播放策略
- WebSocket + AudioContext 每次 mousedown 重建，用完即弃
- 错误红色文字，3 秒后自动消失
- **不引入任何额外 npm 依赖**
- ASR WebSocket URL 和 API Key 出现在前端代码（hackathon demo 可接受）

---

### Step 7: 创建 `api/chat.js` — Vercel Edge Function

#### 7.1 职责

单一职责：接收 `{ frame, text }` → 调多模态 LLM → 返回回复。不做 ASR，不做云存储。

#### 7.2 完整代码

```js
// api/chat.js
// Vercel Edge Function — 多模态 LLM 代理

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (req.method !== 'POST') {
    return json(405, { text: null, error: '仅支持 POST' });
  }

  let body;
  try { body = await req.json(); } catch {
    return json(400, { text: null, error: '请求格式错误，需要 JSON' });
  }

  const { frame, text } = body;

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return json(400, { text: null, error: '缺少 text 参数' });
  }
  if (!frame || typeof frame !== 'string' || !frame.startsWith('data:image/')) {
    return json(400, { text: null, error: '缺少 frame 参数或格式不正确' });
  }
  if (frame.length > 200_000) {
    return json(400, { text: null, error: '图片过大' });
  }

  const apiKey = process.env.LLM_API_KEY;
  const baseUrl = process.env.LLM_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  const model = process.env.LLM_MODEL || 'qwen-vl-plus';

  if (!apiKey) {
    return json(500, { text: null, error: '服务未配置 API Key' });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);

    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: [
              '你是视觉对话助手。用户给你一张摄像头画面和一个问题。',
              '结合画面简洁回答。150字以内，口语化，中文。',
              '不编造不存在的内容。不确定时诚实说明。',
              '不需要"我看到了..."开场白，直接回答。',
            ].join(' '),
          },
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: frame } },
              { type: 'text', text: text },
            ],
          },
        ],
        max_tokens: 300,
        temperature: 0.7,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      const errText = await resp.text();
      return json(500, { text: null, error: `LLM 错误 (${resp.status})` });
    }

    const data = await resp.json();
    const reply = data.choices?.[0]?.message?.content;

    if (!reply) {
      return json(500, { text: null, error: 'LLM 返回为空' });
    }

    return json(200, { text: reply, error: null });

  } catch (err) {
    if (err.name === 'AbortError') {
      return json(500, { text: null, error: 'AI 响应超时，请重试' });
    }
    return json(500, { text: null, error: '服务调用失败' });
  }
}

function json(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
```

#### 7.3 环境变量

| 变量 | 用途 | 默认值 |
|------|------|--------|
| `LLM_API_KEY` | LLM API Key | **（必填）** |
| `LLM_BASE_URL` | LLM 兼容端点 | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `LLM_MODEL` | 模型名 | `qwen-vl-plus` |

> **只需 1 个必填环境变量。**

---

## 5. API 契约

### POST /api/chat

```
Request:
  Method: POST
  Content-Type: application/json
  Body: {
    "frame": "data:image/jpeg;base64,...",   // 640×480 Q=60
    "text": "这段代码是什么意思？"             // ASR 识别文字
  }

Response 200:
  { "text": "这是一个 Python 冒泡排序...", "error": null }

Response 400:
  { "text": null, "error": "缺少 text 参数" }

Response 500:
  { "text": null, "error": "AI 响应超时，请重试" }
```

---

## 6. 状态流转

```
页面加载
  │
  ├── 不支持 getUserMedia → "请使用 Chrome"
  ├── 权限拒绝 → "需要摄像头和麦克风权限"
  │
  └── 权限通过 → [IDLE] "🎤 按住说话"
        │
        └── mousedown (isProcessing === false)
              │
              ├── new AudioContext(16000) + WebSocket
              ├── isProcessing = true
              ├── "🔴 录音中...松开发送"
              │
              ├── 流式发送 PCM → 服务端 VAD 断句
              ├── mouseup → 发 commit
              │
              └── session.finished
                    ├── finalText 空 → "未检测到语音" → [IDLE]
                    └── finalText 有效 →
                          [SENDING] "⏳ AI 思考中..."
                          ├── 抓帧 + POST /api/chat
                          ├── 200 → 显示回复 → [IDLE]
                          └── 4xx/5xx → 红色错误(3s) → [IDLE]

超时: 15s 无 session.finished → cleanup + "识别超时" → [IDLE]
WebSocket error → cleanup + "语音识别连接失败" → [IDLE]
```

---

## 7. 验收标准

### Step 1-5
- [ ] `npm run dev` 正常，`localhost:3000` 可访问

### Step 6（前端）
- [ ] 摄像头权限弹窗 → 授权后画面显示
- [ ] 不支持 getUserMedia → 降级提示
- [ ] 按住按钮 → "🔴 录音中...松开发送"
- [ ] WebSocket 连接成功（控制台无 error）
- [ ] 说话 → 控制台打印识别文字
- [ ] 松开 → "⏳ AI 思考中..." → 显示 AI 回复
- [ ] 不说话的短按 → "未检测到语音"
- [ ] 快速双击 → 第二次被忽略
- [ ] AudioContext 采样率 16000Hz

### Step 7（后端）
- [ ] POST `{ frame, text }` → 200 + text 非空
- [ ] 缺参数 → 400
- [ ] 未设 Key → 500
- [ ] CORS: `Access-Control-Allow-Origin: *`

### 全链路
- [ ] Chrome 打开 → 展示物体 → 按住问"这是什么？"
- [ ] 3-6 秒内显示准确回复
- [ ] 不说话 → "未检测到语音"
- [ ] 按钮恢复可用

---

## 8. 部署

```bash
npm i -g vercel && vercel login
vercel env add LLM_API_KEY      # DASHSCOPE_API_KEY
vercel env add LLM_BASE_URL     # https://dashscope.aliyuncs.com/compatible-mode/v1
vercel env add LLM_MODEL        # qwen-vl-plus
vercel --prod
```

---

## 9. 约束（agent 必须遵守）

1. **不引入额外 npm 依赖**：仅 Vite
2. **Tailwind CDN**：不装 PostCSS
3. **ASR 浏览器端 WebSocket**：不传音频到后端。后端只收 `{ frame, text }`
4. **后端 `fetch()`**：不用 SDK
5. **AudioContext 16000Hz**：ScriptProcessor 重采样
6. **`<video>` 必须 `muted`**
7. **`isProcessing` 锁**
8. **每次 mousedown 重建 WebSocket + AudioContext**
9. **不做 Phase 2**：TTS、多轮、打断、流式、移动端

---

## 10. 风险与处理

| 风险 | 处理 |
|------|------|
| 摄像头/麦克风权限拒绝 | 显示引导文字 |
| AudioContext 采样率不匹配 | 硬编码 16000Hz |
| WebSocket 连接失败 | onerror → "语音识别连接失败" |
| ASR 识别为空 | session.finished 无 text → "未检测到语音" |
| ASR 超时（15s） | timer cleanup + "识别超时" |
| LLM 超时（25s） | AbortController |
| 连续快速点击 | isProcessing 锁 |
| Edge Function 冷启动 | 首次 ~1-2s |

---

> **给 AI agent 的总指令**：
> 按 Step 1 → Step 7 构建。每步自检验收。全链路跑通后部署。
> **不做本文档未要求的事。**
