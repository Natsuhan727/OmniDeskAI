// js/chat-api.js
// API 调用 — 流式（SSE）+ 非流式降级

import { settings } from './settings.js';
import { appendBubble, updateBubbleText } from './ui.js';
import { personalContext } from './personal-context.js';

// 构建通用请求体（含 Key + Provider）
function buildBody(audioBase64, frame, apiHistory, extra) {
  return {
    audio: audioBase64,
    frame,
    history: apiHistory,
    recentFrames: extra?.recentFrames || null,
    observationContext: extra?.observationContext || null,
    model: settings.model,
    asr_provider: settings.asrProvider,
    asr_api_key: settings.asrApiKey,
    asr_secret_key: settings.asrProvider === 'baidu' ? settings.asrSecretKey : undefined,
    llm_provider: settings.llmProvider,
    llm_api_key: settings.llmApiKey,
    llm_base_url: settings.llmBaseUrl || undefined,
    tts_provider: settings.ttsProvider,
    personalContext: personalContext.get(),
    chatPrompt: settings.chatPrompt || undefined,
    maxTokens: settings.chatMaxTokens,
    temperature: settings.chatTemperature,
    historyMax: settings.historyMax,
  };
}

// ── 流式对话（SSE） ──
export async function streamChat(audioBase64, frame, apiHistory, extra) {
  const resp = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildBody(audioBase64, frame, apiHistory, extra)),
  });

  if (!resp.ok) throw new Error(`Stream HTTP ${resp.status}`);

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let userText = '';
  let fullText = '';
  let aiBubble = null;
  let gotFirstToken = false;
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    // 最后一段可能是不完整的行（SSE 行被跨 chunk 切断），留着下次拼接
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const jsonStr = line.slice(6);
      if (jsonStr === '[DONE]') continue;

      try {
        const data = JSON.parse(jsonStr);
        if (data.userText) {
          userText = data.userText;
          continue;
        }
        const delta = data.choices?.[0]?.delta?.content;
        if (delta) {
          if (!gotFirstToken) {
            gotFirstToken = true;
            appendBubble('user', userText, frame);
            aiBubble = appendBubble('assistant', '');
          }
          fullText += delta;
          if (aiBubble) updateBubbleText(aiBubble, fullText);
        }
      } catch (e) { /* skip unparseable events */ }
    }
  }

  // 流结束，处理 buffer 中剩余内容
  if (buffer.startsWith('data: ') && buffer.slice(6) !== '[DONE]') {
    try {
      const data = JSON.parse(buffer.slice(6));
      const delta = data.choices?.[0]?.delta?.content;
      if (delta) {
        if (!gotFirstToken) {
          appendBubble('user', userText, frame);
          aiBubble = appendBubble('assistant', '');
        }
        fullText += delta;
        if (aiBubble) updateBubbleText(aiBubble, fullText);
      }
    } catch (e) { /* skip */ }
  }

  if (!fullText) throw new Error('流式返回为空');

  // 流式结束 → 调 TTS（如果启用）
  let audio = null;
  if (settings.ttsEnabled) {
    try {
      const ttsResp = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: fullText }),
      });
      const ttsData = await ttsResp.json();
      audio = ttsData.audio;
    } catch (err) {
      console.error('[tts] 请求失败:', err.message);
    }
  }

  return { userText, text: fullText, audio };
}

// ── 非流式对话（降级路径） ──
export async function chatNormal(audioBase64, frame, apiHistory, extra) {
  const resp = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildBody(audioBase64, frame, apiHistory, extra)),
  });
  const data = await resp.json();
  if (!resp.ok || data.error) throw new Error(data.error || '请求失败');
  return data;  // { text, userText, audio, error }
}

// ── 监测流（SSE） ──
export async function monitorStream({ frame, prevFrame, observationContext, history, personalContext, model, monitorPrompt, maxTokens, temperature }) {
  const resp = await fetch('/api/monitor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      frame,
      prevFrame: prevFrame || null,
      observationContext: observationContext || [],
      history,
      personalContext: personalContext || '',
      monitorPrompt: monitorPrompt || '',
      maxTokens: maxTokens || 100,
      temperature: temperature != null ? temperature : 0.3,
      model: model || settings.model,
      llm_provider: settings.llmProvider,
      llm_api_key: settings.llmApiKey,
      llm_base_url: settings.llmBaseUrl || undefined,
    }),
  });

  if (!resp.ok) throw new Error(`Monitor HTTP ${resp.status}`);

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let observation = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const jsonStr = line.slice(6);
      if (jsonStr === '[DONE]') break;

      try {
        const data = JSON.parse(jsonStr);
        const delta = data.choices?.[0]?.delta?.content;
        if (delta) observation += delta;
      } catch (e) { /* skip */ }
    }
  }

  // 处理 buffer 中剩余内容
  if (buffer.startsWith('data: ') && buffer.slice(6) !== '[DONE]') {
    try {
      const data = JSON.parse(buffer.slice(6));
      const delta = data.choices?.[0]?.delta?.content;
      if (delta) observation += delta;
    } catch (e) { /* skip */ }
  }

  return { observation, audio: null };
}
