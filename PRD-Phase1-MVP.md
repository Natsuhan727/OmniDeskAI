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
用户按住按钮 → MediaRecorder 录音 + Canvas 抓帧
    → 松手 → POST /api/chat (multipart: 音频 Blob + 画面 base64)
    → 后端: 上传音频到云存储 → 调 ASR 服务转文字 → 调多模态 LLM 看图+文字
    → 返回文字回复 → 页面展示
```

**硬约束**：
- 不做 TTS 语音播报
- 不做 VAD 自动检测（用户手动控制录音起止）
- 不做多轮对话历史
- 不做流式输出
- 不做移动端适配
- 只做桌面 Chrome 浏览器

---

## 2. 技术栈（精确版本）

| 层 | 技术 | 版本 | 用途 |
|---|------|------|------|
| 前端 | Vite + Vanilla JS | Vite 5.x | 开发服务器 + 打包 |
| 样式 | Tailwind CSS CDN | 3.x | UI（CDN 引入，不装 npm 包） |
| 录音 | MediaRecorder API | 浏览器内置 | 录制音频（audio/webm） |
| 抓帧 | Canvas API | 浏览器内置 | 从 video 抓 JPEG 帧 |
| 云存储 | S3 兼容对象存储 | — | 存放音频文件，生成访问 URL |
| ASR | 云端 ASR 服务 | — | 语音转文字（REST API） |
| LLM | 多模态 LLM（OpenAI 兼容 API） | — | 视觉理解 + 文本生成 |
| 后端 | Vercel Edge Function | — | ASR + LLM 编排（隐藏 API Key） |
| 部署 | Vercel | — | 前端 + Function 一体部署 |

**为什么用后端 ASR 而不是浏览器 Web Speech API**：
Chrome 的 SpeechRecognition 将音频发送到 Google 服务器做识别，在部分网络环境下不可用。后端 ASR 通过云服务商提供的中文语音识别 API，可用性更高，中文识别更准，且不依赖特定浏览器。

**为什么不用 React**：
Phase 1 只有一个按钮 + 一个视频标签 + 一个回复区。Vanilla JS 更轻。

**为什么不用 LLM SDK**：
Vercel Edge Function 运行在 V8 isolate，没有 Node.js 标准库。直接用 `fetch()` 调 REST API。

---

## 3. 文件结构

```
project-root/
├── index.html              # 唯一的前端页面（HTML + CSS + JS）
├── api/
│   └── chat.js             # Vercel Edge Function（ASR + LLM 编排）
├── package.json            # Vite 依赖
├── vite.config.js          # Vite 配置
├── vercel.json             # Vercel 部署配置
├── .gitignore
└── README.md
```

> **7 个文件。没有 `src/`。前端单文件。API Key 全部通过 Vercel 环境变量注入，不落地到代码。**

---

## 4. 构建顺序（严格按此顺序执行）

### Step 1: 项目初始化

```bash
npm init -y
npm install vite --save-dev
```

---

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

**验证**：`npm run dev` → 打开 `http://localhost:3000` → 页面正常加载。

---

### Step 3: 创建 `vite.config.js`

```js
import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 3000 },
  build: { outDir: 'dist' },
});
```

---

### Step 4: 创建 `.gitignore`

```
node_modules
dist
```

---

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

#### 6.1 页面布局（桌面端，居中单列）

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
- Tailwind CSS 通过 CDN 引入：`<script src="https://cdn.tailwindcss.com">`

#### 6.2 核心逻辑（伪代码，agent 翻译为实际 JS）

```
全局变量:
  stream: MediaStream | null
  isProcessing: boolean = false
  mediaRecorder: MediaRecorder | null
  audioChunks: Blob[] = []

页面加载:
  1. 检测 getUserMedia 支持 → 不支持则显示"请使用 Chrome"
  2. 请求摄像头 + 麦克风:
     stream = await navigator.mediaDevices.getUserMedia({
       video: { width: 640, height: 480 },
       audio: true
     })
     失败 → 显示"需要摄像头和麦克风权限"
  3. video.srcObject = stream
     video 标签属性: autoplay playsinline muted
     （muted 必须加，否则 Chrome 可能阻止音频流）
  4. 绑定按钮事件

按钮事件:
  mousedown (和 touchstart):
    if isProcessing → 忽略
    isProcessing = true
    audioChunks = []
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data) }
    mediaRecorder.start()
    按钮文字 → "🔴 录音中...松开发送"

  mouseup (和 touchend, mouseleave):
    if !mediaRecorder || mediaRecorder.state === 'inactive' → 忽略
    mediaRecorder.stop()
    按钮文字 → "⏳ AI 思考中..."
    
    mediaRecorder.onstop = async () => {
      const audioBlob = new Blob(audioChunks, { type: 'audio/webm' })
      
      // 检查是否有效录音（< 0.5 秒视为无效）
      if (audioBlob.size < 1000) {
        显示"未检测到语音，请重试"
        resetToIdle()
        return
      }
      
      // 抓帧
      ctx.drawImage(video, 0, 0, 640, 480)
      const frame = canvas.toDataURL('image/jpeg', 0.6)
      
      // 发送
      await sendToAI(audioBlob, frame)
    }

sendToAI(audioBlob, frame):
  构造 FormData:
    formData.append('audio', audioBlob, 'recording.webm')
    formData.append('frame', frame)
  
  POST /api/chat
  （不设 Content-Type，浏览器自动设 multipart/form-data + boundary）
  
  成功（200）→ 显示回复 → resetToIdle()
  失败 → 显示红色错误（3秒消失） → resetToIdle()

resetToIdle():
  isProcessing = false
  按钮文字 → "🎤 按住说话"
```

#### 6.3 按钮状态文字对照表

| 状态 | 按钮文字 | 样式 |
|------|---------|------|
| 就绪 | `🎤 按住说话` | 蓝色 |
| 录音中 | `🔴 录音中...松开发送` | 红色 |
| 等待回复 | `⏳ AI 思考中...` | 灰色，禁用点击 |

#### 6.4 关键细节（agent 必须遵守）

- `isProcessing` 锁：录音中或等待回复时为 `true`，忽略所有 `mousedown`
- `MediaRecorder` 每次用完丢弃，下次 `mousedown` 重新 `new`
- `<video>` 标签必须加 `muted` 属性
- 错误文字红色，3 秒后自动消失
- **不要引入任何额外的 npm 依赖**
- **不要在后端做任何音频格式转换**：`audio/webm` 直接上传到云存储，ASR 服务应支持 webm 或由云存储自动处理

---

### Step 7: 创建 `api/chat.js` — Vercel Edge Function

#### 7.1 后端处理流程

```
1. 接收请求（multipart/form-data）:
   - audio: WebM 音频 Blob
   - frame: base64 JPEG 字符串

2. 参数校验:
   - audio 非空且是 Blob
   - frame 非空且以 data:image/ 开头

3. 上传音频到云存储:
   - 用 S3 兼容 API 上传 audio Blob
   - 获取可公开访问的文件 URL

4. 调用 ASR 服务:
   - POST ASR API，传入音频文件的 URL
   - 获取识别文本 text

5. 调用多模态 LLM:
   - 构造 OpenAI 兼容请求，model 从环境变量读取
   - messages: [system prompt, user(frame + text)]
   - 获取回复

6. 返回 { text: "回复内容", error: null }
```

#### 7.2 完整代码规格

```js
// api/chat.js
// Vercel Edge Function — ASR + 多模态 LLM 编排

export const config = { runtime: 'edge' };

export default async function handler(req) {
  // ── CORS 预检 ──
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

  // ── 解析 multipart/form-data ──
  let formData;
  try {
    formData = await req.formData();
  } catch {
    return json(400, { text: null, error: '请求格式错误，需要 multipart/form-data' });
  }

  const audio = formData.get('audio');
  const frame = formData.get('frame');

  // ── 参数校验 ──
  if (!audio || !(audio instanceof Blob) || audio.size === 0) {
    return json(400, { text: null, error: '缺少 audio 参数' });
  }
  if (audio.size > 5_000_000) {
    return json(400, { text: null, error: '音频过大（上限 5MB）' });
  }
  if (!frame || typeof frame !== 'string' || !frame.startsWith('data:image/')) {
    return json(400, { text: null, error: '缺少 frame 参数或格式不正确' });
  }
  if (frame.length > 200_000) {
    return json(400, { text: null, error: '图片过大，请降低分辨率' });
  }

  try {
    // ── Step 1: 上传音频到云存储 ──
    const audioUrl = await uploadToStorage(audio);

    // ── Step 2: 调用 ASR 服务 ──
    const text = await speechToText(audioUrl);

    if (!text || text.trim().length === 0) {
      return json(200, { text: null, error: '未识别到语音内容，请重试' });
    }

    // ── Step 3: 调用多模态 LLM ──
    const reply = await chatWithVision(frame, text);

    return json(200, { text: reply, error: null });

  } catch (err) {
    return json(500, { text: null, error: `服务处理失败: ${err.message}` });
  }
}

// ── 上传音频到云存储（S3 兼容 API） ──
async function uploadToStorage(audioBlob) {
  const endpoint = process.env.STORAGE_ENDPOINT;
  const bucket = process.env.STORAGE_BUCKET;
  const accessKey = process.env.STORAGE_ACCESS_KEY;
  const secretKey = process.env.STORAGE_SECRET_KEY;
  const region = process.env.STORAGE_REGION || 'auto';

  if (!endpoint || !bucket || !accessKey || !secretKey) {
    throw new Error('云存储未配置');
  }

  const fileName = `audio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.webm`;

  // 构造 S3 兼容的 PUT 请求
  const url = `${endpoint}/${bucket}/${fileName}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  const resp = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'audio/webm',
      'Authorization': signRequest('PUT', `/${bucket}/${fileName}`, accessKey, secretKey, region),
    },
    body: audioBlob,
    signal: controller.signal,
  });
  clearTimeout(timeout);

  if (!resp.ok) {
    throw new Error(`云存储上传失败 (${resp.status})`);
  }

  // 返回可访问的 URL（供 ASR 服务使用）
  return `${endpoint}/${bucket}/${fileName}`;
}

// ── 调用 ASR 服务 ──
async function speechToText(audioUrl) {
  const asrEndpoint = process.env.ASR_API_ENDPOINT;
  const asrKey = process.env.ASR_API_KEY;

  if (!asrEndpoint || !asrKey) {
    throw new Error('ASR 服务未配置');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  const resp = await fetch(asrEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${asrKey}`,
    },
    body: JSON.stringify({ audio_url: audioUrl }),
    signal: controller.signal,
  });
  clearTimeout(timeout);

  if (!resp.ok) {
    throw new Error(`ASR 服务返回错误 (${resp.status})`);
  }

  const data = await resp.json();
  // 兼容多种 ASR 响应格式
  return data.text || data.result || data.data?.text || '';
}

// ── 调用多模态 LLM（OpenAI 兼容 API） ──
async function chatWithVision(frame, text) {
  const apiKey = process.env.LLM_API_KEY;
  const baseUrl = process.env.LLM_BASE_URL;
  const model = process.env.LLM_MODEL || 'gpt-4o';

  if (!apiKey || !baseUrl) {
    throw new Error('LLM 服务未配置');
  }

  const body = {
    model,
    messages: [
      {
        role: 'system',
        content: [
          '你是视觉对话助手。用户给你一张摄像头拍摄的画面和一个问题。',
          '请结合画面内容简洁回答。回复控制在150字以内，口语化，中文。',
          '不要编造画面中不存在的内容。不确定时诚实说明。',
          '不需要说"我看到了..."这类开场白，直接回答问题。',
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
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: controller.signal,
  });
  clearTimeout(timeout);

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`LLM 返回错误 (${resp.status}): ${errText.slice(0, 200)}`);
  }

  const data = await resp.json();
  const reply = data.choices?.[0]?.message?.content;

  if (!reply) {
    throw new Error('LLM 返回为空');
  }

  return reply;
}

// ── S3 兼容签名（简化版 V2） ──
// 注意：部分云存储支持通过 HTTPS + Token 鉴权，不需要复杂的 V4 签名
// 具体签名方式按 STORAGE_AUTH_MODE 环境变量切换
async function signRequest(method, path, accessKey, secretKey, region) {
  // 简化实现：对支持 Token 鉴权的存储，直接返回 Token
  // 对需要 V4 签名的，可用 Web Crypto API 构造
  // Phase 1 简化：假设存储服务使用 Bearer Token 鉴权
  return `Bearer ${secretKey}`;
}

// ── 辅助函数 ──
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

#### 7.3 环境变量清单

| 变量 | 用途 | 示例值 |
|------|------|--------|
| `STORAGE_ENDPOINT` | 云存储 endpoint | `https://s3.example.com` |
| `STORAGE_BUCKET` | 存储桶名称 | `my-bucket` |
| `STORAGE_ACCESS_KEY` | 存储 Access Key | `AKIDxxxx` |
| `STORAGE_SECRET_KEY` | 存储 Secret Key | `xxxx` |
| `ASR_API_ENDPOINT` | ASR 服务 URL | `https://asr.example.com/v1/recognize` |
| `ASR_API_KEY` | ASR 服务 Key | `xxxx` |
| `LLM_API_KEY` | LLM API Key | `sk-xxxx` |
| `LLM_BASE_URL` | LLM API Base URL | `https://api.example.com/v1` |
| `LLM_MODEL` | 模型名称 | `qwen-vl-plus` |

> 环境变量通过 `vercel env add` 设置，不在代码中硬编码。

#### 7.4 关键约束

- **必须用原生 `fetch()`**：Edge Function 不支持 Node.js SDK
- **每个响应都带 CORS 头**：`Access-Control-Allow-Origin: *`
- **ASR 超时 15s，LLM 超时 20s**：合计不超过 Edge Function 30s 硬限制
- **错误信息脱敏**：不泄露 API 内部信息
- **frame 大小上限 200KB**，**audio 大小上限 5MB**

---

## 5. 完整 API 契约

### POST /api/chat

```
Request:
  Method: POST
  Content-Type: multipart/form-data
  Body:
    audio: <WebM 音频 Blob>     // MediaRecorder 录制，最长 15 秒
    frame: <string>             // "data:image/jpeg;base64,..." 640×480 Q=60

Response 200:
  Content-Type: application/json; charset=utf-8
  Access-Control-Allow-Origin: *
  {
    "text": "这是一个 Python 冒泡排序的实现...",
    "error": null
  }

Response 200 (识别为空):
  {
    "text": null,
    "error": "未识别到语音内容，请重试"
  }

Response 400:
  {
    "text": null,
    "error": "缺少 audio 参数"
  }

Response 500:
  {
    "text": null,
    "error": "服务处理失败: ASR 服务返回错误 (500)"
  }
```

---

## 6. 状态流转

```
页面加载
  │
  ├── 不支持 getUserMedia → 显示"请使用 Chrome 浏览器"
  ├── 摄像头/麦克风权限拒绝 → 显示"需要摄像头和麦克风权限"
  │
  └── 权限通过 → [IDLE] 按钮="🎤 按住说话"
        │
        └── 用户 mousedown (isProcessing === false)
              │
              ├── new MediaRecorder → start()
              ├── isProcessing = true
              ├── 按钮="🔴 录音中...松开发送"
              │
              └── 用户 mouseup
                    │
                    ├── mediaRecorder.stop()
                    ├── onstop: 检查 audioBlob.size < 1000 → "未检测到语音" → IDLE
                    │
                    └── onstop: 有效录音 →
                          │
                          [SENDING] 按钮="⏳ AI 思考中..."
                          │
                          ├── 抓帧 + POST multipart/form-data
                          │
                          ├── 200 + text 非空 → 显示回复 → [IDLE]
                          ├── 200 + text 为空 → "未识别到语音" → [IDLE]
                          └── 4xx/5xx → 红色错误（3s消失）→ [IDLE]
```

---

## 7. 验收标准

### Step 1-5 验收
- [ ] `npm run dev` 正常启动
- [ ] `localhost:3000` 能打开页面

### Step 6 验收（前端）
- [ ] 页面打开后，浏览器弹出摄像头/麦克风权限请求
- [ ] 授权后，`<video>` 显示摄像头实时画面
- [ ] 不支持 getUserMedia 的浏览器 → 显示降级提示
- [ ] 按住按钮 → 按钮文字变为 "🔴 录音中...松开发送"
- [ ] 松开按钮 → 按钮文字变为 "⏳ AI 思考中..."
- [ ] 控制台打印出 `frame` 前 50 字符
- [ ] 控制台打印出 `audioBlob.size`
- [ ] 快速连续点击两次 → 第二次被忽略（`isProcessing` 锁）
- [ ] 不说话的短录音（<0.5s）→ 显示"未检测到语音"

### Step 7 验收（后端）
- [ ] POST `multipart/form-data` 含有效 audio + frame → 返回 200，`text` 非空
- [ ] 缺少 audio → 返回 400
- [ ] 缺少 frame → 返回 400
- [ ] audio 为空 Blob → 返回 400
- [ ] frame 格式错误 → 返回 400
- [ ] 未配置环境变量 → 返回 500（错误信息不泄露 Key）
- [ ] CORS 头存在：`Access-Control-Allow-Origin: *`

### 全链路验收
- [ ] Chrome 打开页面
- [ ] 对着摄像头展示一个物体（如一本书、水杯）
- [ ] 按住按钮说"这是什么？"
- [ ] 松开后 3-8 秒内显示 AI 回复
- [ ] AI 回复准确描述了画面中的物体
- [ ] 不说话按住然后松开 → 显示"未检测到语音"
- [ ] 按钮恢复为 "🎤 按住说话"，可以再次使用

---

## 8. 部署命令

```bash
# 1. 安装 Vercel CLI
npm i -g vercel

# 2. 登录
vercel login

# 3. 设置环境变量
vercel env add STORAGE_ENDPOINT
vercel env add STORAGE_BUCKET
vercel env add STORAGE_ACCESS_KEY
vercel env add STORAGE_SECRET_KEY
vercel env add ASR_API_ENDPOINT
vercel env add ASR_API_KEY
vercel env add LLM_API_KEY
vercel env add LLM_BASE_URL
vercel env add LLM_MODEL

# 4. 部署
vercel --prod

# 5. 本地调试
vercel dev
```

---

## 9. 重要约束（AI agent 必须遵守）

1. **不要引入额外 npm 依赖**：Vite 是唯一的 devDependency。
2. **Tailwind 用 CDN**：`<script src="https://cdn.tailwindcss.com">`，不装 PostCSS。
3. **前端用 MediaRecorder 录音，POST multipart/form-data**。后端收 audio Blob + frame 字符串。
4. **后端做 ASR（不是前端）**。音频上传云存储 → ASR API → 拿到文字。
5. **后端用原生 `fetch()`**，不用任何 SDK。Edge Function 不支持 Node.js。
6. **所有响应带 CORS 头**：`Access-Control-Allow-Origin: *`。
7. **API Key 全部通过 Vercel 环境变量注入**。不写在代码、`.env` 文件、或 git 中。
8. **`<video>` 标签必须加 `muted`**。
9. **加 `isProcessing` 锁**，防止重复提交。
10. **MediaRecorder 实例每次用完就丢**，下次重新 `new`。
11. **不做 Phase 2 的任何东西**：TTS、VAD、多轮对话、打断、流式输出、移动端适配。

---

## 10. 已知风险与处理

| 风险 | 前端处理 | 后端处理 |
|------|---------|---------|
| 摄像头/麦克风权限拒绝 | 显示引导文字 | — |
| 用户不说话（短录音） | `audioBlob.size < 1000` → 不发送 | — |
| ASR 识别为空 | — | 返回 `{ text: null, error: "未识别到语音" }` |
| 云存储上传失败 | — | 返回 500，错误信息脱敏 |
| ASR 超时（>15s） | — | AbortController 15s 超时 |
| LLM 超时（>20s） | 显示"AI 响应超时，请重试" | AbortController 20s 超时 |
| LLM 返回异常格式 | — | try-catch + 校验 `choices[0].message.content` |
| 图片 base64 过大 | 640×480 Q=60 确保 <50KB | 拒绝 >200KB |
| Edge Function 冷启动 | 首次 ~1-2s，可接受 | — |
| 连续快速点击 | `isProcessing` 锁忽略 | — |

---

> **给 AI agent 的总指令**：
> 按 Step 1 → Step 7 顺序构建。每完成一步，用验收标准自检。
> 全链路跑通后，部署到 Vercel。
> **不要做任何本文档未要求的事情。**
