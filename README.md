# AI 视觉对话助手

用户打开网页，看到摄像头画面，按住按钮说话，AI 结合画面用文字回复。

## 快速开始

```bash
npm install
npm run dev       # http://localhost:3000
```

## 部署

```bash
npm i -g vercel
vercel login
vercel env add LLM_API_KEY    # DASHSCOPE_API_KEY
vercel --prod
```

## 环境变量

| 变量 | 必填 | 默认值 |
|------|------|--------|
| `LLM_API_KEY` | **是** | — |
| `LLM_BASE_URL` | 否 | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `LLM_MODEL` | 否 | `qwen-vl-plus` |

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Vite 5.x + Vanilla JS + Tailwind CSS CDN |
| 音频 | Web Audio API (AudioContext 16kHz PCM) |
| ASR | DashScope 实时语音识别 (WebSocket) |
| 抓帧 | Canvas API (640×480 JPEG Q=60) |
| LLM | 多模态 LLM (OpenAI 兼容 API) |
| 后端 | Vercel Edge Function (LLM 代理) |

## 项目结构

```
├── index.html          # 前端页面（AudioContext + WebSocket ASR）
├── api/
│   └── chat.js         # Vercel Edge Function（LLM 代理）
├── package.json
├── vite.config.js
├── vercel.json
└── README.md
```

## API

**POST /api/chat** — Content-Type: application/json

| 字段 | 类型 | 说明 |
|------|------|------|
| `frame` | string | `data:image/jpeg;base64,...` |
| `text` | string | ASR 识别文字 |

## 许可证

MIT
