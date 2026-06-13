// js/chat-api.js
// API 调用 — 流式（SSE）+ 非流式降级

import { settings } from './settings.js';
import { appendBubble, updateBubbleText } from './ui.js';

// ── 流式对话（SSE） ──
export async function streamChat(audioBase64, frame, apiHistory) {
  const resp = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio: audioBase64, frame, history: apiHistory, model: settings.model }),
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
export async function chatNormal(audioBase64, frame, apiHistory) {
  const resp = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio: audioBase64, frame, history: apiHistory, model: settings.model }),
  });
  const data = await resp.json();
  if (!resp.ok || data.error) throw new Error(data.error || '请求失败');
  return data;  // { text, userText, audio, error }
}
