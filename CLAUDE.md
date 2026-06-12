# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Ground Rules

- **每次改动前先创建新分支。** 永远不在 `master` 上直接改代码。分支名用描述性命名（如 `feat/xxx`、`fix/xxx`）。
- **分支上要 commit。** 改动完成后在分支上 `git add` + `git commit`，保持清晰的提交历史。不做 `git push`、`git merge`、提 PR——这些由用户自己操作。
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
│ MediaRecorder → webm blob    │  {audio,      │ ASR_PROVIDER 路由:      │
│   → AudioContext 解码        │   frame}      │  → transcribeAudio()    │
│   → PCM Int16 16kHz → base64 │               │ LLM_PROVIDER 路由:      │
│ Canvas → JPEG Q=60 → base64  │ ←──────────── │  → chatWithVision()    │
│ Canvas → JPEG Q=60 → base64  │ ←──────────── │                         │
└──────────────────────────────┘  {text,error} └────────────────────────┘
```

| File | Purpose |
|---|---|
| [index.html](index.html) | Frontend: MediaRecorder → AudioContext 解码 webm → 重采样 PCM Int16 16kHz mono → base64 → JSON POST. |
| [api/chat.js](api/chat.js) | Vercel Edge Function: ASR/LLM 供应商可插拔编排。All via native `fetch()`. |
| [package.json](package.json) | Only devDependency `vite ^5.4.0`. |
| [vite.config.js](vite.config.js) | Dev server port 3000. |
| [vercel.json](vercel.json) | Edge Function: 512MB, 30s. |

## API Contract

**POST /api/chat** — Content-Type: `application/json`.

| Field | Type | Constraint |
|---|---|---|
| `audio` | string | base64 PCM Int16 (16kHz mono), max 3MB |
| `frame` | string | `data:image/jpeg;base64,...`, max 200KB |

## Environment Variables (Vercel)

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `ASR_PROVIDER` | No | `baidu` | ASR 供应商 |
| `ASR_API_KEY` | **Yes** | — | ASR Key |
| `ASR_SECRET_KEY` | — | — | ASR Secret（百度需要） |
| `LLM_PROVIDER` | No | `dashscope` | LLM 供应商 |
| `LLM_API_KEY` | **Yes** | — | LLM Key |
| `LLM_BASE_URL` | No | `https://dashscope.aliyuncs.com/compatible-mode/v1` | LLM 端点 |
| `LLM_MODEL` | No | `qwen-vl-plus` | 模型名 |

**换供应商 = 改 PROVIDER + 换对应 Key，零代码改动。**

## Key Constraints

- **No extra npm dependencies** — Vite only. Tailwind via CDN.
- **Backend uses native `fetch()`** — no SDKs.
- **ASR 供应商可插拔** — `ASR_PROVIDER` 控制 dispatch，内置百度。
- **LLM 供应商可插拔** — `LLM_PROVIDER` 控制 dispatch，内置 DashScope。
- **前端发通用格式** — `{audio: base64 PCM, frame: base64 JPEG}`，不感知供应商。
- **前端 webm→PCM 转换** — AudioContext 解码 + OfflineAudioContext 重采样 16kHz 单声道。
- **`<video>` must have `muted`** — or Chrome blocks audio stream.
- **`isProcessing` lock`** — prevents double-submission.
- **Frame**: 640×480 JPEG Q=60, max 200KB server-side.
- **Audio silence detection**: `audioBlob.size < 1000` 前端初筛；百度服务端 VAD 最终判断。

## Deployment

```bash
npm i -g vercel && vercel login
vercel env add ASR_API_KEY     # ASR 供应商 Key
vercel env add ASR_SECRET_KEY  # ASR 供应商 Secret
vercel env add LLM_API_KEY     # LLM 供应商 Key
vercel --prod
```
