# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI 视觉对话助手 (AI Visual Chat Assistant) — a single-page web app where the user sees their camera feed, holds a button to speak, and a multimodal LLM responds based on the camera frame + transcribed speech.

**Phase 1 MVP constraints**: No TTS, no VAD (manual push-to-talk), no multi-turn history, no streaming, no mobile. Desktop Chrome only.

## Commands

```bash
npm run dev       # Start Vite dev server on port 3000
npm run build     # Production build to dist/
npm run preview   # Preview production build locally
vercel dev        # Local dev with Edge Function (reads Vercel env vars)
vercel --prod     # Deploy to production
```

## Architecture

```
Browser (Chrome)                     Vercel Edge (V8 isolate)
┌────────────────────┐               ┌──────────────────────────┐
│ index.html         │  POST         │ api/chat.js               │
│ (Vanilla JS)       │ ────────────→ │                           │
│                    │  multipart/   │ 1. uploadToStorage() → S3 │
│ MediaRecorder API  │  form-data    │ 2. speechToText() → ASR   │
│ getUserMedia()     │  audio +frame │ 3. chatWithVision() → LLM │
│ Canvas grab         │ ←──────────── │                           │
└────────────────────┘  {text,error} └──────────────────────────┘
```

**7 files total** — no `src/`, no framework, no extra npm packages:

| File | Purpose |
|---|---|
| [index.html](index.html) | Frontend: video, canvas, hold-to-talk button, AI reply. Tailwind via CDN. MediaRecorder for audio capture. |
| [package.json](package.json) | Only devDependency is `vite ^5.4.0`. `"type": "module"`. |
| [vite.config.js](vite.config.js) | Dev server port 3000, output to `dist/`. |
| [.gitignore](.gitignore) | `node_modules`, `dist` |
| [api/chat.js](api/chat.js) | Vercel Edge Function: S3 upload → ASR → LLM orchestration. All via native `fetch()`. |
| [vercel.json](vercel.json) | Edge Function config: 512MB memory, 30s max duration. |
| [README.md](README.md) | Project docs for humans. |

## API Contract

**POST /api/chat** — Content-Type: `multipart/form-data`. All responses include `Access-Control-Allow-Origin: *`.

| Field | Type | Constraint |
|---|---|---|
| `audio` | Blob | WebM audio, 1KB – 5MB |
| `frame` | string | `data:image/jpeg;base64,...`, max 200KB |

```
200 OK:   { text: "AI 回复内容", error: null }
200 OK:   { text: null, error: "未识别到语音内容，请重试" }
400:      { text: null, error: "缺少 audio 参数" }
500:      { text: null, error: "服务处理失败: ..." }
```

## Backend Pipeline (api/chat.js)

1. **Validate** — parse multipart, check audio Blob + frame string
2. **Upload audio to S3** — `PUT {STORAGE_ENDPOINT}/{bucket}/audio-{timestamp}-{random}.webm`, Bearer Token auth
3. **ASR** — `POST {ASR_API_ENDPOINT}` with `{ audio_url }`, Bearer Token auth
4. **LLM** — `POST {LLM_BASE_URL}/chat/completions` with system prompt + user message `[image, text]`

Timeouts: S3 upload 15s, ASR 15s, LLM 20s (all within Edge Function 30s hard limit).

## Environment Variables

All set via `vercel env add`. Never in code, `.env`, or git.

| Variable | Purpose |
|---|---|
| `STORAGE_ENDPOINT` | S3-compatible storage endpoint |
| `STORAGE_BUCKET` | Bucket name |
| `STORAGE_ACCESS_KEY` | Access key |
| `STORAGE_SECRET_KEY` | Secret key (used as Bearer token) |
| `STORAGE_REGION` | Region (default `auto`) |
| `ASR_API_ENDPOINT` | ASR service URL |
| `ASR_API_KEY` | ASR API key |
| `LLM_API_KEY` | LLM API key |
| `LLM_BASE_URL` | LLM API base URL (OpenAI-compatible) |
| `LLM_MODEL` | Model name (default `gpt-4o`) |

## Key Constraints

- **No extra npm dependencies** — Vite is the only one. Tailwind via CDN `<script>` tag, not PostCSS.
- **Backend uses native `fetch()`** — Edge Function's V8 isolate has no Node.js stdlib; no SDKs.
- **All API keys live only in Vercel environment variables** — never in code, `.env`, or git.
- **Frontend sends audio + frame via multipart/form-data** — ASR happens server-side, not in browser.
- **Audio is audio/webm from MediaRecorder** — no format conversion; uploaded as-is to S3.
- **`<video>` must have `muted` attribute** — prevents Chrome from blocking audio stream access.
- **`isProcessing` lock** — prevents double-submission during recording or while waiting for AI reply.
- **New `MediaRecorder` instance per use** — never reuse.
- **Frame is 640×480 JPEG at quality 0.6** — captured via hidden `<canvas>`, sent as base64 data URL. Capped at 200KB server-side.
- **Audio silence detection** — `audioBlob.size < 1000` bytes → treated as no speech, not sent.

## Frontend State Machine

```
IDLE → (mousedown) → RECORDING → (mouseup) → SENDING → (response) → IDLE
Button:              Button:      Button:
"🎤 按住说话"        "🔴 录音中...  "⏳ AI 思考中..."
                     松开发送"
```

Errors display red text for 3 seconds, then return to IDLE.

## Deployment

```bash
npm i -g vercel && vercel login
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
