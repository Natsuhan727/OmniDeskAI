# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Ground Rules

- **只写代码，不做 git 操作。** 不要 `git commit`、`git push`、`git add`。代码写完后，由用户自己提交。
- **PRD 是唯一事实来源。** 对照 PRD 写代码，不做 PRD 未要求的事情。

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
Browser (Chrome)                           Vercel Edge (V8 isolate)
┌──────────────────────────┐               ┌─────────────────────┐
│ index.html               │  POST JSON    │ api/chat.js          │
│                          │ ────────────→ │                      │
│ AudioContext 16kHz PCM   │  {frame,text} │ LLM 代理 (fetch)     │
│   → WebSocket → DashScope│               │ → qwen-vl-plus      │
│   ASR 实时识别（服务端VAD）│ ←──────────── │                      │
│ Canvas grab (JPEG Q=60)  │  {text,error} │                      │
└──────────────────────────┘               └─────────────────────┘
```

**7 files total** — no `src/`, no framework, no extra npm packages:

| File | Purpose |
|---|---|
| [index.html](index.html) | Frontend: video, canvas, hold-to-talk button, AI reply. Tailwind CDN. AudioContext 16kHz → WebSocket ASR. |
| [package.json](package.json) | Only devDependency is `vite ^5.4.0`. `"type": "module"`. |
| [vite.config.js](vite.config.js) | Dev server port 3000, output to `dist/`. |
| [.gitignore](.gitignore) | `node_modules`, `dist` |
| [api/chat.js](api/chat.js) | Vercel Edge Function: LLM proxy only. Native `fetch()` to OpenAI-compatible API. |
| [vercel.json](vercel.json) | Edge Function config: 512MB memory, 30s max duration. |
| [README.md](README.md) | Project docs for humans. |

## API Contract

**POST /api/chat** — Content-Type: `application/json`. All responses include `Access-Control-Allow-Origin: *`.

| Field | Type | Constraint |
|---|---|---|
| `frame` | string | `data:image/jpeg;base64,...`, max 200KB |
| `text` | string | ASR 识别文字 |

```
200 OK:   { text: "AI 回复内容", error: null }
400:      { text: null, error: "缺少 text 参数" }
500:      { text: null, error: "AI 响应超时，请重试" }
```

## Frontend Detail (index.html)

**Audio pipeline**: `getUserMedia` → `AudioContext(16000Hz)` → `ScriptProcessorNode(4096)` → Float32→Int16 PCM → WebSocket binary send

**ASR**: DashScope realtime WebSocket (`wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=qwen-asr-realtime&token=...`). Server-side VAD auto-detects speech end. `transcription.completed` → `finalText`. `session.finished` → `finish()`.

**Auth**: DASHSCOPE_API_KEY hardcoded as `API_KEY` const in frontend (hackathon demo acceptable).

**States**: IDLE → RECORDING (WebSocket open, PCM streaming) → SENDING (commit sent, waiting for LLM) → IDLE

## Environment Variables (Vercel)

| Variable | Required | Default |
|---|---|---|
| `LLM_API_KEY` | **Yes** | — |
| `LLM_BASE_URL` | No | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `LLM_MODEL` | No | `qwen-vl-plus` |

## Key Constraints

- **No extra npm dependencies** — Vite only. Tailwind via CDN.
- **Backend uses native `fetch()`** — no SDKs.
- **ASR is browser-side WebSocket** — backend only receives `{ frame, text }` JSON.
- **AudioContext sampleRate = 16000Hz** — ScriptProcessor bufferSize = 4096.
- **`<video>` must have `muted`** — or Chrome blocks AudioContext.
- **AudioContext created inside `mousedown`** — satisfies browser autoplay policy.
- **`isProcessing` lock** — prevents double-submission.
- **New WebSocket + AudioContext per use** — never reuse.
- **Frame**: 640×480 JPEG Q=60, max 200KB server-side.
- **GainNode mute** (gain=0) — avoids echo when ScriptProcessor connects to destination.
- **15s ASR timeout** — cleanup + "识别超时" if no `session.finished`.

## Deployment

```bash
npm i -g vercel && vercel login
vercel env add LLM_API_KEY    # DASHSCOPE_API_KEY
vercel --prod
```
