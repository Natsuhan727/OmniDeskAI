---
title: PRD - Phase 7 — 去硬编码 & 用户可配置化
project: AI 视觉对话助手
phase: 7
status: ready-to-build
created: 2026-06-14
target: AI agent
requires: Phase 1-6 已完成
---

# PRD: AI 视觉对话助手 — Phase 7

> **Phase 7 目标**：消除主对话系统中的硬编码，将核心对话参数暴露给用户配置，提升项目的可定制性和可维护性。

---

# 第一部分：功能清单

## M0: 修复 model 不透传 Bug (P0, 前置)

| 属性 | 内容 |
|------|------|
| **作用** | 修复用户选择的模型在非流式/流式路径中不生效的 Bug |
| **用户价值** | 用户选的模型真正生效 |
| **技术复杂度** | 低 |
| **依赖** | 无 |

### 功能详述

**当前 Bug**：
- `api/chat.js` 的 `llmDashScope()` 第 681 行：`const model = process.env.LLM_MODEL || 'qwen-vl-plus'`
- 完全忽略请求体中的 `body.model`，始终用环境变量
- 非流式降级路径和流式路径均受影响

**修复**：
- `llmDashScope()` 改为：`const model = body.model || process.env.LLM_MODEL || 'qwen-vl-plus'`
- `handleStream()` 同理
- model 从请求体读取，`personalContext` 已透传，一并规范化

### 验收标准

- [ ] 设置面板选 `qwen-vl-max` → 对话使用 `qwen-vl-max`
- [ ] 设置面板选 `qwen-vl-plus` → 对话使用 `qwen-vl-plus`
- [ ] 流式和非流式两端点均生效

---

## M1: 对话 System Prompt 可配置 (P0)

| 属性 | 内容 |
|------|------|
| **作用** | 用户自定义对话 AI 的行为指令 |
| **用户价值** | 控制 AI 的回答风格、长度、语气、角色 |
| **技术复杂度** | 低 |
| **依赖** | 无 |

### 功能详述

参照 Phase 6 监测 Prompt 的可配置模式，在设置面板新增对话 Prompt textarea。

**前端**：
- `settings.js` 新增 `chatPrompt` 属性，默认值 = 当前后端硬编码的 Prompt 文本
- 设置面板"对话"标签页新增 textarea
- `chat-api.js` 的 `buildBody()` 携带 `chatPrompt` 到请求体

**后端**：
- `api/chat.js` 的 `buildMessages()` 接受 `chatPrompt` 参数
- 如果请求体携带 `chatPrompt`：**完全替换** System Prompt 的行为指令部分
- `personalContext` 无论 `chatPrompt` 是否存在，都作为 `[用户自定义上下文]` 段落追加
- 未携带时使用现有默认 Prompt（向后兼容）

**与 `personalContext` 的分工**：
- `chatPrompt`：控制 AI **怎么说话**（角色、风格、字数、语言）
- `personalContext`：告诉 AI **用户是谁**（个人信息、偏好）
- 两者独立，但都注入到 System Prompt

```
System Prompt 结构：
┌──────────────────────────────┐
│ chatPrompt (或默认行为指令)   │  ← M1 控制
│                              │
│ [用户自定义上下文]             │  ← Phase 5 personalContext
│ 我是张三，大一学生...         │
└──────────────────────────────┘
```

### 验收标准

- [ ] 设置面板新增"对话 Prompt" textarea，预填默认值
- [ ] 修改 Prompt 后保存，下次对话生效
- [ ] 对话 AI 的行为遵循自定义 Prompt（如"用英文回答"→ AI 用英文）
- [ ] 未填写时与 Phase 6 行为完全一致

---

## M2: 对话 max_tokens 可配置 (P0)

| 属性 | 内容 |
|------|------|
| **作用** | 用户控制 AI 回复的最大长度 |
| **用户价值** | 想要简短回答或长篇解释，用户决定 |
| **技术复杂度** | 低 |
| **依赖** | 无 |

### 功能详述

**前端**：
- `settings.js` 新增 `chatMaxTokens` 属性，默认 300
- 设置面板新增滑块（50-500，步长 50）
- `chat-api.js` 的 `buildBody()` 携带 `maxTokens`

**后端**：
- `api/chat.js` 非流式：`max_tokens: body.maxTokens || 300`
- `api/chat.js` 流式：同上
- `api/chat.js` `llmDashScope()`：同上

### 验收标准

- [ ] 设置面板滑块调整到 100 → AI 回复明显变短
- [ ] 调整到 500 → AI 回复明显变长
- [ ] 默认 300 时与 Phase 6 行为一致

---

## M3: 对话 temperature 可配置 (P0)

| 属性 | 内容 |
|------|------|
| **作用** | 用户控制 AI 回复的创造性 |
| **用户价值** | 想要精确回答（低温）或创意回答（高温） |
| **技术复杂度** | 低 |
| **依赖** | 无 |

### 功能详述

**前端**：
- `settings.js` 新增 `chatTemperature` 属性，默认 0.7
- 设置面板新增滑块（0.1-1.0，步长 0.1）
- `chat-api.js` 的 `buildBody()` 携带 `temperature`

**后端**：
- `api/chat.js` 非流式/流式：`temperature: body.temperature ?? 0.7`

### 验收标准

- [ ] 滑块调到 0.1 → AI 回答更精确、更一致
- [ ] 滑块调到 1.0 → AI 回答更多样、更有创造性
- [ ] 默认 0.7 时与 Phase 6 行为一致

---

## M4: 对话 UI 放在设置面板对应位置 (P0)

| 属性 | 内容 |
|------|------|
| **作用** | 对话 Prompt / max_tokens / temperature 的 UI |
| **用户价值** | 与监测设置并列，清晰可区分 |
| **技术复杂度** | 低 |
| **依赖** | M1, M2, M3 |

### 功能详述

在设置面板新增第三个标签页：「💬 对话」。现有标签页：
- 🔑 服务（ASR/LLM/TTS Provider 配置）
- 🧠 AI 记忆（Personal Context / 监测 Prompt）
- 💬 对话（新增：对话 Prompt / max_tokens / temperature）

**注意**：AI 记忆标签页目前只有一个"自定义 System Prompt" textarea 和一个"监测 Prompt" textarea。应将对话 Prompt 放在新增的"对话"标签页中，与监测 Prompt 分开。

### 验收标准

- [ ] 设置面板显示 3 个标签页
- [ ] "对话"标签页包含：对话 Prompt textarea + max_tokens 滑块 + temperature 滑块
- [ ] 所有设置持久化到 localStorage
- [ ] 切换到对话标签页时自动刷新最新值

---

## M5: 默认 Provider 从后端元数据推导 (P1)

| 属性 | 内容 |
|------|------|
| **作用** | 前端不再硬编码 `'baidu'` / `'dashscope'` 作为默认值 |
| **用户价值** | 新增 Provider 时不需要改前端代码 |
| **技术复杂度** | 低 |
| **依赖** | 无 |

### 功能详述

**当前问题**：
```js
// settings.js — 硬编码默认值
get asrProvider() { return localStorage.getItem('asr_provider') || 'baidu'; }
```

**问题**：不能简单改成 `providerMeta.asr[0].id`——`providerMeta` 异步加载，getter 同步调用时还是空数组。

**正确做法**：在 `initSettingsPanel()` 的 `providerMeta` 加载完成后，主动将默认值写入 localStorage（仅当用户从未手动设置过）。

```js
// initSettingsPanel() 中，providerMeta 加载完成后：
function applyProviderDefaults(meta) {
  // 如果用户从未手动选择过 Provider，写入后端返回的第一个作为默认值
  if (!localStorage.getItem('asr_provider') && meta.asr?.[0]) {
    localStorage.setItem('asr_provider', meta.asr[0].id);
  }
  if (!localStorage.getItem('llm_provider') && meta.llm?.[0]) {
    localStorage.setItem('llm_provider', meta.llm[0].id);
  }
  if (!localStorage.getItem('tts_provider') && meta.tts?.[0]) {
    localStorage.setItem('tts_provider', meta.tts[0].id);
  }
  // 同理：model 默认值
  if (!localStorage.getItem('model') && meta.llm?.[0]?.models?.[0]) {
    localStorage.setItem('model', meta.llm[0].models[0]);
  }
}
```

getter 本身保持 `localStorage.getItem('xxx') || hardcoded_fallback` 不变——仅兜底极端情况。

### 验收标准

- [ ] 首次使用 → providerMeta 加载后自动写入 localStorage 默认值
- [ ] 用户手动选择后 → 以用户选择为准，不覆盖
- [ ] getter 的硬编码兜底仅用于 providerMeta 未加载的极短窗口期
- [ ] 不影响已有功能

---

## M6: LLM 模型列表从后端读取 (P1)

| 属性 | 内容 |
|------|------|
| **作用** | 前端不硬编码 `['qwen-vl-plus', 'qwen-vl-max']` |
| **用户价值** | 新模型上线只需改后端 |
| **技术复杂度** | 低 |
| **依赖** | 无 |

### 功能详述

**当前状态**：`/api/providers` 已经返回了 LLM 的 `models` 字段，前端 `renderSection()` 也已经动态读取 `provider.models` 来渲染模型下拉。但 `settings.js` 的默认值硬编码了：

```js
get model() { return localStorage.getItem('model') || 'qwen-vl-plus'; }
```

**修改为**：默认值从 `providerMeta` 推导，用第一个 Provider 的第一个模型。

### 验收标准

- [ ] 未配置时默认取后端返回的第一个模型
- [ ] 手动选择后以用户选择为准

---

## M7: TTS 参数可配置 (P2, Baidu-only)

| 属性 | 内容 |
|------|------|
| **作用** | 用户调整语速、音调、音量 |
| **用户价值** | 个性化语音体验 |
| **技术复杂度** | 低 |
| **依赖** | 无 |

> ⚠️ 此功能仅对百度 TTS Provider 生效。非百度 TTS 时相关 UI 灰显。

### 功能详述

**前端**：
- `settings.js` 新增 `ttsSpeed`(默认 5)、`ttsPitch`(默认 5)、`ttsVolume`(默认 5)
- 设置面板服务标签页新增 TTS 高级选项（折叠，默认隐藏）
- `chat-api.js` 的 `buildBody()` 携带 TTS 参数

**后端**：
- `api/chat.js` TTS 端点读取 `body.tts_speed || 5` 等参数

### 验收标准

- [ ] 语速调到 1 → 语音明显变慢
- [ ] 音调调到 9 → 语音明显变高
- [ ] 默认值 5 与 Phase 6 行为一致

---

# 第二部分：实施计划

## 新增/修改文件

```
js/settings.js      (修改) — +chatPrompt +chatMaxTokens +chatTemperature +ttsSpeed/Pitch/Volume
js/chat-api.js      (修改) — buildBody() 携带新参数
api/chat.js         (修改) — buildMessages() 接受 chatPrompt, maxTokens, temperature
index.html          (修改) — 设置面板新增"对话"标签页 + TTS 高级选项
```

## 实施顺序

```
Step 0: M0 修 Bug — llmDashScope + handleStream model 透传    ~15min  ★ 必须先做
Step 1: M1+M2+M3 后端一起 (api/chat.js)                       ~20min
Step 2: M1+M2+M3 前端一起 (settings.js + chat-api.js)         ~20min
Step 3: M4 对话标签页 UI (index.html + settings.js)           ~30min
Step 4: M5+M6 默认值推导 (settings.js initSettingsPanel)      ~15min
Step 5: M7 TTS 参数 (可选, settings.js + api/chat.js)         ~20min
```

**总工作量：~2h（M0-M6），~2.5h（含 M7）**

---

# 第三部分：验收清单

## M0: 修复 model 不透传 Bug

- [ ] 流式和非流式路径均使用请求体中的 model
- [ ] 设置面板切模型后对话生效
- [ ] 向后兼容（不传 model 时用环境变量兜底）

## M1: 对话 System Prompt

- [ ] 设置面板"对话"标签页有 Prompt textarea
- [ ] 预填默认值（当前后端硬编码的文本）
- [ ] `personalContext` 仍独立追加（不被 chatPrompt 覆盖）
- [ ] 未填写时向后兼容

## M2: 对话 max_tokens

- [ ] 设置面板滑块 50-500
- [ ] 默认 300
- [ ] 调整后生效

## M3: 对话 temperature

- [ ] 设置面板滑块 0.1-1.0
- [ ] 默认 0.7
- [ ] 调整后生效

## M4: 对话 UI 标签页

- [ ] 3 个标签页切换正常
- [ ] "对话"标签页含所有对话参数
- [ ] 持久化正常

## M5: 默认 Provider 推导

- [ ] `asrProvider` 默认取 `/api/providers` 第一个
- [ ] `llmProvider` 同上
- [ ] `ttsProvider` 同上

## M6: 默认模型推导

- [ ] `model` 默认取第一个 Provider 的第一个模型
- [ ] 手动选择后优先

## M7: TTS 参数

- [ ] 语速/音调/音量可调
- [ ] 默认 5，与 Phase 6 一致

---

> **给 AI agent**：
> 
> 实现顺序：M2+M3 后端 → M1 后端 → M2+M3 前端 → M1 前端 → M4 UI → M5 → M6 → M7。
> 
> 关键原则：
> 1. 所有新增设置遵循现有 settings 单例模式（localStorage getter/setter）
> 2. 后端所有新参数都是可选的，缺省时使用当前硬编码值
> 3. chatPrompt 传 `null` 或不传时，后端用现有默认 Prompt
> 4. UI 风格与现有 Tailwind 暗色主题一致
> 5. 不修改 vercel.json
> 6. 向后兼容——所有新参数缺省时与 Phase 6 行为完全一致
