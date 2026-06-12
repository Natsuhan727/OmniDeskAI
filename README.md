# AI 视觉对话助手

用户打开网页，看到摄像头画面，按住按钮说话，AI 结合画面用文字回复。

## 快速开始

```bash
npm install
npm run dev       # http://localhost:3000
```

## 部署

```bash
npm i -g vercel && vercel login
vercel env add LLM_API_KEY        # DashScope API Key
vercel env add BAIDU_API_KEY      # 百度 AI 开放平台 API Key
vercel env add BAIDU_SECRET_KEY   # 百度 AI 开放平台 Secret Key
vercel --prod
```

## 环境变量

| 变量 | 必填 | 默认值 |
|------|------|--------|
| `LLM_API_KEY` | **是** | — |
| `BAIDU_API_KEY` | **是** | — |
| `BAIDU_SECRET_KEY` | **是** | — |
| `LLM_BASE_URL` | 否 | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `LLM_MODEL` | 否 | `qwen-vl-plus` |

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Vite 5.x + Vanilla JS + Tailwind CSS CDN |
| 音频 | MediaRecorder → AudioContext 解码 → PCM WAV 16kHz |
| ASR | 百度短语音识别（base64 直传，无 OSS） |
| 抓帧 | Canvas API (640×480 JPEG Q=60) |
| LLM | DashScope 多模态 LLM (OpenAI 兼容) |
| 后端 | Vercel Edge Function |

## 项目结构

```
├── index.html          # 前端（录音 + webm→WAV 转换 + 抓帧）
├── api/
│   └── chat.js         # 百度 ASR + DashScope LLM
├── package.json
├── vite.config.js
├── vercel.json
└── README.md
```

## API

**POST /api/chat** — Content-Type: application/json

| 字段 | 类型 | 说明 |
|------|------|------|
| `audio` | string | base64 WAV (PCM 16kHz mono) |
| `frame` | string | `data:image/jpeg;base64,...` |

## 许可证

MIT
