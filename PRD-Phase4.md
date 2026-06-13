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

> Phase 1-3：功能完整（摄像头+语音→AI 看图说话+语音回复+流式+设置+模块化）。
> Phase 4 目标：**让用户能跑起来，用得顺手。不做新功能，只做体验打磨。**

---

## 1. Phase 4 改进项

| # | 改进 | 优先级 | 类型 | 说明 |
|---|------|:--:|------|------|
| F1 | **README 重写** | P0 | 文档 | 环境变量、项目结构、API 契约全部更新到 Phase 3 |
| F2 | **.env.example 模板** | P0 | 配置 | 用户复制粘贴即可开始，含注释说明 |
| F3 | **打断后直接进入录音** | P1 | 交互 | 打断 AI → 立即开始录音，不需要松手再按 |
| F4 | **首次使用引导** | P1 | 交互 | 空状态文案 + 首次成功回复后自动消失 |
| F5 | **模型自由输入** | P1 | 设置 | 模型从下拉改为文本输入，支持任意 OpenAI 兼容模型名 |
| F6 | **错误提示时长延长** | P2 | 交互 | 3.5s → 6s，加手动关闭按钮 |
| F7 | **降级时视觉反馈** | P2 | 交互 | 非流式降级时显示 "⏳ AI 正在组织语言..." |

> P0 = 必须做（用户体验断点），P1 = 做了明显提升，P2 = 锦上添花。

---

## 2. F1: README 重写

### 2.1 当前问题

README.md 是 Phase 1 时期的。环境变量表写的是 `BAIDU_API_KEY`（实际已改为 `ASR_API_KEY`），项目结构没有 `js/` 目录，没有提流式/设置面板/TTS/Provider 架构。

### 2.2 要求

用以下结构重写 `README.md`，确保内容与 `api/chat.js`、`index.html`、`js/` 目录的实际代码一致：

```
# AI 视觉对话助手

一句话简介

## Demo 视频
> [提交时替换为链接]

## 快速开始

### 环境要求
- Node.js >= 18
- Chrome 桌面浏览器
- 百度 AI 开放平台账号（ASR + TTS）
- 阿里云百炼账号（LLM）

### 1. 获取 API Key
[百度注册步骤，含截图或文字说明]
[阿里云百炼注册步骤]

### 2. 本地运行
npm install
vercel dev          # 本地调试（含 Edge Function）

### 3. 部署
vercel env add ASR_API_KEY
vercel env add ASR_SECRET_KEY
vercel env add LLM_API_KEY
vercel --prod

## 环境变量
| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| ASR_API_KEY | 是 | — | 百度 AI 平台 API Key |
| ASR_SECRET_KEY | 是 | — | 百度 AI 平台 Secret Key |
| LLM_API_KEY | 是 | — | 阿里云百炼 DashScope API Key |
| LLM_BASE_URL | 否 | dashscope... | OpenAI 兼容端点 |
| LLM_MODEL | 否 | qwen-vl-plus | 模型名 |
| ASR_PROVIDER | 否 | baidu | 可替换为自定义 Provider |
| LLM_PROVIDER | 否 | dashscope | 同上 |
| TTS_PROVIDER | 否 | baidu | 同上 |

## 功能
- 📷 摄像头实时预览
- 🎤 按住说话（Push-to-Talk）
- 💬 AI 结合画面流式回复（逐字显示）
- 🔊 TTS 语音播报（可打断）
- 🧠 多轮对话 + 视觉记忆
- ⚙️ 设置面板（模型/TTS/帧质量）

## 技术栈
| 层 | 技术 |
|---|------|
| 前端 | Vite + Vanilla JS + Tailwind CSS CDN |
| 音频 | MediaRecorder → AudioContext 16kHz PCM → base64 |
| ASR | 百度短语音识别（Provider 可替换） |
| LLM | 多模态 LLM，OpenAI 兼容 API（Provider 可替换） |
| TTS | 百度短文本 TTS（Provider 可替换） |
| 后端 | Vercel Edge Function（三路由分发） |

## 项目结构
[完整目录树，含 js/ 下所有文件说明]

## API
[POST /api/chat, /api/chat/stream, /api/tts 完整契约]

## 许可证
MIT
```

### 2.3 约束

- 所有环境变量名、目录路径、API 字段必须与 master 代码完全一致
- 注册步骤写成文字指引，不需要截图（截图可后续替换）
- Demo 视频链接留占位符 `[提交时替换]`

---

## 3. F2: .env.example 模板

### 3.1 新建文件

创建 `.env.example`（不在 `.gitignore` 中，会被提交）：

```
# ===== ASR（语音识别）=====
# 百度 AI 开放平台：https://ai.baidu.com/
# 控制台 → 语音技术 → 创建应用 → 领取免费额度
ASR_API_KEY=your_baidu_api_key
ASR_SECRET_KEY=your_baidu_secret_key
ASR_PROVIDER=baidu

# ===== LLM（多模态对话）=====
# 阿里云百炼：https://bailian.console.aliyun.com/
# 控制台 → 模型广场 → 开通 qwen-vl-plus
LLM_API_KEY=your_dashscope_api_key
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_MODEL=qwen-vl-plus
LLM_PROVIDER=dashscope

# ===== TTS（语音合成）=====
# 复用百度 ASR 的 Key，无需额外配置
TTS_PROVIDER=baidu
```

### 3.2 .gitignore 更新

`.gitignore` 确保有 `.env`（不含 `.env.example`）：

```
node_modules
dist
.env
```

---

## 4. F3: 打断后直接进入录音

### 4.1 当前交互

```
AI 播报中 → 用户按住 → 停止播放 → 回到 idle
          → 用户松开 → 再按住 → 开始录音
```

两步操作。用户直觉是"我说了话，AI 停了，然后呢？"

### 4.2 改为

```
AI 播报中 → 用户按住 → 停止播放 → 立即开始录音
          → 按钮变为 "🔴 录音中...松开发送"
```

### 4.3 实现

`js/app.js` 的 `onButtonDown`：

```js
function onButtonDown(e) {
  e.preventDefault();

  // 打断 → 停止播放，然后直接进入录音（不 return）
  if (currentAudio && !currentAudio.paused) {
    currentAudio.pause();
    currentAudio = null;
    isProcessing = false;   // ⚠️ 必须重置，否则下面 if(isProcessing) 会拦截
    console.log('[tts] 用户打断播放，直接进入录音');
    // 不 return，继续执行下面的录音逻辑
  }

  if (isProcessing || !stream) return;
  // ... 录音逻辑
}
```

---

## 5. F4: 首次使用引导

### 5.1 当前

空消息列表显示"按住下方按钮开始对话"，按钮就是"🎤 按住说话"。用户已知做什么，但引导感不强。

### 5.2 改为

```
空状态分两阶段：

阶段 1（未授权摄像头）：
  "请允许摄像头和麦克风权限"
  
阶段 2（已授权，从未对话过）：
  信息更具体的引导文案：
  "👋 欢迎使用 AI 视觉对话助手
   
   1️⃣ 将物体对准摄像头
   2️⃣ 按住下方按钮说话
   3️⃣ 松开后 AI 会告诉你看到了什么"
  
  首次成功回复后，引导文案不再显示，此后空状态显示：
  "按住下方按钮开始对话"
```

### 5.3 实现

`js/app.js` 加一个 `hasEverConversed` 标记（存 `localStorage`）：

```js
let hasEverConversed = localStorage.getItem('hasConversed') === 'true';

// 首次成功回复后
localStorage.setItem('hasConversed', 'true');
hasEverConversed = true;
```

`js/ui.js` 直接从 `localStorage` 读取 `hasConversed` 判断显示哪种空状态文案（`hasConversed` 是全局标记，`ui.js` 自行读取即可，不需要跨模块传参）。

---

## 6. F5: 模型自由输入

### 6.1 当前

设置面板模型选项是 `<select>` 下拉，固定两个选项 `qwen-vl-plus` 和 `qwen-vl-max`。

### 6.2 改为

```html
<input type="text" id="settingModel" 
       class="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm w-40"
       placeholder="qwen-vl-plus" />
```

用户输入任意 OpenAI 兼容模型名。`settings.model` 返回输入值或默认值。

### 6.3 注意

- 默认 placeholder 显示 `qwen-vl-plus`（当前默认）
- 输入框旁边加小字提示"任意 OpenAI 兼容模型"
- 不校验模型名有效性（由 API 调用时自然报错）

---

## 7. F6: 错误提示时长延长

### 7.1 当前

`js/ui.js` 的 `showErrorBubble` 中 `setTimeout(..., 3500)`。

### 7.2 改为

延长到 6000ms，并在错误气泡右侧加一个 `✕` 关闭按钮：

```js
wrapper.innerHTML = `
  <div class="... flex items-center justify-between">
    <span>${escapeHtml(msg)}</span>
    <button class="ml-2 text-red-300 hover:text-white text-lg leading-none">&times;</button>
  </div>`;

const closeBtn = wrapper.querySelector('button');
closeBtn.addEventListener('click', () => wrapper.remove());
setTimeout(() => { if (wrapper.parentNode) wrapper.remove(); }, 6000);
```

---

## 8. F7: 降级时视觉反馈

### 8.1 当前

非流式降级时，用户看到空白直到完整回复返回（5-8 秒）。没有任何"正在处理"的视觉线索。

### 8.2 改为

降级时立即在消息列表中追加一个 pulsating placeholder：

```js
// chatNormal 调用前
const placeholder = appendBubble('assistant', '⏳ AI 正在组织语言...');
placeholder.querySelector('p').classList.add('animate-pulse');

// 拿到回复后替换
updateBubbleText(placeholder, data.text);
placeholder.querySelector('p').classList.remove('animate-pulse');
```

> Tailwind CDN 自带 `animate-pulse`。

---

## 9. 验收标准

### README + .env.example
- [ ] README 环境变量表与 `api/chat.js` 实际读取的变量一致
- [ ] README 项目结构与实际目录一致
- [ ] README API 契约与实际端点/字段一致
- [ ] .env.example 包含所有必填环境变量及注释
- [ ] .gitignore 包含 `.env` 但不包含 `.env.example`

### 交互改进
- [ ] 打断 AI 后直接进入录音状态，无需松手再按
- [ ] 首次使用看到引导文案，首次成功回复后不再显示
- [ ] 设置面板模型改为文本输入框
- [ ] 错误气泡 6 秒消失，有手动关闭按钮
- [ ] 流式降级时显示 pulsating placeholder

---

> **给 AI agent**：
> 按 P0 → P1 → P2 顺序实现。
> P0（README + .env.example）必须最先完成——这是用户部署的入口。
> 每完成一项自检对应验收标准。
