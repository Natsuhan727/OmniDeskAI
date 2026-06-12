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

vercel env add STORAGE_ENDPOINT
vercel env add STORAGE_BUCKET
vercel env add STORAGE_ACCESS_KEY
vercel env add STORAGE_SECRET_KEY
vercel env add ASR_API_ENDPOINT
vercel env add ASR_API_KEY
vercel env add LLM_API_KEY
vercel env add LLM_BASE_URL
vercel env add LLM_MODEL

vercel --prod
```

## 环境变量

| 变量 | 用途 |
|------|------|
| `STORAGE_ENDPOINT` | S3 兼容存储 endpoint |
| `STORAGE_BUCKET` | 存储桶名称 |
| `STORAGE_ACCESS_KEY` | 存储 Access Key |
| `STORAGE_SECRET_KEY` | 存储 Secret Key |
| `STORAGE_REGION` | 存储区域（默认 auto） |
| `ASR_API_ENDPOINT` | ASR 服务 URL |
| `ASR_API_KEY` | ASR 服务 Key |
| `LLM_API_KEY` | LLM API Key |
| `LLM_BASE_URL` | LLM API Base URL |
| `LLM_MODEL` | 模型名称（默认 gpt-4o） |

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Vite 5.x + Vanilla JS + Tailwind CSS CDN |
| 录音 | MediaRecorder API (audio/webm) |
| 抓帧 | Canvas API (640×480 JPEG Q=60) |
| 云存储 | S3 兼容对象存储 |
| ASR | 云端 ASR 服务 (REST API) |
| LLM | 多模态 LLM (OpenAI 兼容 API) |
| 后端 | Vercel Edge Function |
| 部署 | Vercel |

## 项目结构

```
├── index.html          # 前端页面
├── api/
│   └── chat.js         # Vercel Edge Function（S3 + ASR + LLM 编排）
├── package.json        # Vite 依赖
├── vite.config.js      # Vite 配置
├── vercel.json         # Vercel 部署配置
└── README.md
```

## API

**POST /api/chat** — Content-Type: multipart/form-data

| 字段 | 类型 | 说明 |
|------|------|------|
| `audio` | Blob | WebM 音频 |
| `frame` | string | `data:image/jpeg;base64,...` |

## 许可证

MIT
