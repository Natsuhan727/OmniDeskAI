# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI 视觉对话助手 (AI Visual Chat Assistant) — a single-page web app where the user sees their camera feed, holds a button to speak, and GPT-4o responds based on the camera frame + transcribed speech.

**Phase 1 MVP constraints**: No TTS, no VAD, no multi-turn history, no streaming, no mobile. Desktop Chrome only.

## Commands

```bash
npm run dev       # Start Vite dev server on port 3000
npm run build     # Production build to dist/
npm run preview   # Preview production build locally
vercel dev        # Local dev with Edge Function (reads Vercel env vars)
vercel --prod     # Deploy to production
```

**API Key management** (never in code or `.env` files):
```bash
vercel env add OPENAI_API_KEY     # sk-your-openai-api-key
vercel env add OPENAI_BASE_URL    # https://api.openai.com/v1 (or compatible endpoint)
```

## Architecture

```
Browser (Chrome)                   Vercel Edge (V8 isolate)
┌──────────────────┐              ┌─────────────────────┐
│ index.html       │   POST       │ api/chat.js          │
│ (Vanilla JS)     │ ──────────→ │ (native fetch())     │
│                  │  {frame,     │                     │
│ Web Speech API   │   text}      │ → OpenAI GPT-4o     │
│ getUserMedia()   │ ←────────── │   /chat/completions │
│ Canvas grab      │  {text,      │                     │
└──────────────────┘   error}     └─────────────────────┘
```

**6 files total** — no `src/` directory, no framework, no extra npm packages:

| File | Purpose |
|---|---|
| [index.html](index.html) | Single-page frontend: video, canvas, button, AI reply display. Tailwind via CDN. |
| [package.json](package.json) | Only devDependency is `vite ^5.4.0`. `"type": "module"`. |
| [vite.config.js](vite.config.js) | Dev server port 3000, output to `dist/`. |
| [.gitignore](.gitignore) | `node_modules`, `dist` |
| [api/chat.js](api/chat.js) | Vercel Edge Function. Validates input, forwards to OpenAI via native `fetch()`, returns reply. |
| [vercel.json](vercel.json) | Edge Function config: 512MB memory, 30s max duration. |

## API Contract

**POST /api/chat** — all responses include `Access-Control-Allow-Origin: *`.

```
Request:  { frame: "data:image/jpeg;base64,...", text: "用户说的话" }
200 OK:   { text: "AI 回复", error: null }
400:      { text: null, error: "缺少 text 参数" }  // or frame missing, bad format, image too large
405:      { text: null, error: "仅支持 POST" }
500:      { text: null, error: "AI 响应超时（超过25秒），请重试" }  // or other server errors
```

## Key Constraints

- **No extra npm dependencies** — Vite is the only one. Tailwind via CDN `<script>` tag, not PostCSS.
- **Backend uses native `fetch()`** — Edge Function's V8 isolate has no Node.js stdlib; OpenAI SDK won't work.
- **API Key lives only in Vercel environment variables** — never in code, `.env`, or git. Use `vercel env add`.
- **Web Speech API (frontend only)** — no audio sent to backend. Request body is `{ frame, text }` only.
- **`<video>` must have `muted` attribute** — or Chrome blocks Web Speech from accessing the mic alongside the video stream.
- **`recognition.start()` must be called inside a `mousedown` handler** — Chrome requires speech recognition be triggered by a user gesture.
- **`isProcessing` lock** — prevents double-submission during recording or while waiting for AI reply.
- **Dispose and recreate `SpeechRecognition` instance** on each use — never reuse.
- **Frame is 640×480 JPEG at quality 0.6** — captured via hidden `<canvas>`, sent as base64 data URL. Base64 length capped at 200KB server-side.

## Frontend State Machine

```
IDLE → (mousedown) → RECORDING → (mouseup) → SENDING → (response) → IDLE
Button:              Button:                 Button:
"🎤 按住说话"        "🔴 录音中...松开发送"   "⏳ AI 思考中..."
```

Errors (no speech detected, API failure, timeout) display red text for 3 seconds, then return to IDLE.

## Deployment

```bash
npm i -g vercel && vercel login
vercel env add OPENAI_API_KEY     # paste key
vercel env add OPENAI_BASE_URL    # paste URL
vercel --prod
```
