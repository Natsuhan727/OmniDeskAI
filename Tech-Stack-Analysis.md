---
title: 技术选型分析 — 纯 JS 是否合理？
project: AI 视觉对话助手
date: 2026-06-14
---

# 纯 JavaScript 技术选型分析

> 问题：这个程序用纯 JS 写，合理吗？类似应用都怎么做的？

---

## 一、结论：合理。而且对当前阶段来说，可能是最优选择。

---

## 二、行业数据

调研了 15+ 个开源/商业浏览器端 AI 语音+视觉应用，发现一个反直觉的事实：

### 纯 JS 项目（非个例）

| 项目 | 规模 | 技术栈 |
|------|------|--------|
| **Voice AI Agent** (Grizzly Peak) | 生产级 | Node.js + Vanilla JS，~500 行 |
| **JARVIS Clone** | 开源 | FastAPI + Vanilla JS + Three.js |
| **AI Voice Agent** (GitHub) | 开源 | Python/FastAPI + Vanilla HTML/CSS/JS |
| **WebVoice** (百度开发者) | 教程级 | Vanilla JS + Web Speech API |

### 框架项目

| 项目 | 技术栈 |
|------|--------|
| **Voz** | Next.js + TypeScript + Tailwind + Framer Motion |
| **Jarvis 3D** | Next.js 14 + React Three Fiber + OpenAI |
| **LiveLook** (虚拟试穿) | Next.js + Decart SDK + MediaPipe |
| **LLMRTC** | TypeScript SDK，框架无关 |

**规律**：纯 JS 用于单页、小 UI 面、实时交互型应用。React/Next.js 用于多视图、复杂 UI、需要路由和 SSR 的应用。

---

## 三、为什么纯 JS 对这个项目是合理的

### 3.1 UI 面积极小

```
┌─────────────────────────┐
│ 标题                     │
│ 摄像头画面               │
│ 消息列表 (可滚动)        │
│ 按钮 (按住说话)          │
│ 设置面板 (折叠/展开)     │
└─────────────────────────┘
```

整个应用只有 5 个 UI 区域。每个区域只有一个实例。没有列表渲染、没有嵌套路由、没有组件复用需求。React 的组件化对这个 UI 面来说，是杀鸡用牛刀。

### 3.2 真正的复杂度在别处

这个项目的复杂度分布：

```
DOM 渲染:        10%  ← 框架解决的
状态管理:        20%  ← 纯 JS 同样能解决
音视频处理:      30%  ← 浏览器原生 API，框架帮不了
异步流程编排:    30%  ← async/await，框架帮不了
API 协议:        10%  ← fetch + SSE，框架帮不了
```

**框架只帮 10%**。真正耗脑子的音频转换、SSE 流式解析、变化检测、TTS 打断——这些跟 React 还是 Vanilla JS 完全无关。

### 3.3 零构建成本

当前：
```bash
# 部署
vercel --prod
```

如果加 React：
```bash
npm install react react-dom            # 50MB node_modules
npm install vite @vitejs/plugin-react  # 构建工具
npm install tailwindcss postcss        # CSS 处理
# 配置 vite.config.js
# 配置 tailwind.config.js
# 配置 postcss.config.js
# 把所有 .js 改成 .jsx
# 把所有 innerHTML 改成 JSX
# 把所有 querySelector 改成 useRef
# npm run build → dist/ → vercel --prod
```

构建链增加 3 个配置文件 + 50MB 依赖，换来的是……DOM 操作更优雅。但当前 DOM 操作量本来就很小。

---

## 四、纯 JS 的真实代价

说"合理"不等于说"完美"。纯 JS 确实有代价：

| 代价 | 当前表现 | 何时成为问题 |
|------|----------|-------------|
| **代码组织依赖约定** | `app.js` 400 行混合所有职责 | 已经出现了（接口审计报告指出过） |
| **DOM 操作繁琐** | `document.getElementById` + innerHTML | 消息气泡、设置面板已显臃肿 |
| **状态同步需手工** | 按钮状态 + 监测状态 + 对话状态分散管理 | 增加新状态时需要全局改动 |
| **无类型安全** | 靠 console.log 调试 | 大型重构时风险高 |
| **测试困难** | 无模块边界，难以单测 | 目前手工测试为主 |

**这些不是"用纯 JS"的问题，而是"没有在纯 JS 中做工程化"的问题。** 接口审计已经指出了解决方案——拆分模块、事件总线、容器参数化——不需要引入框架。

---

## 五、推荐路径

### 当前 → 短期（保持纯 JS，做好工程化）

```
js/
├── app.js              → 拆薄，只做绑定
├── engine/
│   ├── conversation.js  → 对话状态机
│   ├── session.js       → 会话持久化
│   └── media.js         → 音视频捕获
├── monitor.js           → 已有，良好
├── personal-context.js  → 已有，良好
├── storage-backend.js   → 已有，良好
├── chat-api.js          → API 通信
├── ui.js                → DOM 渲染（容器参数化）
├── settings.js          → 数据单例
├── settings-ui.js       → 面板渲染（拆出来）
└── events.js            → 轻量事件总线（30行）
```

**做到这步，代码质量不输 React 项目。** 代价是 2-3 小时的模块拆分，不是 2-3 天的框架迁移。

### 中期（如果需要多平台）

TypeScript 化，不加框架。`.js` → `.ts`，为所有接口加上类型。这是性价比最高的改进——投入半天，收益是编译期错误检查 + 更好的 IDE 支持。

### 长期（如果需要复杂 UI）

如果未来需要多窗口、仪表盘、数据可视化、多人协作 UI——那时候再考虑 React/Vue。但当前产品的交互模式决定了这不会是近期需求。

---

## 六、对比总结

| 维度 | 纯 JS (当前) | React | Vue |
|------|:--:|:--:|:--:|
| **学习成本** | ✅ 零（已掌握） | 中 | 低 |
| **构建成本** | ✅ 零 | 高（Vite/Webpack） | 中 |
| **DOM 操作** | ⚠️ 手工，繁琐 | ✅ 声明式 | ✅ 声明式 |
| **状态管理** | ⚠️ 需自律 | ✅ useState/useReducer | ✅ ref/reactive |
| **类型安全** | ❌ 无 | ✅ TS 天然 | ✅ TS 天然 |
| **代码复用** | ⚠️ 靠模块化 | ✅ 组件化 | ✅ 组件化 |
| **调试体验** | ⚠️ console.log | ✅ React DevTools | ✅ Vue DevTools |
| **适用场景** | ✅ 单页小 UI | ✅ 复杂多视图 | ✅ 中型应用 |
| **适合本项目** | ✅ MVP→中期 | 长期可选 | 长期可选 |

---

**一句话**：这个项目用纯 JS 不是妥协，是正确的技术选择。需要改进的不是换框架，而是按接口审计的建议做好模块拆分。
