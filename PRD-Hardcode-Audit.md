---
title: 硬编码审计 — 可配置性 · 可扩展性 · 可维护性
project: AI 视觉对话助手
date: 2026-06-14
scope: 全部 10 个源文件
---

# 硬编码审计报告

---

# 一、发现的硬编码问题

## 1.1 System Prompt（Prompt 字符串）

| 位置 | 写死内容 | 行数 |
|------|----------|------|
| `api/chat.js` `buildMessages()` | 对话 System Prompt：`你是视觉对话助手。用户给你一张摄像头画面...150字以内...` | ~6 行 |
| `api/chat.js` `handleMonitor()` | 监测默认 Prompt：`你是实时视觉监测助手...20字以内...` | ~7 行 |
| `js/settings.js` 常量 | 监测默认 Prompt 副本：相同文字 | 1 行 |

**问题**：用户无法修改对话 AI 的行为指令。想改"150 字"或"口语化"？改不了。想换成英文 Prompt？改不了。

**已解决**：监测 Prompt 已可配置（settings.monitorPrompt）。但对话 Prompt 仍硬编码。

## 1.2 LLM 参数（max_tokens / temperature）

| 位置 | 写死内容 | 影响 |
|------|----------|------|
| `api/chat.js` 非流式 `llmDashScope()` | `max_tokens: 300, temperature: 0.7` | 主对话回复长度和创造性 |
| `api/chat.js` 流式 `handleStream()` | `max_tokens: 300, temperature: 0.7` | 同上 |
| `api/chat.js` ping | `max_tokens: 5` | 测试连接 |

**问题**：用户无法调整对话的回复长度或创造性。想让它更啰嗦（500 tokens）或更保守（temperature 0.3）——做不到。

**已解决**：监测端点已支持 `body.maxTokens` 和 `body.temperature`。但主对话端点未支持。

## 1.3 超时和限流

| 位置 | 写死值 | 影响 |
|------|--------|------|
| `api/chat.js` 百度 ASR | `20_000` (20s) | 长录音超时 |
| `api/chat.js` LLM 流式 | `25_000` (25s) | 大模型慢响应 |
| `api/chat.js` LLM 非流式 | `20_000` (20s) | 同上 |
| `api/chat.js` DashScope ASR 上传 | `15_000` (15s) | 大音频 |
| `api/chat.js` 轮询 | `5_000` (5s) × 10 次 | ASR 识别 |
| `api/chat.js` TTS | `15_000` (15s) | 语音合成 |
| `api/chat.js` OAuth | `5_000` (5s) | 鉴权 |
| `vercel.json` | `maxDuration: 30` | 绝对硬顶 |

## 1.4 对话和 UI 限制

| 位置 | 写死值 | 影响 |
|------|--------|------|
| `app.js` | `MAX_HISTORY = 12` | 对话轮数不可调整 |
| `index.html` | `width="640" height="480"` | 画面分辨率 4:3 固定 |
| `index.html` | `max-height: 360px` | 视频容器高度 |
| `index.html` | `max-h-[260px]` | 消息列表高度 |
| `app.js` | `getUserMedia({ video: { width: 640, height: 480 } })` | 摄像头分辨率固定 |
| `monitor.js` | `32×24` 缩略图尺寸 | 变化检测精度 |

## 1.5 ASR 和 TTS 参数

| 位置 | 写死值 | 影响 |
|------|--------|------|
| `api/chat.js` 百度 ASR | `format: 'pcm', rate: 16000, dev_pid: 1537` | 只支持 PCM 16kHz 普通话 |
| `api/chat.js` TTS | `spd: '5', pit: '5', vol: '5', per: '0', aue: '3'` | 语速/音调/音量/音色固定 |

## 1.6 Provider 元数据

| 位置 | 写死内容 |
|------|----------|
| `api/chat.js` `handleProviders()` | LLM 模型列表硬编码：`['qwen-vl-plus', 'qwen-vl-max']` |
| `api/chat.js` `handleProviders()` | Provider 列表硬编码 |

## 1.7 前端默认值

| 位置 | 写死值 |
|------|--------|
| `settings.js` | `model: 'qwen-vl-plus'` |
| `settings.js` | `asrProvider: 'baidu'` |
| `settings.js` | `llmProvider: 'dashscope'` |
| `settings.js` | `ttsProvider: 'baidu'` |
| `settings.js` | `frameQuality: 0.6` |
| `settings.js` | `monitorInterval: 2000` |
| `settings.js` | `monitorThreshold: 0.03` (通过 `parseFloat` 默认转为 3) |
| `monitor.js` | `interval: 2000, cooldown: 5000, threshold: 0.03` |

---

# 二、分类评估

## 2.1 应该暴露给用户（UI 可配置）

| 项目 | 当前状态 | 建议 |
|------|:--:|------|
| **对话 System Prompt** | ❌ 后端硬编码 | 参照监测 Prompt，设置面板新增 textarea |
| **对话 max_tokens** | ❌ 后端硬编码 300 | 设置面板滑块（50-500） |
| **对话 temperature** | ❌ 后端硬编码 0.7 | 设置面板滑块（0.1-1.0） |
| **对话历史轮数** | ❌ `MAX_HISTORY=12` | 设置面板（4-20 轮） |
| **摄像头分辨率** | ❌ 640×480 固定 | 设置面板（480p/720p/1080p） |
| **帧质量** | ✅ 已有滑块 | — |
| **TTS 参数** | ❌ 语速/音调/音量固定 | 设置面板（可选，降低复杂度） |

## 2.2 应该配置化（settings 但不需要 UI）

| 项目 | 当前状态 | 建议 |
|------|:--:|------|
| **百度 ASR 参数** | ❌ `dev_pid: 1537` | 移到 settings 或 backend config |
| **TTS 参数** | ❌ `spd/pit/vol` | 移到 settings |
| **监控缩略图尺寸** | ❌ `32×24` | 可配但不需要 UI |
| **默认 Provider** | ❌ `'baidu'/'dashscope'` | /api/providers 返回的第一个作为默认 |

## 2.3 应该接口化（代码级可替换）

| 项目 | 当前状态 | 建议 |
|------|:--:|------|
| **对话 Prompt 模板** | ❌ 后端硬编码字符串 | 接受请求参数 `systemPrompt` |
| **变化检测算法** | ❌ 像素比较写死 | 接口化，允许替换为其他算法 |
| **相似度去重算法** | ❌ bigram 写死 | 接口化 |

---

# 三、优先级最高的改进项

按收益/成本排序：

| 优先级 | 改进项 | 用户影响 | 工作量 |
|:--:|--------|:--:|:--:|
| **P0** | 对话 `max_tokens` + `temperature` 可配置 | 高 — 控制回复长度和创造性 | ~30min |
| **P0** | 对话 System Prompt 可配置 | 高 — 自定义 AI 行为和回答风格 | ~1h |
| **P1** | 默认 Provider 从 API 元数据推导，不硬编码 `'baidu'/'dashscope'` | 中 — 加新 Provider 时不需要改前端默认值 | ~1h |
| **P1** | LLM 模型列表从请求体或后端配置读取，不硬编码 `['qwen-vl-plus', 'qwen-vl-max']` | 中 — 新模型上线时只需改后端 | ~30min |
| **P2** | 对话历史轮数可配置 | 低 — 大多数用户不需要调 | ~20min |
| **P2** | TTS 语速/音调可配置 | 低 — 锦上添花 | ~30min |

---

# 四、当前可配置 vs 仍硬编码的对比

```
已可配置 ✅                          仍硬编码 ❌
─────────────────────              ─────────────────────
监测 Prompt (settings)             对话 Prompt (api/chat.js)
监测 max_tokens/temperature        对话 max_tokens/temperature
监测间隔/阈值/冷却                 对话历史轮数
帧质量                             摄像头分辨率
ASR/LLM/TTS Provider 选择          百度 ASR dev_pid
LLM 模型 (下拉)                     TTS 语速/音调/音量
TTS 开关                           百度 ASR format/rate
Personal Context (System Prompt)   变化检测算法
Storage Backend                    监控缩略图尺寸
```

**结论**：监测系统（Phase 6）的参数化做得很好，几乎所有参数都已暴露给用户。但主对话系统（Phase 1-4 的基础能力）仍然有大量硬编码——这些是更核心的用户体验控制器。
