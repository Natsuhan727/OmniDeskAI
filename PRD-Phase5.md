---
title: PRD - Phase 5 — 记忆与对话管理系统 (VCM)
project: AI 视觉对话助手
phase: 5
status: ready-to-build
created: 2026-06-14
updated: 2026-06-14
target: AI agent
requires: Phase 1-4 已完成
architect_review: PRD-Phase5-Technical-Review.md
---

# PRD: AI 视觉对话助手 — Phase 5

> **Phase 5 目标**：构建 **Visual Context Memory (VCM)** ——一个极简、视觉优先、零检索开销的记忆系统。让 AI 从"一次性工具"进化为"认识你的工具"。

> ⚠️ **实现前必读**：[[PRD-Phase5-Technical-Review.md]] — Chief Architect 审查报告。解释了为什么砍掉了原方案的过度设计部分。

---

# 第一部分：架构概览

## 1. 设计哲学

| 原则 | 含义 |
|------|------|
| **视觉优先** | 记忆的核心是"用户在什么场景、看什么类型的物体" |
| **极简分层** | 2 层，不是 3 层。全量注入，不做语义检索 |
| **本地零依赖** | 仅用 localStorage + 现有 LLM。不引入 Vector DB / embedding 模型 |
| **AI 自主管理** | AI 自动更新记忆，用户只需偶尔审查 |
| **全量注入** | 记忆足够少（~500 tokens），直接注入 System Prompt，跳过检索 |

## 2. 核心架构：Visual Context Memory (VCM)

```
┌──────────────────────────────────────────┐
│          VISUAL CONTEXT MEMORY           │
├──────────────────┬───────────────────────┤
│  Session Context │  Personal Context     │
│  (本次会话)      │  (跨会话持久)         │
├──────────────────┼───────────────────────┤
│ • 当前图像帧     │ • profile (~3条)      │
│ • 最近 6 轮对话  │ • preferences (~3条)  │
│ • 本轮文字       │ • visualDomains (~5条)│
│                  │ • usagePatterns(~3条) │
│                  │ • aiNotes (~10条)     │
│                  │                       │
│ 存储: 内存       │ 存储: localStorage    │
│ 容量: ~3KB       │ 容量: ~2KB           │
│ 注入: 对话消息   │ 注入: System Prompt   │
└──────────────────┴──────────────────────┘
```

### 为什么是两层？

- **Session Context**：当前对话的实时窗口。Phase 4 已有 `conversationHistory`（6 条，3 轮），Phase 5 扩展到 12 条（6 轮）+ 持久化。
- **Personal Context**：跨会话的累积认知。核心数据 < 500 tokens，全量注入到每次请求的 System Prompt。

不再需要"对话管理"中间层——视觉助手是单一持续的关系，不需要多会话切换、对话归档等项目管理功能。

---

# 第二部分：数据模型

## 1. Session Context（继承 Phase 4，扩展+持久化）

Phase 4 已有的 `conversationHistory[]` 内存数组：
- 最多 6 条（3 轮），刷新丢失
- `buildApiHistory()` 只保留最近一条用户消息的帧

**Phase 5 变更**：

```js
// js/app.js — conversationHistory 变更

// 容量：6 条 → 12 条（6 轮）
const MAX_HISTORY = 12;

function addToHistory(role, text, frame) {
  conversationHistory.push({
    role,
    text,
    ...(frame ? { frame } : {}),
    timestamp: Date.now(),  // 新增：时间戳
  });
  while (conversationHistory.length > MAX_HISTORY) {
    conversationHistory.shift();  // 最旧的直接丢弃（不是压缩，P0 阶段不需要）
  }
}


// 持久化：
//   - 每条消息发送后，保存 conversationHistory 到 localStorage
//   - 页面 init() 时从 localStorage 恢复
//   - key: "omni_session"
```

```js
// localStorage key: "omni_session"
{
  conversationHistory: [
    { role: "user", text: "这是什么？", frame: "data:image/...", timestamp: 1718300000000 },
    { role: "assistant", text: "这是一个...", timestamp: 1718300000010 },
    // ... 最多 12 条
  ],
  lastActiveAt: 1718300000123,
}
```

**关键简化**：P0 阶段不实现压缩。对话超过 12 条时，最旧的直接丢弃。视觉助手的使用模式（快速、短对话）决定了这已经足够。

## 2. Personal Context（全新）

```js
// localStorage key: "omni_personal_context"
{
  version: 1,
  updatedAt: 1718300000000,

  // ── 我是谁 ──
  profile: {
    name: null,          // 例: "小明"
    role: null,          // 例: "大一学生, 中北大学, 智能测控工程专业"
    language: "zh-CN",   // 固定值，从 settings 同步
  },

  // ── 我怎么用 ──
  preferences: {
    responseStyle: "简洁",     // "简洁" | "详细" | "口语化"
    responseLength: "短",      // "短"(~50字) | "中"(~100字) | "长"(~150字)
    technicalLevel: "intermediate",  // "beginner" | "intermediate" | "expert"
  },

  // ── 我看什么（视觉特有）──
  visualDomains: [
    // AI 从对话中推断用户经常看的物体/场景类型
    // { domain: "电子产品", weight: 0.8, lastSeen: 1718300000000 },
  ],

  // ── 我在哪用（视觉特有）──
  usagePatterns: {
    typicalLighting: null,   // "bright_outdoor" | "indoor" | "dim"
    typicalDistance: null,   // "close" | "mid" | "far"
    // 从帧像素特征推断，不由用户填写
  },

  // ── AI 对我的认知 ──
  aiNotes: [
    // 自由文本，AI 自动维护
    // "用户经常在桌面上使用，可能是在宿舍/实验室"
    // "用户对电子元件感兴趣，可能是专业课相关"
    // "用户偏好一句话回答而非段落"
  ],
}
```

### 数据模型设计理由

| 决策 | 理由 |
|------|------|
| **`aiNotes`（自由文本）替代结构化 `facts` 数组** | 数据量 < 20 条时，自由文本比结构化数组更灵活、更简单。类似 Claude 的 CLAUDE.md 模式 |
| **`visualDomains` 权重机制** | 记录用户频繁关注的视觉领域。注入 System Prompt 后可引导 VLM 给出更精准的回答 |
| **`usagePatterns` 从帧推断** | 不依赖用户告知。从图像像素统计中自动学习使用环境 |
| **无 `projects` / `decisions` / `knowledge` 等** | 这是视觉助手，不是项目管理和知识库工具 |
| **无 `confidence` / `source` 字段** | 数据量少时，追踪来源和置信度的开销大于收益 |

---

# 第三部分：记忆管线

## 1. 记忆注入（每条消息发送时）

```
用户按下按钮说话
  │
  ▼
1. 从 localStorage 读取 personalContext
2. 序列化为 System Prompt 前缀文本
3. 拼接到 api/chat.js buildMessages() 的 system 消息中
4. LLM 获得上下文 → 生成更个性化的回答
```

### System Prompt 注入格式

```
你是视觉对话助手。用户给你摄像头画面和一个问题。
结合画面简洁回答。不编造不存在的内容。不确定时诚实说明。
不需要"我看到了..."开场白，直接回答。

[关于用户]
- 小明，大一学生，中北大学，智能测控工程专业
- 偏好简洁回答，一句话长度
- 技术基础：中级
- 经常看的领域：电子产品、植物
- 通常在室内桌面使用，中等距离

[AI 对用户的认知]
- 用户经常在桌面上使用，可能是在宿舍/实验室
- 用户对电子元件感兴趣，可能是专业课相关
- 用户偏好一句话回答而非段落
```

### 实现：修改 `buildMessages()`

```js
// api/chat.js — buildMessages() 扩展

function buildMessages(frame, text, history, personalContext) {
  let systemContent = [
    '你是视觉对话助手。用户给你摄像头画面和一个问题。',
    '结合画面简洁回答。150字以内，口语化，中文。',
    '不编造不存在的内容。不确定时诚实说明。',
    '不需要"我看到了..."开场白，直接回答。',
  ];

  // ── 注入 Personal Context ──
  if (personalContext) {
    const ctx = buildPersonalContextPrompt(personalContext);
    if (ctx) systemContent.push(ctx);
  }

  const messages = [{ role: 'system', content: systemContent.join('\n\n') }];

  // ... 其余消息构建逻辑（与 Phase 4 相同）
}

function buildPersonalContextPrompt(pc) {
  const lines = [];
  
  // Profile
  const profileParts = [];
  if (pc.profile?.name) profileParts.push(pc.profile.name);
  if (pc.profile?.role) profileParts.push(pc.profile.role);
  if (profileParts.length) lines.push(`[关于用户]\n- ${profileParts.join('，')}`);

  // Preferences
  const prefParts = [];
  if (pc.preferences?.responseStyle) prefParts.push(`回复风格: ${pc.preferences.responseStyle}`);
  if (pc.preferences?.technicalLevel) prefParts.push(`技术基础: ${pc.preferences.technicalLevel}`);
  if (prefParts.length) lines.push(`[用户偏好]\n- ${prefParts.join('\n- ')}`);

  // Visual Domains
  if (pc.visualDomains?.length) {
    const domains = pc.visualDomains
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 3)
      .map(d => d.domain);
    lines.push(`[视觉领域] 用户经常看: ${domains.join('、')}`);
  }

  // Usage Patterns
  if (pc.usagePatterns?.typicalLighting || pc.usagePatterns?.typicalDistance) {
    const p = [];
    if (pc.usagePatterns.typicalLighting) p.push(`典型环境: ${pc.usagePatterns.typicalLighting}`);
    if (pc.usagePatterns.typicalDistance) p.push(`典型距离: ${pc.usagePatterns.typicalDistance}`);
    lines.push(`[使用习惯]\n- ${p.join('\n- ')}`);
  }

  // AI Notes
  if (pc.aiNotes?.length) {
    lines.push(`[AI 对你的认知]\n- ${pc.aiNotes.join('\n- ')}`);
  }

  return lines.join('\n\n');
}
```

## 2. 记忆更新（异步，对话完成后）

```
每条消息发送完成
  │
  ▼
1. 前端检测：本轮对话是否产生了值得记录的认知？
   → 简单规则：检测关键词 ("我是", "我偏好", "我在学", "我经常")
   → 或：每 N 轮触发一次 LLM 提取

2. 如果需要更新：
   → POST /api/personal-context/update
   → Body: { messages: 最近几轮, currentContext: 当前 personalContext }
   → 后端 LLM 分析对话，返回更新后的 personalContext

3. 前端合并更新：
   → 写入 localStorage
   → 下次对话自动使用新的 personalContext
```

### 前端规则提取（P0，可不用后端 LLM）

```js
// js/personal-context.js — 简单规则提取

function detectUpdates(messages, currentContext) {
  const updates = { aiNotes: [] };
  const fullText = messages.map(m => m.text || '').join('\n');

  // 个人信息检测
  if (/我是|我叫/.test(fullText) && !currentContext.profile.name) {
    const match = fullText.match(/(?:我是|我叫)([^，。,\n]{2,10})/);
    if (match) updates.profile = { name: match[1] };
  }
  if (/我在.*(?:大学|学院|学校)/.test(fullText) && !currentContext.profile.role) {
    const match = fullText.match(/我在([^，。,\n]{5,30}(?:大学|学院|学校)[^，。,\n]{0,30})/);
    if (match) updates.profile = { ...updates.profile, role: match[1] };
  }

  // 偏好检测
  if (/简[短洁]|一句话/.test(fullText)) {
    updates.preferences = { responseStyle: '简洁', responseLength: '短' };
  }
  if (/详细|多说|展开/.test(fullText)) {
    updates.preferences = { responseStyle: '详细', responseLength: '长' };
  }

  return updates;
}
```

### 后端 LLM 提取（P1，规则不够用时）

```
POST /api/personal-context/update

Body: {
  messages: [
    { role: "user", text: "我大一，在中北大学读智能测控工程" },
    { role: "assistant", text: "好的，记住了" },
    // ... 最近 4-6 轮
  ],
  currentContext: { /* 当前 personalContext */ },
  llm_api_key: "...",
  llm_provider: "dashscope",
  model: "qwen-turbo",  // 便宜的模型即可
}

Response: {
  updatedContext: { /* 完整的更新后 personalContext */ },
  changes: ["profile.name: null → 小明", "profile.role: null → 大一学生..."],
}
```

**后端实现要点**：
- 复用现有 `llmProviders` 注册表 + Key 透传模式
- 使用便宜的模型（qwen-turbo），减少成本
- System Prompt 明确告知：只提取稳定的事实信息，忽略一次性查询
- 合并策略：新认知覆盖旧认知（不是增量追加）

---

# 第四部分：功能清单 (MVP)

## M1: 对话持久化

| 属性 | 内容 |
|------|------|
| **作用** | 刷新页面不丢失对话 |
| **用户价值** | 这是产品 vs Demo 的分界线 |
| **实现** | 每条消息后 `localStorage.setItem("omni_session", ...)`。init() 时恢复 |
| **依赖** | 无 |
| **工作量** | ~1h |

**验收标准**：
- [ ] 对话中刷新页面 → 消息列表完整恢复
- [ ] 关闭浏览器再打开 → 对话恢复
- [ ] 帧图片在刷新后仍显示
- [ ] 最多保留 12 条消息（6 轮），超出丢弃

## M2: Personal Context 数据模型 + localStorage

| 属性 | 内容 |
|------|------|
| **作用** | 定义 Personal Context 数据结构，读写 localStorage |
| **用户价值** | 后续所有记忆功能的基石 |
| **实现** | 新文件 `js/personal-context.js`，导出 `personalContext` 单例 |
| **依赖** | 无 |
| **工作量** | ~1h |

**验收标准**：
- [ ] `personalContext.get()` 返回完整数据对象
- [ ] `personalContext.update(changes)` 合并更新
- [ ] 默认值正确（空 profile/preferences，空数组 visualDomains/aiNotes）
- [ ] 序列化/反序列化正常

## M3: Personal Context 注入 System Prompt

| 属性 | 内容 |
|------|------|
| **作用** | 每次 LLM 请求携带 Personal Context |
| **用户价值** | AI "认识你"，提供个性化回答 |
| **实现** | 扩展 `chat-api.js buildBody()` 携带 personalContext；修改 `api/chat.js buildMessages()` 注入 |
| **依赖** | M2 |
| **工作量** | ~1h |

**验收标准**：
- [ ] 请求体中包含 `personalContext` 字段
- [ ] `buildMessages()` 正确构建 System Prompt 前缀
- [ ] 空字段不产生多余文本
- [ ] 向后兼容：无 personalContext 时行为与 Phase 4 一致

## M4: Personal Context 查看与编辑 UI

| 属性 | 内容 |
|------|------|
| **作用** | 用户在设置面板查看和编辑 AI 对他的认知 |
| **用户价值** | 透明度 + 控制权。用户可以纠正错误认知 |
| **实现** | 设置面板新增"🧠 AI 记忆"标签页 |
| **依赖** | M2 |
| **工作量** | ~1.5h |

**验收标准**：
- [ ] 记忆标签页展示 profile / preferences / visualDomains / aiNotes
- [ ] 可编辑 profile 字段（文本输入框）
- [ ] 可编辑 preferences（下拉选择）
- [ ] aiNotes 以列表展示，支持逐条删除
- [ ] 修改后保存到 localStorage

## M5: AI 自动更新 Personal Context（规则路径）

| 属性 | 内容 |
|------|------|
| **作用** | AI 从对话中自动提取和更新 Personal Context |
| **用户价值** | 不需要用户手动维护，AI 自己学习 |
| **实现** | 前端正则规则 + 可选后端 LLM 端点 |
| **依赖** | M2, M3 |
| **工作量** | ~2h（P0 规则）+ ~3h（P1 LLM） |

**P0 规则提取验收标准**：
- [ ] 检测"我是/我叫/我在...大学" → 更新 profile
- [ ] 检测"简短/简洁/一句话" → 更新 preferences.responseStyle
- [ ] 检测"详细/多说/展开" → 更新 preferences.responseStyle
- [ ] 不覆盖用户手动编辑的值（需标记来源）

**P1 LLM 提取验收标准**：
- [ ] `/api/personal-context/update` 端点正常工作
- [ ] LLM 正确提取个人信息、偏好、视觉领域
- [ ] 冲突时正确更新而非重复添加
- [ ] 不存在的信息不被编造

---

# 第五部分：实施计划

## 实施顺序

```
Step 1: M1 对话持久化                     (~1h)
  修改 app.js — 每条消息后持久化到 localStorage
  修改 init() — 页面加载时恢复

Step 2: M2 Personal Context 数据模型      (~1h)
  新建 js/personal-context.js
  导出 personalContext 单例（get/update/reset）
  默认值初始化

Step 3: M3 System Prompt 注入             (~1h)
  修改 chat-api.js buildBody() — 携带 personalContext
  修改 api/chat.js buildMessages() — 注入上下文

Step 4: M4 记忆查看/编辑 UI              (~1.5h)
  修改 index.html — 设置面板新增标签页
  修改 settings.js — 初始化记忆面板

Step 5: M5 AI 自动更新（P0 规则）         (~2h)
  修改 personal-context.js — 规则提取
  在 sendToAI 完成后触发检测

Step 6: M5 AI 自动更新（P1 LLM 端点）    (~3h, 可选)
  新建 api/personal-context.js
  路由分发接入 api/chat.js
```

## 新增/修改文件清单

```
js/personal-context.js      (新增) — Personal Context 数据模型 + 规则提取
api/personal-context.js     (新增) — LLM 记忆更新端点（可选 P1）
js/app.js                   (修改) — 持久化对话 + 触发记忆更新
js/chat-api.js              (修改) — buildBody() 携带 personalContext
api/chat.js                 (修改) — buildMessages() 注入 personalContext
index.html                  (修改) — 设置面板新增记忆标签页
js/settings.js              (修改) — 初始化记忆面板
```

**不新增依赖**：全部使用浏览器原生 API + 现有 LLM。
**不修改 vercel.json**：可选 P1 端点在 api/chat.js 内路由分发。

---

# 第六部分：实现细节

## 1. `js/personal-context.js` 模块

```js
// js/personal-context.js
// Personal Context — 单例。管理跨会话的用户认知数据。

const STORAGE_KEY = 'omni_personal_context';

const DEFAULTS = {
  version: 1,
  updatedAt: 0,
  profile: { name: null, role: null, language: 'zh-CN' },
  preferences: { responseStyle: null, responseLength: null, technicalLevel: null },
  visualDomains: [],
  usagePatterns: { typicalLighting: null, typicalDistance: null },
  aiNotes: [],
};

export const personalContext = {
  _data: null,

  // ── 初始化 ──
  init() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        this._data = JSON.parse(raw);
        // 合并默认值（处理新增字段）
        this._data = { ...DEFAULTS, ...this._data };
        this._data.profile = { ...DEFAULTS.profile, ...this._data.profile };
        this._data.preferences = { ...DEFAULTS.preferences, ...this._data.preferences };
        this._data.usagePatterns = { ...DEFAULTS.usagePatterns, ...this._data.usagePatterns };
      } else {
        this._data = JSON.parse(JSON.stringify(DEFAULTS));
      }
    } catch (e) {
      console.error('[pc] init failed:', e.message);
      this._data = JSON.parse(JSON.stringify(DEFAULTS));
    }
    return this._data;
  },

  // ── 读取 ──
  get() { return this._data; },

  // ── 完整替换 ──
  set(data) {
    this._data = { ...DEFAULTS, ...data };
    this._data.updatedAt = Date.now();
    this._save();
  },

  // ── 部分更新（浅合并） ──
  update(changes) {
    if (changes.profile) Object.assign(this._data.profile, changes.profile);
    if (changes.preferences) Object.assign(this._data.preferences, changes.preferences);
    if (changes.visualDomains) this._data.visualDomains = changes.visualDomains;
    if (changes.usagePatterns) Object.assign(this._data.usagePatterns, changes.usagePatterns);
    if (changes.aiNotes) this._data.aiNotes = changes.aiNotes;
    this._data.updatedAt = Date.now();
    this._save();
  },

  // ── 规则提取检测 ──
  detectUpdates(messages) {
    const ctx = this._data;
    const updates = {};
    const fullText = messages.map(m => m.text || '').join('\n');

    // Profile
    if (!ctx.profile.name) {
      const m = fullText.match(/(?:我是|我叫)\s*([^\s，。,\n]{2,10})/);
      if (m) updates.profile = { ...updates.profile, name: m[1] };
    }
    if (!ctx.profile.role) {
      const m = fullText.match(/(?:我是|我在)\s*([^，。,\n]{2,40}(?:大学|学院|学校|专业|系|年级)[^，。,\n]{0,20})/);
      if (m) updates.profile = { ...updates.profile, role: m[1] };
    }

    // Preferences
    if (/简[短洁]|一句话|别啰嗦/.test(fullText)) {
      updates.preferences = { responseStyle: '简洁', responseLength: '短' };
    }
    if (/详细|展开|多说|具体/.test(fullText)) {
      updates.preferences = { responseStyle: '详细', responseLength: '长' };
    }
    if (/口语|随便|轻松/.test(fullText)) {
      updates.preferences = { ...updates.preferences, responseStyle: '口语化' };
    }

    return Object.keys(updates).length ? updates : null;
  },

  // ── 重置 ──
  reset() {
    this._data = JSON.parse(JSON.stringify(DEFAULTS));
    this._save();
  },

  // ── 内部保存 ──
  _save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this._data));
    } catch (e) {
      console.error('[pc] save failed:', e.message);
    }
  },
};
```

## 2. 修改 `js/app.js`

```js
// js/app.js — 变更点

import { personalContext } from './personal-context.js';

// ── 初始化 ──
async function init() {
  // ... 现有代码 ...

  // 恢复 Session（对话历史）
  try {
    const sessionRaw = localStorage.getItem('omni_session');
    if (sessionRaw) {
      const session = JSON.parse(sessionRaw);
      conversationHistory = session.conversationHistory || [];
      // 恢复 UI
      if (conversationHistory.length > 0) {
        renderMessages(conversationHistory);
      }
    }
  } catch (e) { /* 忽略 */ }

  // 初始化 Personal Context
  personalContext.init();

  // ... 现有代码 ...
}

// ── 持久化对话 ──
function saveSession() {
  try {
    localStorage.setItem('omni_session', JSON.stringify({
      conversationHistory,
      lastActiveAt: Date.now(),
    }));
  } catch (e) { /* 忽略 */ }
}

// ── 发送完成后持久化 ──
async function sendToAI(audioBase64, frame) {
  // ... 现有 sendToAI 代码 ...

  // 在 addToHistory 调用后添加：
  saveSession();

  // 触发记忆更新检测
  tryDetectMemoryUpdate();
}

// ── 记忆更新检测 ──
function tryDetectMemoryUpdate() {
  const recentMessages = conversationHistory.slice(-6); // 最近 3 轮
  const updates = personalContext.detectUpdates(recentMessages);
  if (updates) {
    personalContext.update(updates);
    console.log('[pc] auto-updated:', updates);
  }
}

// ── Render 恢复的消息 ──
function renderMessages(messages) {
  const emptyHint = document.getElementById('emptyHint');
  if (emptyHint) emptyHint.remove();
  for (const msg of messages) {
    appendBubble(msg.role, msg.text, msg.frame);
  }
}
```

## 3. 修改 `js/chat-api.js`

```js
// js/chat-api.js — buildBody() 扩展

import { personalContext } from './personal-context.js';

function buildBody(audioBase64, frame, apiHistory) {
  return {
    audio: audioBase64,
    frame,
    history: apiHistory,
    model: settings.model,
    asr_provider: settings.asrProvider,
    asr_api_key: settings.asrApiKey,
    asr_secret_key: settings.asrProvider === 'baidu' ? settings.asrSecretKey : undefined,
    llm_provider: settings.llmProvider,
    llm_api_key: settings.llmApiKey,
    llm_base_url: settings.llmBaseUrl || undefined,
    tts_provider: settings.ttsProvider,
    personalContext: personalContext.get(),  // ★ 新增
  };
}
```

## 4. 修改 `api/chat.js`

```js
// api/chat.js — buildContext 扩展

// 在 handler / handleStream 的 buildMessages 调用中传入 personalContext:
const messages = buildMessages(frame, text, history, body.personalContext);

// buildMessages 扩展签名:
function buildMessages(frame, text, history, personalContext) {
  let systemContent = [
    '你是视觉对话助手。用户给你摄像头画面和一个问题。',
    '结合画面简洁回答。150字以内，口语化，中文。',
    '不编造不存在的内容。不确定时诚实说明。',
    '不需要"我看到了..."开场白，直接回答。',
  ];

  if (personalContext) {
    const ctxPrompt = buildPersonalContextPrompt(personalContext);
    if (ctxPrompt) systemContent.push(ctxPrompt);
  }

  const messages = [{ role: 'system', content: systemContent.join('\n\n') }];

  // ... 其余不变（历史消息 + 当前消息）
}

function buildPersonalContextPrompt(pc) {
  const lines = [];
  
  const profileParts = [];
  if (pc.profile?.name) profileParts.push(pc.profile.name);
  if (pc.profile?.role) profileParts.push(pc.profile.role);
  if (profileParts.length) lines.push(`[关于用户]\n- ${profileParts.join('，')}`);

  const prefParts = [];
  if (pc.preferences?.responseStyle) prefParts.push(`回复风格: ${pc.preferences.responseStyle}`);
  if (pc.preferences?.responseLength) prefParts.push(`回复长度: ${pc.preferences.responseLength}`);
  if (pc.preferences?.technicalLevel) prefParts.push(`技术基础: ${pc.preferences.technicalLevel}`);
  if (prefParts.length) lines.push(`[用户偏好]\n- ${prefParts.join('\n- ')}`);

  if (pc.visualDomains?.length) {
    const domains = pc.visualDomains
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 3)
      .map(d => d.domain);
    lines.push(`[视觉领域] 用户经常看: ${domains.join('、')}。如果画面匹配，优先从该领域回答。`);
  }

  const up = pc.usagePatterns || {};
  const upParts = [];
  if (up.typicalLighting) upParts.push(`典型环境: ${up.typicalLighting}`);
  if (up.typicalDistance) upParts.push(`典型距离: ${up.typicalDistance}`);
  if (upParts.length) lines.push(`[使用习惯]\n- ${upParts.join('\n- ')}`);

  if (pc.aiNotes?.length) {
    lines.push(`[AI 对你的认知]\n- ${pc.aiNotes.join('\n- ')}`);
  }

  return lines.length ? lines.join('\n\n') : '';
}
```

## 5. 可选：`api/personal-context.js`（P1 LLM 端点）

```js
// api/personal-context.js
// Vercel Edge Function — Personal Context 自动更新
// 路由: POST /api/personal-context/update

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (req.method !== 'POST') {
    return json(405, { error: '仅支持 POST' });
  }

  let body;
  try { body = await req.json(); } catch {
    return json(400, { error: '请求格式错误' });
  }

  const { messages, currentContext } = body;
  if (!messages?.length) return json(400, { error: '缺少 messages' });

  const llmCfg = {
    provider: body.llm_provider || 'dashscope',
    apiKey: body.llm_api_key,
    baseUrl: body.llm_base_url || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  };

  if (!llmCfg.apiKey) return json(500, { error: '未配置 LLM Key' });

  const systemPrompt = `你是一个用户认知提取器。分析对话，提取关于用户的稳定信息。

规则：
1. 只提取稳定的、长期的个人信息（姓名、身份、偏好、关注领域等）
2. 忽略一次性的、临时的提问（如"今天天气怎么样"）
3. 如果信息与现有认知矛盾，以最新信息为准
4. 如果没有可提取的新信息，返回空 changes
5. 只返回 JSON，不要任何解释文字

输出格式：
{
  "changes": {
    "profile": { "name": "...", "role": "..." },        // 个人信息
    "preferences": { "responseStyle": "...", "technicalLevel": "..." },  // 偏好
    "visualDomains": [{"domain": "...", "weight": 0.8}],  // 关注的视觉领域
    "usagePatterns": { "typicalLighting": "...", "typicalDistance": "..." },  // 使用习惯
    "aiNotes": ["..."]                                    // AI 对用户的认知笔记
  }
}`;

  const userPrompt = `现有认知:\n${JSON.stringify(currentContext, null, 2)}\n\n最近对话:\n${messages.map(m => `[${m.role}] ${m.text || ''}`).join('\n')}`;

  try {
    const resp = await fetch(`${llmCfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${llmCfg.apiKey}` },
      body: JSON.stringify({
        model: body.model || 'qwen-turbo',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 500,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return json(resp.status, { error: `LLM 错误 (${resp.status}): ${errText.slice(0, 300)}` });
    }

    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content || '';
    
    // 提取 JSON（可能在 markdown code block 中）
    let jsonStr = content;
    const codeMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (codeMatch) jsonStr = codeMatch[1];
    
    let changes;
    try { changes = JSON.parse(jsonStr.trim()); } catch {
      return json(500, { error: 'LLM 返回非 JSON 格式' });
    }

    // 合并新旧上下文
    const updatedContext = mergeContext(currentContext, changes.changes || changes);
    return json(200, { updatedContext, changes: changes.changes || changes });

  } catch (err) {
    if (err.name === 'AbortError') return json(500, { error: '超时' });
    return json(500, { error: err.message });
  }
}

function mergeContext(current, changes) {
  const merged = JSON.parse(JSON.stringify(current || {}));
  
  if (changes.profile) {
    merged.profile = { ...(merged.profile || {}), ...changes.profile };
  }
  if (changes.preferences) {
    merged.preferences = { ...(merged.preferences || {}), ...changes.preferences };
  }
  if (changes.visualDomains) {
    merged.visualDomains = changes.visualDomains;
  }
  if (changes.usagePatterns) {
    merged.usagePatterns = { ...(merged.usagePatterns || {}), ...changes.usagePatterns };
  }
  if (changes.aiNotes) {
    merged.aiNotes = changes.aiNotes;
  }
  
  merged.updatedAt = Date.now();
  merged.version = (merged.version || 1) + 1;
  
  return merged;
}

function json(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' },
  });
}
```

**路由接入**（在 `api/chat.js` 的 handler 开头添加）：

```js
// api/chat.js — 在路由分发处加入
if (pathname.endsWith('/personal-context/update')) {
  return handlePersonalContextUpdate(req);
}

// 导入
import personalContextHandler from './personal-context.js';
async function handlePersonalContextUpdate(req) {
  return personalContextHandler(req);
}
```

> ⚠️ 注意：Vercel Edge Function 单文件部署限制。如果 `api/personal-context.js` 是独立文件，需要在 `vercel.json` 中增加路由：
> ```json
> { "src": "/api/personal-context/update", "dest": "/api/personal-context" }
> ```
> 或者直接在 `api/chat.js` 内实现该端点（推荐，避免修改 vercel.json）。

## 6. 设置面板 UI（记忆标签页）

在 `index.html` 设置面板中新增标签页切换：

```html
<!-- 设置面板内，section 区域之上 -->
<div class="flex border-b border-gray-700/50 mb-2">
  <button class="settings-tab active px-3 py-1 text-xs" data-tab="providers">🔑 服务</button>
  <button class="settings-tab px-3 py-1 text-xs" data-tab="memory">🧠 AI 记忆</button>
</div>
```

记忆标签页内容（由 JS 动态渲染）：

```html
<div id="memoryTab" class="hidden space-y-3">
  <!-- Profile -->
  <div class="bg-gray-800/50 rounded-lg p-3 space-y-2">
    <p class="text-gray-500 text-xs font-medium">👤 个人信息</p>
    <input id="mem_name" placeholder="你的名字" class="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm" />
    <input id="mem_role" placeholder="你的身份（如：大一学生）" class="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm" />
  </div>

  <!-- Preferences -->
  <div class="bg-gray-800/50 rounded-lg p-3 space-y-2">
    <p class="text-gray-500 text-xs font-medium">⚙️ 偏好</p>
    <select id="mem_style" class="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm">
      <option value="">回复风格（不限）</option>
      <option value="简洁">简洁</option>
      <option value="详细">详细</option>
      <option value="口语化">口语化</option>
    </select>
    <select id="mem_length" class="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm">
      <option value="">回复长度（不限）</option>
      <option value="短">短（~50字）</option>
      <option value="中">中（~100字）</option>
      <option value="长">长（~150字）</option>
    </select>
    <select id="mem_tech" class="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm">
      <option value="">技术基础（不限）</option>
      <option value="beginner">入门</option>
      <option value="intermediate">中级</option>
      <option value="expert">高级</option>
    </select>
  </div>

  <!-- AI Notes -->
  <div class="bg-gray-800/50 rounded-lg p-3 space-y-2">
    <p class="text-gray-500 text-xs font-medium">🤖 AI 对你的认知</p>
    <div id="mem_notes" class="space-y-1"></div>
  </div>

  <button id="resetMemory" class="w-full py-1.5 rounded bg-red-600/30 hover:bg-red-600/50 text-red-300 text-xs transition-colors">重置所有记忆</button>
</div>
```

---

# 第七部分：验收标准总览

## MVP 必须达成

| # | 功能 | 验收 |
|---|------|------|
| M1 | 对话持久化 | 刷新/重开浏览器 → 对话恢复 |
| M2 | Personal Context 数据模型 | localStorage 读写正常，默认值正确 |
| M3 | System Prompt 注入 | 请求携带 personalContext，AI 回答体现个性化 |
| M4 | 记忆查看/编辑 UI | 设置面板可查看和编辑 AI 对用户的认知 |
| M5 | AI 自动更新（规则） | 关键词触发自动更新 profile 和 preferences |

## 不应实现（明确排除）

- ❌ 多会话管理（切换/创建/删除对话）
- ❌ 上下文压缩（对话历史超过 12 条直接丢弃）
- ❌ 对话搜索
- ❌ Transformers.js 语义搜索
- ❌ 对话标签/归档
- ❌ Vercel KV 云端备份
- ❌ Hook/Plugin 系统
- ❌ 记忆导出/导入
- ❌ 多 Agent 共享记忆

---

# 第八部分：与 Phase 4 的兼容性

- **`conversationHistory` 格式不变**，仅扩展容量（6→12）和新增 timestamp 字段
- **`buildApiHistory()` 逻辑不变**，帧处理逻辑不变
- **`sendToAI()` 流程不变**，仅在完成后追加持久化和记忆检测
- **`buildMessages()` 扩展签名**，增加可选 `personalContext` 参数，缺省时行为与 Phase 4 一致
- **设置面板原有功能不受影响**，记忆标签页是新增

---

# 第九部分：后续演进

当 MVP 验证通过后：

| Phase | 能力 |
|-------|------|
| **5.1** | LLM 驱动记忆更新（`/api/personal-context/update`） |
| **5.1** | visualDomains 自动推断（从多轮对话中统计领域频率） |
| **5.2** | usagePatterns 自动推断（从帧像素特征中学习使用环境） |
| **5.2** | 视觉特征指纹（场景匹配，相似场景自动加载上下文） |
| **6** | 多设备同步（Vercel KV） |
| **6** | 视觉 embedding 记忆（轻量图像相似度） |

---

> **给 AI agent**：
> 
> 实现顺序：M1 → M2 → M3 → M4 → M5(P0 规则)。
> 
> 关键原则：
> 1. **极简优先**：如果可以用 10 行代码解决，不要写 100 行。
> 2. **不引入新依赖**：只用浏览器原生 API + 现有 LLM 调用。
> 3. **向后兼容**：所有新参数都是可选的。缺省时行为与 Phase 4 完全一致。
> 4. **localStorage 操作要 try-catch**：私密模式或配额满时会抛异常。
> 5. **帧图片**：持久化时保留 base64 URL。帧可能较大（~50KB），注意 localStorage 容量。
> 6. **UI 风格**：复用 Tailwind 暗色主题。记忆标签页与已有设置面板风格一致。
> 7. **不修改 vercel.json**：如果需要新增 API 端点，在 `api/chat.js` 的路由分发中处理，避免增加 Edge Function 数量。
> 8. **P1 的 LLM 端点**：如果时间允许就做。如果时间紧，P0 的规则提取已经足够。
