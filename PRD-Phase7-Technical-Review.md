---
title: Phase 7 PRD — 技术审查
project: AI 视觉对话助手
reviewer: Architect
date: 2026-06-14
---

# Phase 7 PRD 技术审查

> 纯技术视角，不讨论产品价值，只审视架构正确性和实现可行性。

---

## 总体评价：方向正确，有 4 个技术问题需要修正

---

# 一、发现的问题

## 问题 1：M5 存在竞态条件（Race Condition）

**PRD 方案**：
```js
get asrProvider() {
  return localStorage.getItem('asr_provider')
    || (providerMeta.asr?.[0]?.id)
    || 'baidu';
}
```

**问题**：`providerMeta` 在 `initSettingsPanel()` 中异步赋值（`fetch('/api/providers')`）。而 `settings.asrProvider` 在 `chat-api.js` 的 `buildBody()` 中同步调用——此时 `providerMeta` 极大概率是 `{ asr: [], llm: [], tts: [] }`（初始值）。

**结果**：`providerMeta.asr` 为空数组 → `[0]` 是 `undefined` → 回退到 `'baidu'` → 等于没改。

**修复方案**：
```js
// 方案 A: 初始化时同步从 /api/providers 获取，阻塞渲染
// 方案 B: settings 初始化后再使用，不使用 getter 中的 fallback
// 方案 C (推荐): 保持现有硬编码默认值作为"冷启动兜底"，
//    把 M5 降级为：确保 providerMeta 加载完成后覆盖 localStorage 默认值
```

**建议**：M5 改为在 `initSettingsPanel()` 的 providerMeta 加载完成后，主动将默认值写入 localStorage（如果用户未手动设置过）。getter 本身不改。

---

## 问题 2：`llmDashScope()` 忽略了请求体中的 model（Bug）

**当前代码**（`api/chat.js:681`）：
```js
const model = process.env.LLM_MODEL || 'qwen-vl-plus';
```

无论前端 `settings.model` 选了什么，非流式的 `llmDashScope()` 永远用环境变量的 model。流式端点 `handleStream()` 同样。

**影响**：即使用户在设置面板选了 `qwen-vl-max`，非流式降级路径仍然用默认模型。

**修复**：Model 应通过 `llmCfg` 传递，或作为独立参数。Phase 7 PRD 应包含此修复，因为它直接影响"用户可配置模型"是否真正生效。

```js
// 正确做法：
const model = body.model || process.env.LLM_MODEL || 'qwen-vl-plus';
```

---

## 问题 3：`chatPrompt` 与 `personalContext` 功能重叠

*   **`personalContext`**（Phase 5）：用户自定义文本 → 注入到 System Prompt → `[用户自定义上下文]\n...`
*   **`chatPrompt`**（Phase 7 新增）：用户自定义文本 → 替换整个 System Prompt

两者都是"用户写的文字注入到 System Prompt"。区别仅在于一个替换整体、一个追加。从 UI 角度，用户很难理解"自定义 System Prompt"和"对话 Prompt"的区别——它们完全可以合并为一个 textarea（控制整个 System Prompt）。

**建议**：`chatPrompt` 直接替代整个 System Prompt（包括行为指令和字数限制），`personalContext` 保留作为追加段落。这样分工清晰：
- `chatPrompt`：控制 AI 怎么说话（你是XX，用英文回答，150字以内）
- `personalContext`：告诉 AI 用户是谁（我是张三，大一学生）

PRD 应明确这个分工。

---

## 问题 4：遗漏了 `chatPrompt` 后端实现的一个边缘情况

当前 `buildMessages()` 中的 System Prompt 是**一个数组**（`systemParts`），通过 `join(' ')` 合并。`personalContext` 作为额外段落追加。

如果 `chatPrompt` 提供，是替换整个 `systemParts` 还是仅替换第一段（行为指令）？PRD 只说"替换默认 Prompt"，但没说明 `personalContext` 是否仍应注入。

**建议**：明确规定——
```js
if (chatPrompt) {
  systemParts = [chatPrompt];  // 完全替换
} else {
  systemParts = [DEFAULT_PROMPT];
}
// personalContext 无论哪种情况都追加
if (personalContext) systemParts.push(`[用户自定义上下文]\n${personalContext}`);
```

---

# 二、PRD 中未覆盖的重要硬编码

| 遗漏项 | 位置 | 影响 |
|--------|------|------|
| **非流式 `llmDashScope()` 忽略 `body.model`** | `api/chat.js:681` | 用户选的模型不生效（Bug） |
| **流式 `handleStream()` 的 model** | `api/chat.js:156` | 同上 |
| **`MAX_HISTORY=12`** | `app.js:55` | 对话轮数不可调 |
| **摄像头 `640×480`** | `app.js:328` 和 `index.html:21` | 分辨率固定 |

`MAX_HISTORY` 和摄像头分辨率是 P2，可以不在 MVP 做。但 model bug 是 P0——必须在 Phase 7 修掉。

---

# 三、技术可行性

所有 M1-M7 的技术实现都是 **低复杂度**。本质上是在现有架构上增加参数传递：

```
settings.js (getter/setter) → chat-api.js (buildBody) → api/chat.js (read body.xxx || default)
```

这是 Phase 4 已验证的模式（ASR Key、LLM Key 等都是从 body 传的），不存在技术风险。

唯一需要注意的是 `chatPrompt` 会改变 `buildMessages()` 的行为——这是一个后端侧的核心函数。需要仔细测试向后兼容性（`chatPrompt` 缺省时完全不变）。

---

# 四、实施建议调整

| 原 PRD 顺序 | 建议调整 |
|-------------|----------|
| M2+M3 后端 → M1 后端 → 前端 | **先修 Bug（model 透传）** → M1+M2+M3 后端一起 → M1+M2+M3 前端一起 |
| M5 默认 Provider 推导 | 改为"初始化时写入 localStorage 默认值"，避免竞态 |
| M7 TTS 参数 | 标注为"Baidu-only"，非百度 TTS 时灰显 |

---

# 五、结论

Phase 7 PRD 的**方向正确**——消除主对话系统的硬编码是必要的。7 个功能点中有 6 个技术完全可行。有 1 个（M5）需要在实现方式上调整以避免竞态。另有 1 个现有 bug（model 不透传）必须在 Phase 7 一并修复。
