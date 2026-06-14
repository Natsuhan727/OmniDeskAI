// js/app.js
// 应用主模块 — 状态管理、事件绑定、对话流程

import { webmToPcmBase64 } from './audio-converter.js';
import { settings, initSettingsPanel } from './settings.js';
import { appendBubble, showErrorBubble, renderMessages } from './ui.js';
import { streamChat, chatNormal, monitorStream } from './chat-api.js';
import { getStorage } from './storage-backend.js';
import { personalContext } from './personal-context.js';
import { createMonitor } from './monitor.js';

// ── 全局状态 ──
let stream = null;
let isProcessing = false;
let mediaRecorder = null;
let audioChunks = [];
let currentAudio = null;
let conversationHistory = [];
let monitor = null;
let monitorHistory = [];
let wasMonitoring = false;

// ── DOM 引用 ──
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const talkBtn = document.getElementById('talkBtn');
const hint = document.getElementById('hint');

// ── 按钮状态 ──
function setButtonState(state) {
  const states = {
    idle:    { text: '🎤 按住说话', cls: 'bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white' },
    recording: { text: '🔴 录音中...松开发送', cls: 'bg-red-600 hover:bg-red-500 active:bg-red-700 text-white' },
    sending: { text: '⏳ AI 思考中...', cls: 'bg-gray-600 text-gray-300 cursor-not-allowed' },
    speaking: { text: '🔊 AI 回复中...（点击打断）', cls: 'bg-green-600 hover:bg-green-500 active:bg-green-700 text-white cursor-pointer' },
  };
  const s = states[state];
  talkBtn.textContent = s.text;
  talkBtn.className = 'w-full py-4 rounded-xl text-lg font-semibold select-none transition-colors duration-200 ' + s.cls;
}

function resetToIdle() {
  isProcessing = false;
  setButtonState('idle');
  // 监测恢复
  if (wasMonitoring && monitor && monitor.getState().mode === 'idle') {
    monitor.resume();
    updateMonitorUI(false);
  }
  wasMonitoring = false;
}

// ── 历史管理 ──
const MAX_HISTORY = 12; // 6 轮

function addToHistory(role, text, frame) {
  conversationHistory.push({
    role,
    text,
    ...(frame ? { frame } : {}),
    timestamp: Date.now(),
  });
  while (conversationHistory.length > MAX_HISTORY) conversationHistory.shift();
}

function buildApiHistory() {
  const apiHistory = conversationHistory.map(m => ({ ...m }));
  let foundLastUser = false;
  for (let i = apiHistory.length - 1; i >= 0; i--) {
    if (apiHistory[i].role === 'user') {
      if (!foundLastUser) { foundLastUser = true; }
      else { apiHistory[i].frame = null; }
    }
  }
  return apiHistory;
}

// ── 会话持久化 ──
async function saveSession() {
  try {
    const storage = getStorage();
    await storage.set('omni_session', {
      conversationHistory,
      lastActiveAt: Date.now(),
    });
  } catch (e) { /* 忽略 */ }
}

// ── TTS 播放 ──
function playAudio(audioBase64) {
  if (!audioBase64 || !settings.ttsEnabled) return;
  setButtonState('speaking');
  currentAudio = new Audio('data:audio/mp3;base64,' + audioBase64);
  currentAudio.onended = () => { currentAudio = null; resetToIdle(); };
  currentAudio.onerror = () => { currentAudio = null; resetToIdle(); };
  currentAudio.play().catch(() => { currentAudio = null; resetToIdle(); });
}

// ── 监测控制 ──
function startMonitor() {
  monitor = createMonitor({
    config: {
      interval: settings.monitorInterval,
      changeThreshold: settings.monitorThreshold,
      cooldownDuration: settings.monitorCooldown,
      breakThreshold: settings.monitorBreakThreshold,
      similarityThreshold: settings.monitorSimilarity,
    },
    captureFrame() {
      ctx.drawImage(video, 0, 0, 640, 480);
      return canvas.toDataURL('image/jpeg', settings.frameQuality);
    },
    getConversationHistory() {
      return buildApiHistory(); // 只含用户问答，不含监测观察
    },
    async onObservation({ frame, prevFrame, observationContext, history }) {
      console.log('[monitor] onObservation called, frame:', frame.length, 'prevFrame:', !!prevFrame, 'ctx:', observationContext.length);
      let result;
      try {
        result = await monitorStream({
          frame,
          prevFrame,
          observationContext,
          history,
          personalContext: personalContext.get(),
          model: settings.model,
          monitorPrompt: settings.monitorPrompt,
          maxTokens: settings.monitorMaxTokens,
          temperature: settings.monitorTemperature,
        });
      } catch (err) {
        console.error('[monitor] request failed:', err.message);
        return;
      }

      const text = result.observation?.trim();
      console.log('[monitor] observation result:', text ? `"${text.slice(0, 50)}"` : '(empty)');
      if (!text || text === 'NO_CHANGE') return;

      monitor.onObservationDone(text);
      appendBubble('assistant', '🔴 ' + text);
      monitorHistory.push({ role: 'monitor', text, timestamp: Date.now() });
      while (monitorHistory.length > 20) monitorHistory.shift();

      // TTS 播报
      if (settings.ttsEnabled) {
        try {
          const ttsResp = await fetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
          });
          const ttsData = await ttsResp.json();
          if (ttsData.audio) playAudio(ttsData.audio);
        } catch (err) {
          console.error('[monitor] TTS failed:', err.message);
        }
      }
    },
    onSpeaking(isSpeaking) {
      updateMonitorUI(isSpeaking);
    },
    onError(err) {
      console.error('[monitor]', err.message);
    },
  });

  monitor.start();
  updateMonitorUI(false);
}

function stopMonitor() {
  if (monitor) { monitor.stop(); monitor = null; }
  updateMonitorUI(false);
}

function updateMonitorUI(isSending) {
  const btn = document.getElementById('monitorToggle');
  if (!btn) return;
  const s = monitor ? monitor.getState() : null;
  if (!s || s.mode === 'idle') {
    btn.textContent = '▶ 开启实时监测';
    btn.className = 'w-full py-2 rounded-lg text-sm font-medium select-none bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors';
  } else if (isSending || s.mode === 'sending') {
    btn.textContent = '⏳ AI 正在观察...';
    btn.className = 'w-full py-2 rounded-lg text-sm font-medium select-none bg-gray-600 text-gray-300 cursor-not-allowed';
  } else {
    const sec = Math.round(settings.monitorInterval / 1000);
    const skipped = s.suppressedCount > 0 ? ` · 已跳过 ${s.suppressedCount} 帧` : '';
    btn.textContent = `🔴 监测中 · 每 ${sec}s${skipped}`;
    btn.className = 'w-full py-2 rounded-lg text-sm font-medium select-none bg-red-600/30 hover:bg-red-600/50 text-red-300 border border-red-600/30 transition-colors';
  }
}

// ── 发送（流式优先，失败降级非流式） ──
async function sendToAI(audioBase64, frame) {
  setButtonState('sending');
  const t0 = Date.now();
  const apiHistory = buildApiHistory();
  console.log('[api] audio:', audioBase64.length, 'chars, frame:', frame.length, 'chars, history:', apiHistory.length, 'msgs');

  try {
    const { userText, text, audio } = await streamChat(audioBase64, frame, apiHistory);
    console.log('[api] stream elapsed:', Date.now() - t0, 'ms, text:', text?.slice(0, 80));
    addToHistory('user', userText, frame);
    addToHistory('assistant', text);
    settings.hasConversed = true;
    await saveSession();

    if (audio) { playAudio(audio); } else { resetToIdle(); }
  } catch (streamErr) {
    console.error('[stream] 降级非流式:', streamErr.message);
    const placeholder = appendBubble('assistant', '⏳ AI 正在组织语言...');
    placeholder.querySelector('p').classList.add('animate-pulse');
    try {
      const data = await chatNormal(audioBase64, frame, apiHistory);
      console.log('[api] fallback elapsed:', Date.now() - t0, 'ms, text:', data.text?.slice(0, 80));
      placeholder.remove();
      if (data.text && data.userText) {
        addToHistory('user', data.userText, frame);
        addToHistory('assistant', data.text);
        settings.hasConversed = true;
        await saveSession();
    
        appendBubble('user', data.userText, frame);
        appendBubble('assistant', data.text);
        if (data.audio) { playAudio(data.audio); } else { resetToIdle(); }
      } else if (data.text) {
        addToHistory('assistant', data.text);
        await saveSession();
    
        appendBubble('assistant', data.text);
        if (data.audio) { playAudio(data.audio); } else { resetToIdle(); }
      } else {
        resetToIdle();
      }
    } catch (fallbackErr) {
      if (placeholder && placeholder.parentNode) placeholder.remove();
      console.error('[api] 降级也失败:', fallbackErr.message);
      showErrorBubble(fallbackErr.message || '请求失败');
      resetToIdle();
    }
  }
}

// ── 按下（含打断逻辑） ──
function onButtonDown(e) {
  e.preventDefault();

  // 监测运行中 → 暂停
  if (monitor && monitor.getState().mode !== 'idle') {
    wasMonitoring = true;
    monitor.pause();
    updateMonitorUI(false);
  }

  if (currentAudio && !currentAudio.paused) {
    currentAudio.pause();
    currentAudio = null;
    resetToIdle();
    console.log('[tts] 用户打断播放');
    return;
  }

  if (isProcessing || !stream) return;
  isProcessing = true;
  setButtonState('recording');
  audioChunks = [];

  const audioTrack = stream.getAudioTracks()[0];
  if (!audioTrack) { showErrorBubble('未检测到麦克风'); resetToIdle(); return; }
  const audioStream = new MediaStream([audioTrack]);

  try {
    mediaRecorder = new MediaRecorder(audioStream, { mimeType: 'audio/webm' });
  } catch (err) {
    mediaRecorder = new MediaRecorder(audioStream);
  }
  console.log('[rec] MediaRecorder started, mimeType:', mediaRecorder.mimeType);

  mediaRecorder.ondataavailable = function(e) { if (e.data.size > 0) audioChunks.push(e.data); };
  mediaRecorder.onerror = function(e) { console.error('[rec] error:', e.error); showErrorBubble('录音出错'); resetToIdle(); };

  mediaRecorder.onstop = async function() {
    const audioBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
    console.log('[rec] stopped, blob size:', audioBlob.size, 'chunks:', audioChunks.length);

    if (audioBlob.size < 1000) { showErrorBubble('未检测到语音，请重试'); resetToIdle(); return; }

    let audioBase64;
    try {
      console.log('[conv] 开始音频转换...');
      const result = await webmToPcmBase64(audioBlob);
      audioBase64 = result.base64;
      console.log('[conv] 转换完成, base64:', audioBase64.length);
    } catch (err) {
      console.error('[conv] 转换失败:', err.message);
      showErrorBubble('音频处理失败，请重试');
      resetToIdle();
      return;
    }

    ctx.drawImage(video, 0, 0, 640, 480);
    const frame = canvas.toDataURL('image/jpeg', settings.frameQuality);
    console.log('[frame] captured, length:', frame.length);

    await sendToAI(audioBase64, frame);
  };

  mediaRecorder.start();
}

function onButtonUp(e) {
  e.preventDefault();
  if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
  try { mediaRecorder.stop(); } catch (err) {}
}

// ── 页面初始化 ──
async function init() {
  console.log('[init] 页面加载');
  if (!navigator.mediaDevices?.getUserMedia) {
    hint.textContent = '⚠️ 请使用 Chrome 浏览器'; hint.className = 'text-xs text-red-400';
    talkBtn.disabled = true; return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: true });
    console.log('[init] getUserMedia 成功, 音频轨道:', stream.getAudioTracks().length);
    stream.getAudioTracks().forEach((t, i) => console.log(`[init]  音频#${i}: "${t.label}" readyState=${t.readyState}`));
    video.srcObject = stream;
    hint.textContent = '提示：请使用 Chrome 浏览器'; hint.className = 'text-xs text-gray-500';

    // 恢复上次会话
    try {
      const storage = getStorage();
      const session = await storage.get('omni_session');
      if (session?.conversationHistory?.length) {
        conversationHistory = session.conversationHistory;
        renderMessages(conversationHistory);
        console.log('[init] 恢复会话:', conversationHistory.length, '条消息');
      }
    } catch (e) { /* 忽略 */ }
  } catch (err) {
    console.error('[init] getUserMedia 失败:', err.message);
    hint.textContent = '⚠️ 需要摄像头和麦克风权限'; hint.className = 'text-xs text-red-400';
    talkBtn.disabled = true; return;
  }

  // 初始化 Personal Context
  await personalContext.init();
  console.log('[init] personalContext:', personalContext.get() ? '已配置' : '空');

  talkBtn.addEventListener('mousedown', onButtonDown);
  talkBtn.addEventListener('mouseup', onButtonUp);
  talkBtn.addEventListener('mouseleave', onButtonUp);
  talkBtn.addEventListener('touchstart', onButtonDown, { passive: false });
  talkBtn.addEventListener('touchend', onButtonUp);

  // 监测开关
  const monitorBtn = document.getElementById('monitorToggle');
  if (monitorBtn) {
    monitorBtn.addEventListener('click', () => {
      if (monitor && monitor.getState().mode !== 'idle') {
        stopMonitor();
      } else {
        startMonitor();
      }
    });
  }

  initSettingsPanel();
  console.log('[init] 就绪');
}

init();
