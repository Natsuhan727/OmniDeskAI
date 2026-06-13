---
title: PRD - Phase 4
project: AI 视觉对话助手
phase: 4
status: ready-to-build
created: 2026-06-13
target: AI agent
requires: Phase 1-3 已完成
---

# PRD: AI 视觉对话助手 — Phase 4

> Phase 1-3：功能完整。
> Phase 4 目标：**零部署配置。用户打开网页，在设置面板里填 Key，即刻可用。**

---

## 1. 核心变更：配置从环境变量迁移到应用内

### 1.1 改了什么

| 之前 | 之后 |
|------|------|
| 部署前 `vercel env add` 配 5+ 环境变量 | 部署零配置，打开即用 |
| 换 Key 要重新部署 | 设置面板里粘贴 Key，即时生效 |
| 新人不知道怎么注册百度/阿里云 | 设置面板旁边有链接和指引 |
| 只能部署时配，不可运行时改 | 随时改，刷新保持（localStorage） |

### 1.2 向后兼容

后端 Key 读取优先级：**请求体 > 环境变量 > 默认值**。

已部署的 Vercel 实例无影响——环境变量仍然生效。新用户不设环境变量也能用。

```js
const asrKey = body.asr_api_key || process.env.ASR_API_KEY;
const llmKey = body.llm_api_key || process.env.LLM_API_KEY;
```

---

## 2. Phase 4 改进项

| # | 改进 | 优先级 | 说明 |
|---|------|:--:|------|
| F1 | **ASR/LLM/TTS Key 进设置面板** | P0 | 零部署配置。用户打开网页填 Key 即用 |
| F2 | **新增 DashScope ASR Provider** | P0 | 一个 Key 搞定 ASR + LLM |
| F3 | **后端接收请求内 Key** | P0 | 优先用 `body.asr_api_key`，fallback 到 `process.env` |
| F4 | **打断后直接进入录音** | P1 | 打断 AI 后立即开始录音 |
| F5 | **首次使用引导** | P1 | 空状态引导文案，首次成功回复后消失 |
| F6 | **降级时视觉反馈** | P2 | 非流式降级时显示 loading 占位符 |
| F7 | **错误提示优化** | P2 | 延长到 6s + 手动关闭按钮 |

---

## 3. F1+F2+F3: 零部署配置

### 3.1 设置面板改造

当前设置面板有 3 个控件（模型/TTS/帧质量）。Phase 4 扩展为 7 个：

```
┌───────────────────────────────────┐
│ ⚙️ 设置                      ▲    │
├───────────────────────────────────┤
│ ── 语音识别 (ASR) ──              │
│ 提供商: [baidu ▼]                 │
│ API Key:  [________________]      │
│ Secret:   [________________]      │
│                                   │
│ ── 对话模型 (LLM) ──              │
│ 提供商: [dashscope ▼]             │
│ API Key:  [________________]      │
│ 模型:     [qwen-vl-plus      ]    │
│                                   │
│ ── 语音合成 (TTS) ──              │
│ 提供商: [baidu ▼]                 │
│ （复用 ASR 的 Key）               │
│                                   │
│ ── 其他 ──                        │
│ TTS 开关: [✓]                     │
│ 帧质量:   [60% ───○──]            │
└───────────────────────────────────┘
```

### 3.2 每个 Key 输入框的行为

- 输入框 `type="password"`（点眼睛图标切换明文）
- 旁边有 `?` 图标 → hover 显示注册链接和指引
- 如果环境变量已有值（从后端 API 响应获知），placeholder 显示 `已通过环境变量配置`

### 3.3 后端 `/api/config` 端点

前端需要知道哪些 Key 已通过环境变量配置。新增一个轻量端点：

```js
// api/chat.js 路由分发加一条
if (pathname.endsWith('/config')) return handleConfig(req);

async function handleConfig() {
  return json(200, {
    asr_configured: !!(process.env.ASR_API_KEY),
    llm_configured: !!(process.env.LLM_API_KEY),
  });
}
```

前端根据返回决定 placeholder 文案：
- 已配置 → placeholder="已通过环境变量配置" + 输入框禁用
- 未配置 → placeholder="在此粘贴 Key" + 输入框可编辑

### 3.4 请求发送

每次 `/api/chat` 请求携带所有 Key：

```json
{
  "audio": "...",
  "frame": "...",
  "history": [...],
  "asr_api_key": "sk-xxx",
  "asr_secret_key": "xxx",
  "llm_api_key": "sk-xxx",
  "model": "qwen-vl-plus",
  "tts_provider": "baidu"
}
```

前端从 `settings` 单例取值。后端按"请求体 > 环境变量"优先级读取。

### 3.5 后端读取逻辑

```js
// processAudio 中
const asrProvider = body.asr_provider || process.env.ASR_PROVIDER || 'baidu';
const asrKey = body.asr_api_key || process.env.ASR_API_KEY;
const asrSecret = body.asr_secret_key || process.env.ASR_SECRET_KEY;

// handler 和 handleStream 中
const llmKey = body.llm_api_key || process.env.LLM_API_KEY;
const llmProvider = body.llm_provider || process.env.LLM_PROVIDER || 'dashscope';
const ttsProvider = body.tts_provider || process.env.TTS_PROVIDER || 'baidu';
```

> 注意：Provider 函数签名需要增加参数——不再直接从 `process.env` 读 Key，而是从调用方传入。

### 3.6 Provider 签名变更

当前 Provider 直接读 `process.env`：

```js
// 之前
async function asrBaidu(audioBase64) {
  const apiKey = process.env.ASR_API_KEY;  // 直接读 env
  ...
}
```

改为从参数接收：

```js
// 之后
async function asrBaidu(audioBase64, { apiKey, secretKey }) {
  ...
}

// transcribeAudio 传入
async function transcribeAudio(audioBase64, credentials) {
  const fn = asrProviders[ASR_PROVIDER];
  return fn(audioBase64, credentials);
}
```

同样改造 `llmDashScope(frame, text, history, { apiKey })` 和 `ttsProviders.baidu(text, { apiKey, secretKey })`。

**改动范围**：Provider 函数签名 + `transcribeAudio`/`chatWithVision`/`synthesizeSpeech` 透传 credentials。

---

## 4. F4: 新增 DashScope ASR Provider

### 4.1 为什么

一个 DashScope Key 同时覆盖 ASR + LLM。用户只需注册阿里云，不需要百度。

### 4.2 实现

DashScope Paraformer REST API 需要 `file_urls`。通过 DashScope Files API 实现临时上传：

```
1. 收到 audio base64 → 解码为 Uint8Array
2. POST DashScope Files API 上传 → 获取临时 URL（48h 有效）
3. POST Paraformer ASR API { file_urls: [tempUrl] } → 获取 task_id
4. 轮询 GET /api/v1/tasks/{task_id} → 获取 transcription_url
5. 下载识别文字
```

### 4.3 Provider 注册

```js
const asrProviders = {
  baidu: asrBaidu,
  dashscope: asrDashScope,   // 新增
};
```

用户设置面板里 ASR 提供商选 `dashscope`，填入 DashScope Key——ASR + LLM 就全通了。

### 4.4 注意

- 轮询间隔 1s，超时 10s
- Files API 限流 100 QPS（Demo 场景够用）
- 临时 URL 48h 后失效（每次调用都重新上传，不需要长期存储）

---

## 5. F5: 打断后直接进入录音

### 5.1 当前交互

```
AI 播报中 → 用户按住 → 停止播放 → 回到 idle → 需要松手再按
```

### 5.2 改为

```
AI 播报中 → 用户按住 → 停止播放 → 立即开始录音
```

### 5.3 实现

`js/app.js` 的 `onButtonDown`——打断块去掉 `return`，加 `isProcessing = false`：

```js
if (currentAudio && !currentAudio.paused) {
    currentAudio.pause();
    currentAudio = null;
    isProcessing = false;
    // 不 return，继续执行录音逻辑
}
if (isProcessing || !stream) return;
// ... 录音
```

---

## 6. F6: 首次使用引导

- 空状态分两阶段：未授权 → "请允许摄像头和麦克风"；已授权从未对话 → 3 步骤引导文案
- 标记存 `localStorage.hasConversed`
- 首次成功回复后引导永久消失

---

## 7. F7: 降级时视觉反馈

流式失败降级到非流式时，在消息列表中插入 pulsating placeholder：

```js
const placeholder = appendBubble('assistant', '⏳ AI 正在组织语言...');
placeholder.querySelector('p').classList.add('animate-pulse');
// 拿到回复后 updateBubbleText 替换
```

---

## 8. F8: 错误提示优化

- 错误气泡显示时长 3.5s → 6s
- 右侧加 `✕` 关闭按钮

---

## 9. README 简化

部署步骤从"注册两个平台 + 配环境变量"缩减为：

```
部署: vercel --prod
使用: 打开网页 → 设置 → 填入 Key → 开始对话
```

提示两种配置路径：
- 路径 A：只填 DashScope Key（ASR 选 dashscope + LLM）+ 百度 Key（TTS）
- 路径 B：填百度 Key（ASR + TTS）+ DashScope Key（LLM）

---

## 10. 环境变量变化

| 变量 | Phase 3 | Phase 4 |
|------|:--:|:--:|
| `ASR_API_KEY` | 必填 | **可选**（可在 UI 填） |
| `ASR_SECRET_KEY` | 必填 | **可选** |
| `LLM_API_KEY` | 必填 | **可选** |
| `LLM_BASE_URL` | 可选 | 可选 |
| `LLM_MODEL` | 可选 | 可选 |
| `ASR_PROVIDER` | 可选 | 可选 |
| `LLM_PROVIDER` | 可选 | 可选 |
| `TTS_PROVIDER` | 可选 | 可选 |

**全部可选。** 不设任何环境变量，用户打开网页填 Key 就能用。

---

## 11. 验收标准

### 零部署配置
- [ ] `vercel --prod` 后打开网页，不设任何环境变量
- [ ] 设置面板显示 ASR/LLM/TTS Key 输入框（placeholder 提示填写）
- [ ] 填入 Key 后立即生效，下一轮对话带上 Key
- [ ] 刷新后 Key 保持（localStorage）
- [ ] 环境变量配置的 Key 显示"已通过环境变量配置"

### DashScope ASR
- [ ] ASR 提供商选 dashscope，填入 DashScope Key
- [ ] 正常录音 → 识别文字 → LLM 回复

### 交互改进（同前版）
- [ ] 打断直接进入录音
- [ ] 首次引导
- [ ] 降级 pulsating placeholder
- [ ] 错误提示 6s 可关闭

---

> **给 AI agent**：
> 实现顺序：F3（后端 Key 透传）→ F2（DashScope ASR）→ F1（设置面板 UI）→ F5-F8。
> Provider 签名变更涉及 `asrBaidu`/`llmDashScope`/`ttsProviders.baidu` 三个函数，一并改造。
> 原环境变量读取全部保留作为 fallback，不影响已部署实例。
