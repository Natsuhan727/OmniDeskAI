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
Browser (Chrome)                               Vercel Edge (V8 isolate)
┌──────────────────────────────┐               ┌────────────────────────┐
│ index.html                   │  POST JSON    │ api/chat.js             │
│                              │ ────────────→ │                         │
│ MediaRecorder → webm blob    │  {audio,      │ 1. 百度 OAuth 取 Token  │
│   → AudioContext 解码        │   frame}      │ 2. 百度 ASR → text      │
│   → PCM WAV 16kHz → base64   │               │ 3. DashScope LLM → reply│
│ Canvas → JPEG Q=60 → base64  │ ←──────────── │                         │
└──────────────────────────────┘  {text,error} └────────────────────────┘
```

| File | Purpose |
|---|---|
| [index.html](index.html) | Frontend: MediaRecorder → AudioContext 转 PCM WAV → base64 → JSON POST. Tailwind CDN. |
| [api/chat.js](api/chat.js) | Vercel Edge Function: 百度 OAuth 鉴权 → ASR → DashScope LLM. All via native `fetch()`. |
| [package.json](package.json) | Only devDependency `vite ^5.4.0`. |
| [vite.config.js](vite.config.js) | Dev server port 3000. |
| [vercel.json](vercel.json) | Edge Function: 512MB, 30s. |

## API Contract

**POST /api/chat** — Content-Type: `application/json`.

| Field | Type | Constraint |
|---|---|---|
| `audio` | string | base64 WAV (PCM 16kHz mono), max 3MB |
| `frame` | string | `data:image/jpeg;base64,...`, max 200KB |

## Environment Variables (Vercel)

| Variable | Required | Default |
|---|---|---|
| `LLM_API_KEY` | **Yes** | DASHSCOPE_API_KEY |
| `BAIDU_API_KEY` | **Yes** | 百度 AI 开放平台 API Key |
| `BAIDU_SECRET_KEY` | **Yes** | 百度 AI 开放平台 Secret Key |
| `LLM_BASE_URL` | No | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `LLM_MODEL` | No | `qwen-vl-plus` |

## Key Constraints

- **No extra npm dependencies** — Vite only. Tailwind via CDN.
- **Backend uses native `fetch()`** — no SDKs.
- **ASR = 百度短语音识别** — base64 WAV 直传，无 OSS/S3 依赖。
- **LLM = DashScope** — OpenAI 兼容端点。
- **前端 webm→WAV 转换** — AudioContext 解码 + OfflineAudioContext 重采样 16kHz 单声道。
- **`<video>` must have `muted`** — or Chrome blocks audio stream.
- **`isProcessing` lock** — prevents double-submission.
- **Frame**: 640×480 JPEG Q=60, max 200KB server-side.
- **Audio silence detection**: `audioBlob.size < 1000` → "未检测到语音".

## Deployment

```bash
npm i -g vercel && vercel login
vercel env add LLM_API_KEY    # DASHSCOPE_API_KEY
vercel --prod
```
