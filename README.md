# OmniDeskAI — AI 视觉对话助手

> 一个能「看到你看到的、听到你说的」AI 视觉对话助手

打开摄像头和麦克风，让 AI 看到你看到的、听到你说的，并给出恰当的回应。

## Demo 视频

> [提交时替换为 Bilibili/云盘链接]

## 快速开始

### 环境要求

- Node.js >= 18
- Chrome 浏览器（桌面端）
- OpenAI API Key（或其他兼容的 API 端点）

### 本地运行

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev
# → 打开 http://localhost:3000
```

### 部署

```bash
# 安装 Vercel CLI
npm i -g vercel

# 设置环境变量
vercel env add OPENAI_API_KEY
vercel env add OPENAI_BASE_URL

# 部署
vercel --prod
```

## 技术栈

| 层 | 技术 | 说明 |
|---|------|------|
| 前端 | Vite + Vanilla JS + Tailwind CSS CDN | 零额外依赖 |
| ASR | Web Speech API | 浏览器内置语音识别 |
| 多模态 LLM | OpenAI GPT-4o | 视觉理解 + 文本生成 |
| 后端 | Vercel Edge Function | API 代理层 |
| 部署 | Vercel | 前端 + Function 一体部署 |

## 项目结构

```
├── index.html          # 前端页面（HTML + CSS + JS）
├── api/
│   └── chat.js         # Vercel Edge Function（API 代理）
├── package.json        # Vite 依赖
├── vite.config.js      # Vite 配置
└── vercel.json         # Vercel 部署配置
```

## 核心功能（Phase 1 MVP）

- 📷 摄像头实时预览
- 🎤 按住按钮说话 → Web Speech 语音识别
- 🤖 AI 结合摄像头画面回答问题（文字回复）

## 开发计划

本项目采用 MVP 渐进式开发。详见仓库内 `PRD-Phase1-MVP.md`。

| Phase | 目标 |
|-------|------|
| Phase 1 | 核心链路：摄像头 + 语音 → AI 文字回复 |
| Phase 2 | 体验提升：TTS 语音播报、VAD、多轮对话 |
| Phase 3 | 成本控制：模型分级、场景缓存、流式输出 |

## 许可证

MIT
