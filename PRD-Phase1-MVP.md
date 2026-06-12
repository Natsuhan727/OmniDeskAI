---
title: PRD - Phase 1 MVP
project: AI 视觉对话助手
phase: 1
status: ready-to-build
created: 2026-06-12
updated: 2026-06-12
target: AI agent
---

# PRD: AI 视觉对话助手 — Phase 1 MVP

> **本文档写给 AI agent 执行。指令精确、无歧义、可验证。**

---

## 1. 产品定义

**一句话**：用户打开网页，看到摄像头画面，按住按钮说话，AI 结合画面用文字回复。

**核心链路**：
```
用户按住按钮 → Web Speech 语音识别(前端) + Canvas 抓帧
    → 松手 → POST /api/chat { frame, text }
    → 后端调 GPT-4o(看图+文字) → 返回文字回复
    → 页面展示
```

**硬约束**：
- 不做 TTS 语音播报
- 不做 VAD 自动检测
- 不做多轮对话历史
- 不做流式输出
- 不做移动端适配
- 不做后端 ASR
- 只做桌面 Chrome 浏览器

---

## 2. 技术栈（精确版本）

| 层 | 技术 | 版本 | 用途 |
|---|------|------|------|
| 前端 | Vite + Vanilla JS | Vite 5.x | 开发服务器 + 打包 |
| 样式 | Tailwind CSS CDN | 3.x | UI（CDN 引入，不装 npm 包） |
| ASR | Web Speech API | 浏览器内置 | 语音识别（免费，前端完成） |
| LLM | OpenAI GPT-4o | — | 多模态理解（通过 REST API） |
| 后端 | Vercel Edge Function | — | 转发 LLM 请求（隐藏 API Key） |
| 部署 | Vercel | — | 前端 + Function 一体部署 |

**为什么 Web Speech API 而不是后端 ASR**：
浏览器自带，零配置，零成本，零延迟传输。不需要传输音频文件。先跑通。如果 Chrome 中文识别不准，Phase 2 再切后端 ASR。

**为什么不用 React**：
Phase 1 只有一个按钮 + 一个视频标签 + 一个回复区。Vanilla JS 更轻。Phase 2 需要复杂 UI 时再迁移。

**为什么不用 OpenAI SDK**：
Vercel Edge Function 运行在 V8 isolate，没有 Node.js 标准库。直接用 `fetch()` 调 OpenAI REST API，兼容性最好。

---

## 3. 文件结构

```
project-root/
├── index.html              # 唯一的前端页面（HTML + CSS + JS）
├── package.json            # Vite 依赖
├── vite.config.js          # Vite 配置
├── .gitignore
├── api/
│   └── chat.js             # Vercel Edge Function
└── vercel.json             # Vercel 部署配置
```

> **6 个文件。没有 `src/`，没有 `.env`（Key 通过 Vercel CLI 设置）。**

---

## 4. 构建顺序（严格按此顺序执行）

### Step 1: 项目初始化

```bash
mkdir ai-visual-chat && cd ai-visual-chat
npm init -y
npm install vite --save-dev
```

**验证**：`npx vite --version` 输出版本号。

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

**验证**：`npm run dev` → 打开 `http://localhost:3000` → 看到 Vite 默认页。

---

### Step 3: 创建 `vite.config.js`

```js
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
  },
  build: {
    outDir: 'dist',
  },
});
```

**验证**：`npm run dev` 正常启动。

---

### Step 4: 创建 `.gitignore`

```
node_modules
dist
```

> 没有 `.env` 文件。API Key 通过 `vercel env add` 设置到 Vercel 平台。本地开发用 `vercel dev`，它会自动拉取远程环境变量。

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

> API Key 不在这个文件里。部署后用 `vercel env add` 单独设置。

---

### Step 6: 创建 `index.html` — 前端页面

#### 6.1 整体结构

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AI 视觉对话助手</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-950 text-white min-h-screen">
  <!-- 页面内容 -->
</body>
</html>
```

#### 6.2 页面布局（桌面端，居中单列）

```
┌─────────────────────────────────┐
│       🤖 AI 视觉对话助手          │
├─────────────────────────────────┤
│                                 │
│    ┌─────────────────────┐      │
│    │                     │      │
│    │   摄像头实时画面     │      │
│    │   <video> 640×480   │      │
│    │                     │      │
│    └─────────────────────┘      │
│                                 │
│    ┌─────────────────────┐      │
│    │  AI 回复文字显示区   │      │
│    │  (初始为空)          │      │
│    └─────────────────────┘      │
│                                 │
│    ┌─────────────────────┐      │
│    │   🎤 按住说话        │      │
│    └─────────────────────┘      │
│                                 │
│    提示：请使用 Chrome 浏览器     │
└─────────────────────────────────┘
```

- 隐藏的 `<canvas width="640" height="480">` 用于抓帧
- Tailwind 用 CDN，不用 PostCSS 构建

#### 6.3 核心逻辑（伪代码 → agent 翻译为实际 JS）

```
全局变量:
  stream: MediaStream | null
  isProcessing: boolean = false   // 防重复点击锁
  recognition: SpeechRecognition | null

页面加载:
  1. 检测浏览器支持:
     if (!navigator.mediaDevices?.getUserMedia) → 显示"请使用 Chrome"
     if (!window.SpeechRecognition && !window.webkitSpeechRecognition) → 显示"您的浏览器不支持语音识别，请使用 Chrome"
  
  2. 请求摄像头 + 麦克风:
     stream = await navigator.mediaDevices.getUserMedia({
       video: { width: 640, height: 480, facingMode: "environment" },
       audio: true
     })
     失败 → 显示"需要摄像头和麦克风权限"
  
  3. video.srcObject = stream → 画面开始
  4. 初始化 Web Speech（不立即启动）
  5. 绑定按钮事件

按钮事件:
  mousedown (或 touchstart):
    if isProcessing → 忽略
    开始语音识别:
      recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)()
      recognition.lang = 'zh-CN'
      recognition.interimResults = false    // 不等中间结果，只要最终
      recognition.continuous = false        // 一次识别后就停
      recognition.maxAlternatives = 1
      recognition.start()
      按钮文字 → "🔴 录音中...松开发送"
  
  mouseup (或 touchend):
    if !recognition → 忽略
    按钮文字 → "⏳ AI 思考中..."
    isProcessing = true
    // Web Speech 会在 onresult 中返回文字
    // 如果用户没说话，onresult 可能不触发 → 需要超时处理

recognition.onresult:
  拿到文字 text = event.results[0][0].transcript
  如果 text 为空或纯空白 → 显示"未检测到语音，请重试" → 解锁按钮
  否则 → 抓帧 + 发送

recognition.onerror:
  显示错误信息 → 解锁按钮

recognition.onend:
  如果还没拿到结果（用户没说话） → 显示"未检测到语音" → 解锁按钮

抓帧:
  canvas.getContext('2d').drawImage(video, 0, 0, 640, 480)
  frame = canvas.toDataURL('image/jpeg', 0.6)  // JPEG Q=60

发送:
  POST /api/chat
  Headers: { 'Content-Type': 'application/json' }
  Body: JSON.stringify({ frame, text })
  
  成功 → 显示回复文字 → isProcessing = false → 按钮文字 → "🎤 按住说话"
  失败 → 显示红色错误（3 秒后消失） → isProcessing = false → 按钮文字 → "🎤 按住说话"

超时处理:
  如果 onresult 3 秒内没触发 → 视为用户没说话 → 解锁按钮
```

#### 6.4 按钮状态文字对照表

| 状态 | 按钮文字 | 按钮样式 |
|------|---------|---------|
| 就绪 | `🎤 按住说话` | 正常 |
| 录音中 | `🔴 录音中...松开发送` | 红色背景 |
| 等待回复 | `⏳ AI 思考中...` | 灰色，禁用点击 |
| 错误后恢复 | 自动回到 `🎤 按住说话` | 正常 |

#### 6.5 关键细节（agent 必须遵守）

- `isProcessing` 锁：录音中或等待回复时为 `true`，忽略所有 `mousedown`
- Web Speech 实例每次用完就丢弃，下次重新 `new`
- `recognition.start()` 必须在用户手势（mousedown）的回调里调用——Chrome 要求语音识别由用户手势触发
- 错误文字红色 (`text-red-400`)，3 秒后自动消失 (`setTimeout`)
- `<video>` 标签加 `autoplay playsinline muted`。`muted` 关键——不加 muted 则 Chrome 不允许多个 API 同时访问音频流
- **不要引入任何额外的 npm 依赖**

---

### Step 7: 创建 `api/chat.js` — Vercel Edge Function

#### 7.1 完整代码规格

```js
// api/chat.js
// Vercel Edge Function — 接收 frame + text，转发给 GPT-4o

export const config = {
  runtime: 'edge',
};

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

  // ── 只接受 POST ──
  if (req.method !== 'POST') {
    return json(405, { text: null, error: '仅支持 POST' });
  }

  // ── 解析请求 ──
  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { text: null, error: '请求格式错误，需要 JSON' });
  }

  const { frame, text } = body;

  // ── 参数校验 ──
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return json(400, { text: null, error: '缺少 text 参数' });
  }
  if (!frame || typeof frame !== 'string' || !frame.startsWith('data:image/')) {
    return json(400, { text: null, error: '缺少 frame 参数或格式不正确' });
  }
  // frame 大小限制：防止 base64 过大导致超时
  if (frame.length > 200_000) {
    return json(400, { text: null, error: '图片过大，请降低分辨率' });
  }

  // ── 构造 OpenAI 请求 ──
  const apiKey = process.env.OPENAI_API_KEY;
  const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';

  if (!apiKey) {
    return json(500, { text: null, error: '服务配置错误：未设置 API Key' });
  }

  const openaiBody = {
    model: 'gpt-4o',
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

  // ── 调用 OpenAI（原生 fetch，不用 SDK） ──
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000); // 25s 超时

    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(openaiBody),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      const errText = await resp.text();
      return json(500, { text: null, error: `AI 服务返回错误 (${resp.status}): ${errText.slice(0, 200)}` });
    }

    const data = await resp.json();
    const reply = data.choices?.[0]?.message?.content;

    if (!reply) {
      return json(500, { text: null, error: 'AI 返回为空' });
    }

    return json(200, { text: reply, error: null });

  } catch (err) {
    if (err.name === 'AbortError') {
      return json(500, { text: null, error: 'AI 响应超时（超过25秒），请重试' });
    }
    return json(500, { text: null, error: `AI 服务调用失败: ${err.message}` });
  }
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

#### 7.2 关键约束

- **必须用原生 `fetch()`**，不能用 `import OpenAI from 'openai'`。Edge Function 的 V8 isolate 不支持 Node.js SDK。
- **每个响应都带 CORS 头**：`Access-Control-Allow-Origin: *`
- **超时 25 秒**：用 `AbortController`。Edge Function 硬限制 30s，留 5s 余量。
- **错误信息脱敏**：`errText.slice(0, 200)`，避免技术细节泄漏
- **frame 大小上限 200KB**（base64 长度）：640×480 Q=60 的 JPEG 通常 15-30KB（base64 后约 20-40KB），设 200KB 足够且安全

---

## 5. 完整 API 契约

### POST /api/chat

```
Request:
  Method: POST
  Content-Type: application/json
  Body: {
    "frame": "data:image/jpeg;base64,/9j/4AAQ...",   // 640×480, Q=60 JPEG 的 base64
    "text": "这段代码是什么意思？"                     // Web Speech 识别出的文字
  }

Response 200:
  Content-Type: application/json; charset=utf-8
  Access-Control-Allow-Origin: *
  {
    "text": "这是一个 Python 冒泡排序的实现...",
    "error": null
  }

Response 400:
  {
    "text": null,
    "error": "缺少 text 参数"
  }

Response 405:
  {
    "text": null,
    "error": "仅支持 POST"
  }

Response 500:
  {
    "text": null,
    "error": "AI 响应超时（超过25秒），请重试"
  }
```

---

## 6. 状态流转（前端精确版）

```
页面加载
  │
  ├── 浏览器不支持 getUserMedia → 显示"请使用 Chrome 浏览器"
  │
  ├── 浏览器不支持 SpeechRecognition → 显示"您的浏览器不支持语音识别，请使用 Chrome"
  │
  ├── 摄像头/麦克风权限拒绝 → 显示"需要摄像头和麦克风权限，请在浏览器设置中开启"
  │
  └── 权限通过 → [IDLE] 按钮="🎤 按住说话"
        │
        └── 用户 mousedown (且 isProcessing === false)
              │
              ├── Web Speech 初始化 → recognition.start()
              ├── isProcessing = true
              ├── 按钮="🔴 录音中...松开发送"
              │
              └── 用户 mouseup → recognition.stop()
                    │
                    ├── onresult: 拿到 text ────────────┐
                    ├── onerror: 显示错误 → 回到 IDLE    │
                    └── onend(无结果): 显示"未检测到语音" │
                                                        │
                    ┌───────────────────────────────────┘
                    ▼
              [SENDING] 按钮="⏳ AI 思考中..."
                    │
                    ├── 抓帧 canvas.toDataURL('image/jpeg', 0.6)
                    ├── POST /api/chat { frame, text }
                    │
                    ├── 响应 200 → 显示 AI 回复 → isProcessing=false → [IDLE]
                    └── 响应 4xx/5xx → 显示红色错误(3s消失) → isProcessing=false → [IDLE]
```

---

## 7. 验收标准

### Step 1-5 验收
- [ ] `npm run dev` 正常启动
- [ ] `localhost:3000` 能打开页面

### Step 6 验收（前端）
- [ ] 页面打开后，浏览器弹出摄像头/麦克风权限请求
- [ ] 授权后，`<video>` 显示摄像头实时画面（需开 Chrome）
- [ ] 非 Chrome 或不支持 SpeechRecognition 时，显示降级提示文案
- [ ] 按住按钮 → 按钮文字变为 "🔴 录音中...松开发送"
- [ ] 松开按钮 → 按钮文字变为 "⏳ AI 思考中..."
- [ ] 控制台打印出识别的文字（`console.log(text)`）
- [ ] 控制台打印出 `frame` 前 50 字符（`console.log(frame.slice(0, 50))`）
- [ ] 快速连续点击两次按钮 → 第二次被忽略（`isProcessing` 锁生效）

### Step 7 验收（后端）
- [ ] `POST /api/chat` 传入合法的 `{ frame, text }` → 返回 200，`text` 非空
- [ ] 传入纯文字（frame 用一张测试图），LLM 正常回复
- [ ] 传真正的摄像头截图 + 真实问题 → LLM 准确描述画面
- [ ] 缺少 `text` → 返回 400
- [ ] 缺少 `frame` → 返回 400
- [ ] `frame` 不是 `data:image/` 开头 → 返回 400
- [ ] 未设置 API Key → 返回 500
- [ ] CORS 头存在：响应头包含 `Access-Control-Allow-Origin: *`

### 全链路验收
- [ ] 用 Chrome 打开页面
- [ ] 对着摄像头展示一个物体（如一本书、一个水杯）
- [ ] 按住按钮说"这是什么？"
- [ ] 松开后 2-5 秒内显示 AI 回复
- [ ] AI 回复准确描述了画面中的物体
- [ ] 不说话按住然后松开 → 显示"未检测到语音"提示
- [ ] 放开按钮后按钮恢复为 "🎤 按住说话"，可以再次使用

---

## 8. 部署命令（按顺序执行）

```bash
# 1. 安装 Vercel CLI
npm i -g vercel

# 2. 登录
vercel login

# 3. 设置环境变量（在项目目录下跑）
vercel env add OPENAI_API_KEY
# 输入: sk-your-openai-api-key

vercel env add OPENAI_BASE_URL
# 输入: https://api.openai.com/v1 （或其他兼容端点）

# 4. 部署
vercel --prod

# 5. 本地调试（可选，模拟线上环境）
vercel dev
# 访问 http://localhost:3000，此时 api/chat.js 能读到 vercel env 里设置的 Key
```

---

## 9. 重要约束（AI agent 必须遵守）

1. **不要引入额外 npm 依赖**：Vite 是唯一的 devDependency。不用 React、Vue、Tailwind npm 包。
2. **Tailwind 用 CDN**：`<script src="https://cdn.tailwindcss.com">`。不装 PostCSS。
3. **ASR 在前端用 Web Speech API，不传音频到后端**。后端只收 `{ frame, text }` 两个字段。
4. **后端用原生 `fetch()`，不用 OpenAI SDK**。Edge Function 不支持 Node.js。
5. **所有响应带 CORS 头**：`Access-Control-Allow-Origin: *`。包括 OPTIONS 预检。
6. **API Key 只存在于 Vercel 环境变量**。不写在代码里、不放在 `.env` 文件里、不提交到 git。
7. **`<video>` 标签必须加 `muted` 属性**。否则 Chrome 不允许 Web Speech 同时访问音频流。
8. **`recognition.start()` 必须在 `mousedown` 事件回调里调用**。Chrome 要求语音识别由用户手势触发。
9. **加 `isProcessing` 锁**。录音中或等待回复时忽略所有点击。
10. **`recognition` 实例每次用完就丢**。下次 `mousedown` 重新 `new`。不复用旧实例。
11. **不做 Phase 2 的任何东西**：TTS、VAD、多轮对话、打断、流式输出、移动端适配——全都不做。

---

## 10. 已知风险与处理

| 风险 | 前端处理 | 后端处理 |
|------|---------|---------|
| 浏览器不支持 SpeechRecognition | 页面加载时检测，显示"请使用 Chrome" | — |
| Web Speech 识别为空 | `onend` 触发但无 `onresult` → 显示"未检测到语音" | — |
| 摄像头/麦克风权限拒绝 | 显示引导文字"请在浏览器设置中开启权限" | — |
| 用户说了话但中文识别很差 | Phase 1 接受此限制。Phase 2 切后端 ASR | — |
| LLM 超时（>25s） | 显示"AI 响应超时，请重试" | `AbortController` 25s 超时 |
| LLM 返回异常格式 | — | try-catch + 校验 `choices[0].message.content` |
| 图片 base64 过大 | 640×480 Q=60 确保 < 50KB | 拒绝 > 200KB 的 frame |
| 连续快速点击 | `isProcessing` 锁忽略后续点击 | — |
| Edge Function 冷启动 | 第一次请求延迟 ~1-2s，可接受 | — |

---

> **给 AI agent 的总指令**：
> 按 Step 1 → Step 7 顺序构建。每完成一步，用验收标准自检。
> 全链路跑通后，部署到 Vercel。
> **不要做任何本文档未要求的事情。**
