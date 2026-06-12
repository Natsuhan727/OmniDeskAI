// api/chat.js
// Vercel Edge Function — 视觉对话编排（ASR + LLM + TTS 供应商可插拔）

export const config = { runtime: 'edge' };

// ── 供应商路由 ──
const ASR_PROVIDER = process.env.ASR_PROVIDER || 'baidu';
const LLM_PROVIDER = process.env.LLM_PROVIDER || 'dashscope';
const TTS_PROVIDER = process.env.TTS_PROVIDER || 'baidu';

let cachedBaiduToken = null;
let baiduTokenExpiry = 0;

// ═══════════════════════════════════════════════
//  Handler — 编排层（不感知供应商细节）
// ═══════════════════════════════════════════════

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
    return json(405, { text: null, audio: null, error: '仅支持 POST' });
  }

  // ── 解析 ──
  let body;
  try { body = await req.json(); } catch {
    return json(400, { text: null, audio: null, error: '请求格式错误，需要 JSON' });
  }

  const { audio, frame, history } = body;

  if (!audio || typeof audio !== 'string' || audio.length < 100) {
    return json(400, { text: null, audio: null, error: '缺少 audio 参数' });
  }
  if (audio.length > 3_000_000) {
    return json(400, { text: null, audio: null, error: '音频过大（上限 3MB base64）' });
  }
  if (!frame || typeof frame !== 'string' || !frame.startsWith('data:image/')) {
    return json(400, { text: null, audio: null, error: '缺少 frame 参数或格式不正确' });
  }
  if (frame.length > 200_000) {
    return json(400, { text: null, audio: null, error: '图片过大' });
  }

  // history 校验：可选字段，必须是数组
  const conversationHistory = Array.isArray(history) ? history : [];
  if (history !== undefined && history !== null && !Array.isArray(history)) {
    return json(400, { text: null, audio: null, error: 'history 必须是数组' });
  }
  // 后端防御性截断（最多 12 条 = 6 轮）
  if (conversationHistory.length > 12) {
    conversationHistory.splice(0, conversationHistory.length - 12);
  }

  const tTotal = Date.now();
  try {
    // ── 语音识别 ──
    const tASR = Date.now();
    const asrResult = await transcribeAudio(audio);
    console.log('[api] ASR 耗时', Date.now() - tASR, 'ms, text:', asrResult.text?.slice(0, 60));

    if (asrResult.error) {
      return json(asrResult.status, { text: null, audio: null, error: asrResult.error });
    }
    if (!asrResult.text || asrResult.text.trim().length === 0) {
      return json(200, { text: null, audio: null, error: '未识别到语音内容，请重试' });
    }

    // ── 视觉对话 ──
    const tLLM = Date.now();
    const llmResult = await chatWithVision(frame, asrResult.text, conversationHistory);

    if (llmResult.error) {
      return json(llmResult.status, { text: null, audio: null, error: llmResult.error });
    }

    // ── TTS 语音合成 ──
    const tTTS = Date.now();
    const ttsResult = await synthesizeSpeech(llmResult.text);
    console.log('[api] TTS 耗时', Date.now() - tTTS, 'ms, audio:', ttsResult.audio ? `${ttsResult.audio.length} chars` : 'null');

    console.log('[api] LLM 耗时', Date.now() - tLLM, 'ms, 总耗时', Date.now() - tTotal, 'ms');
    return json(200, { text: llmResult.text, userText: asrResult.text, audio: ttsResult.audio, error: null });

  } catch (err) {
    if (err.name === 'AbortError') {
      return json(500, { text: null, audio: null, error: '请求超时，请重试' });
    }
    console.error('[api] 异常:', err.message);
    return json(500, { text: null, audio: null, error: '服务内部错误' });
  }
}

// ═══════════════════════════════════════════════
//  ASR 接口 — transcribeAudio(audioBase64) → {text, error, status}
//  新增供应商：下面加一个 asrXxx 函数，在此 switch 加 case
// ═══════════════════════════════════════════════

async function transcribeAudio(audioBase64) {
  switch (ASR_PROVIDER) {
    case 'baidu':
      return asrBaidu(audioBase64);
    default:
      return { text: null, error: `未知 ASR 供应商: ${ASR_PROVIDER}`, status: 500 };
  }
}

async function asrBaidu(audioBase64) {
  const apiKey = process.env.ASR_API_KEY;
  const secretKey = process.env.ASR_SECRET_KEY;
  if (!apiKey || !secretKey) {
    return { text: null, error: '服务未配置 ASR Key', status: 500 };
  }

  const dataLen = Math.round(audioBase64.length * 0.75);

  async function call(token) {
    const resp = await fetch('https://vop.baidu.com/server_api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'pcm', rate: 16000, dev_pid: 1537, channel: 1, token, cuid: 'ai-visual-chat', len: dataLen, speech: audioBase64 }),
      signal: AbortSignal.timeout(20_000),
    });
    const data = await resp.json();

    if (data.err_no === 0) {
      const text = Array.isArray(data.result) ? data.result.join('') : (data.result || '');
      return { text, error: null, status: 200, retry: false };
    }
    if (data.err_no === 110 || data.err_no === 111) {
      return { text: null, error: null, status: 0, retry: true };
    }
    if (data.err_no === 3301 || data.err_no === 3307) {
      return { text: null, error: '语音质量不佳，请重试', status: 400, retry: false };
    }
    return { text: null, error: `ASR 错误 (${data.err_no}): ${data.err_msg}`, status: 500, retry: false };
  }

  const token = await baiduOAuth(apiKey, secretKey);
  let result = await call(token);
  if (result.retry) {
    cachedBaiduToken = null;
    const newToken = await baiduOAuth(apiKey, secretKey);
    result = await call(newToken);
  }
  return result;
}

async function baiduOAuth(apiKey, secretKey) {
  if (cachedBaiduToken && Date.now() < baiduTokenExpiry) return cachedBaiduToken;

  const resp = await fetch(
    `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${apiKey}&client_secret=${secretKey}`,
    { signal: AbortSignal.timeout(5_000) }
  );

  if (!resp.ok) throw new Error(`ASR 鉴权失败 (${resp.status})`);

  const data = await resp.json();
  if (!data.access_token) throw new Error('ASR 鉴权未返回 token');

  cachedBaiduToken = data.access_token;
  baiduTokenExpiry = Date.now() + (data.expires_in - 3600) * 1000;
  return cachedBaiduToken;
}

// ═══════════════════════════════════════════════
//  LLM 接口 — chatWithVision(frame, text, history=[]) → {text, error, status}
//  新增供应商：下面加一个 llmXxx 函数，在此 switch 加 case
// ═══════════════════════════════════════════════

async function chatWithVision(frame, text, history = []) {
  switch (LLM_PROVIDER) {
    case 'dashscope':
      return llmDashScope(frame, text, history);
    default:
      return { text: null, error: `未知 LLM 供应商: ${LLM_PROVIDER}`, status: 500 };
  }
}

async function llmDashScope(frame, text, history = []) {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    return { text: null, error: '服务未配置 LLM Key', status: 500 };
  }

  const baseUrl = process.env.LLM_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  const model = process.env.LLM_MODEL || 'qwen-vl-plus';

  const reqBody = JSON.stringify({
    model,
    messages: buildMessages(frame, text, history),
    max_tokens: 300, temperature: 0.7,
  });

  // ── 发送（超时重试 1 次） ──
  for (let attempt = 0; attempt < 2; attempt++) {
    let resp;
    try {
      resp = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: reqBody,
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      if (err.name === 'AbortError' && attempt === 0) {
        console.log('[llm] 超时，重试中...');
        continue;
      }
      throw err;
    }

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      console.error('[llm] error:', resp.status, errText.slice(0, 500));
      return { text: null, error: `LLM 错误 (${resp.status}): ${errText.slice(0, 300)}`, status: 500 };
    }

    const data = await resp.json();
    const reply = data.choices?.[0]?.message?.content;
    if (!reply) {
      return { text: null, error: 'LLM 返回为空', status: 500 };
    }

    return { text: reply, error: null, status: 200 };
  }

  return { text: null, error: 'LLM 超时，请重试', status: 500 };
}

// ── 构造 LLM messages（含视觉记忆） ──
function buildMessages(frame, text, history) {
  const messages = [{ role: 'system', content: [
    '你是视觉对话助手。用户给你一张摄像头画面和一个问题。',
    '结合画面简洁回答。150字以内，口语化，中文。',
    '不编造不存在的内容。不确定时诚实说明。',
    '不需要"我看到了..."开场白，直接回答。',
  ].join(' ') }];

  for (const h of history) {
    if (h.role === 'user' && h.frame) {
      messages.push({
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: h.frame } },
          { type: 'text', text: h.text },
        ],
      });
    } else if (h.role === 'user' || h.role === 'assistant') {
      messages.push({ role: h.role, content: h.text });
    }
  }

  // 当前轮（总是带帧）
  messages.push({
    role: 'user',
    content: [
      { type: 'image_url', image_url: { url: frame } },
      { type: 'text', text },
    ],
  });

  return messages;
}

// ═══════════════════════════════════════════════
//  TTS 接口 — synthesizeSpeech(text) → {audio: base64|null, error: string|null}
//  新增供应商：下面加一个 ttsXxx 函数，在此 switch 加 case
// ═══════════════════════════════════════════════

async function synthesizeSpeech(text) {
  const fn = ttsProviders[TTS_PROVIDER];
  if (!fn) return { audio: null, error: `未知 TTS 供应商: ${TTS_PROVIDER}` };
  try {
    return await fn(text);
  } catch (err) {
    console.error('[tts] 降级:', err.message);
    return { audio: null, error: err.message };
  }
}

const ttsProviders = {
  baidu: async (text) => {
    const apiKey = process.env.ASR_API_KEY;
    const secretKey = process.env.ASR_SECRET_KEY;
    if (!apiKey || !secretKey) {
      return { audio: null, error: 'TTS 未配置凭证（复用 ASR Key）' };
    }

    const token = await baiduOAuth(apiKey, secretKey);

    const params = new URLSearchParams({
      tok: token,
      tex: text,
      cuid: 'ai-visual-chat',
      ctp: '1',
      lan: 'zh',
      spd: '5',
      pit: '5',
      vol: '5',
      per: '0',
      aue: '3',
    });

    const resp = await fetch(`https://tsn.baidu.com/text2audio?${params}`, {
      signal: AbortSignal.timeout(15_000),
    });

    const contentType = resp.headers.get('content-type') || '';

    // 成功返回 audio/mp3
    if (contentType.includes('audio/mp3')) {
      const arrayBuffer = await resp.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      return { audio: btoa(binary), error: null };
    }

    // 失败返回 application/json
    if (contentType.includes('application/json')) {
      const errData = await resp.json().catch(() => ({}));
      return { audio: null, error: `TTS 错误 (${errData.err_no}): ${errData.err_msg || '未知错误'}` };
    }

    // 其他情况
    const bodyText = await resp.text().catch(() => '');
    return { audio: null, error: `TTS 未知响应: ${bodyText.slice(0, 200)}` };
  },
};

// ═══════════════════════════════════════════════
//  辅助
// ═══════════════════════════════════════════════

function json(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' },
  });
}
