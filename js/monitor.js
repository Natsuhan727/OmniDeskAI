// js/monitor.js
// 实时视觉监测引擎 — 帧调度、变化检测、TTS 防轰炸、观察上下文、状态机
// 依赖注入模式，不直接依赖任何模块

export function createMonitor(deps) {
  const { captureFrame, getConversationHistory, onObservation, onSpeaking, onError, config } = deps;

  // ── 默认值 ──
  const cfg = config || {};

  // ── 状态 ──
  const state = {
    mode: 'idle',           // idle | observing | sending
    lastFrame: null,        // 上一帧 base64
    frameCount: 0,
    suppressedCount: 0,     // 被变化检测跳过的帧数
    timer: null,
  };

  // ── TTS 冷却 ──
  const cooldown = {
    active: false,
    until: 0,               // 冷却结束时间戳
    lastText: '',           // 上次播报文字
    get duration() { return cfg.cooldownDuration || 5000; },
    get breakThreshold() { return cfg.breakThreshold || 0.10; },

    isActive() {
      return this.active && Date.now() < this.until;
    },

    start(text) {
      this.active = true;
      this.until = Date.now() + this.duration;
      this.lastText = text;
    },

    reset() {
      this.active = false;
      this.until = 0;
      this.lastText = '';
    },
  };

  // ── 观察上下文（最近 3 条） ──
  const observationContext = [];

  function addObservation(text) {
    observationContext.push({
      time: Date.now(),
      text,
      frameHash: state.lastFrame ? simpleHash(state.lastFrame.slice(-200)) : '',
    });
    while (observationContext.length > 3) observationContext.shift();
  }

  // ── 变化检测 ──
  const changeDetector = {
    get threshold() { return cfg.changeThreshold || 0.03; },

    async isSimilar(frame1, frame2) {
      if (!frame1 || !frame2) return false;

      const thumb1 = await thumbnailDiff(frame1);
      const thumb2 = await thumbnailDiff(frame2);
      if (!thumb1 || !thumb2) return false;

      let diff = 0;
      for (let i = 0; i < thumb1.length; i += 4) {
        diff += Math.abs(thumb1[i] - thumb2[i]) +
                Math.abs(thumb1[i + 1] - thumb2[i + 1]) +
                Math.abs(thumb1[i + 2] - thumb2[i + 2]);
      }
      const totalPixels = thumb1.length / 4;
      const avgDiff = diff / (totalPixels * 3 * 255);
      return avgDiff < this.threshold;
    },

    async diffDegree(frame1, frame2) {
      if (!frame1 || !frame2) return 1;
      const thumb1 = await thumbnailDiff(frame1);
      const thumb2 = await thumbnailDiff(frame2);
      if (!thumb1 || !thumb2) return 1;

      let diff = 0;
      for (let i = 0; i < thumb1.length; i += 4) {
        diff += Math.abs(thumb1[i] - thumb2[i]) +
                Math.abs(thumb1[i + 1] - thumb2[i + 1]) +
                Math.abs(thumb1[i + 2] - thumb2[i + 2]);
      }
      return diff / (thumb1.length / 4 * 3 * 255);
    },
  };

  // ── 帧调度器 ──
  let interval = cfg.interval || 2000;

  async function tick() {
    if (state.mode !== 'observing') return;

    const frame = captureFrame();
    if (!frame) return;

    state.mode = 'sending';
    onSpeaking(true);

    try {
      // 变化检测
      const similar = await changeDetector.isSimilar(frame, state.lastFrame);
      console.log('[monitor] tick: mode=sending frame#', state.frameCount + 1, 'suppressed=', state.suppressedCount, 'similar=', similar, 'lastFrame=', !!state.lastFrame);
      if (similar) {
        state.suppressedCount++;
        state.mode = 'observing';
        onSpeaking(false);
        return;
      }

      // 检查是否需要打破冷却（画面剧变）
      if (cooldown.isActive()) {
        const degree = await changeDetector.diffDegree(frame, state.lastFrame);
        if (degree < cooldown.breakThreshold) {
          // 仍在冷却期且非剧变，静默跳过
          state.suppressedCount++;
          state.lastFrame = frame;
          state.mode = 'observing';
          onSpeaking(false);
          return;
        }
        // 剧变：打破冷却
        cooldown.reset();
      }

      state.frameCount++;
      const prevFrame = state.lastFrame;
      state.lastFrame = frame;

      // 调用 onObservation 回调（由外部处理请求+渲染+TTS）
      await onObservation({
        frame,
        prevFrame,
        observationContext: [...observationContext],
        history: getConversationHistory(),
      });

    } catch (err) {
      onError(err);
    } finally {
      state.mode = 'observing';
      onSpeaking(false);
    }
  }

  // ── 公共接口 ──
  return {
    start(intervalMs) {
      if (intervalMs) interval = intervalMs;
      state.mode = 'observing';
      state.frameCount = 0;
      state.suppressedCount = 0;
      state.lastFrame = null;
      cooldown.reset();
      observationContext.length = 0;
      state.timer = setInterval(tick, interval);
    },

    stop() {
      clearInterval(state.timer);
      state.timer = null;
      state.mode = 'idle';
    },

    pause() {
      clearInterval(state.timer);
      state.timer = null;
      state.mode = 'idle';
    },

    resume() {
      if (state.mode === 'idle' && !state.timer) {
        state.mode = 'observing';
        state.timer = setInterval(tick, interval);
      }
    },

    setInterval(ms) { interval = ms; },

    // 观察完成后回调：更新上下文 + 处理 TTS 冷却
    onObservationDone(text) {
      addObservation(text);
      cooldown.start(text);
    },

    // 内容去重：判断两段文字相似度是否 > 70%
    isTextSimilar(text1, text2) {
      if (!text1 || !text2) return false;
      return textSimilarity(text1, text2) > (cfg.similarityThreshold || 0.70);
    },

    getState() { return { ...state }; },
    getObservationContext() { return [...observationContext]; },
  };
}

// ── 内部工具 ──

// 在隐藏 canvas 上绘制 32×24 缩略图，返回 ImageData 像素数组
async function thumbnailDiff(dataUrl) {
  try {
    const img = new Image();
    const loaded = new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
    });
    img.src = dataUrl;
    await loaded;
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 24;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, 32, 24);
    return ctx.getImageData(0, 0, 32, 24).data;
  } catch (e) {
    return null;
  }
}

// 简单文本相似度（Jaccard 基于 2-gram）
function textSimilarity(a, b) {
  if (a === b) return 1;
  const bigramsA = new Set();
  const bigramsB = new Set();
  for (let i = 0; i < a.length - 1; i++) bigramsA.add(a.slice(i, i + 2));
  for (let i = 0; i < b.length - 1; i++) bigramsB.add(b.slice(i, i + 2));
  const intersection = [...bigramsA].filter(bg => bigramsB.has(bg)).length;
  const union = new Set([...bigramsA, ...bigramsB]).size;
  return union ? intersection / union : 0;
}

// 简单字符串 hash（用于帧指纹）
function simpleHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return String(h);
}
