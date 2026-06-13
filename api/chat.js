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
  // ── 路由分发 ──
  const url = new URL(req.url);
  const pathname = url.pathname;

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

  if (pathname.endsWith('/stream')) return handleStream(req);
  if (pathname.endsWith('/tts')) return handleTTS(req);
  // 默认: 非流式 /api/chat（Phase 2 行为不变）

  // ── 解析 & 校验 ──
  let body;
  try { body = await req.json(); } catch {
    return json(400, { text: null, audio: null, error: '请求格式错误，需要 JSON' });
  }

  const tTotal = Date.now();
  try {
    const proc = await processAudio(body);
    if (proc.error) return json(proc.status, { text: null, audio: null, error: proc.error });
    const { frame, text: userText, history: conversationHistory, model } = proc.data;

    // ── 视觉对话 ──
    const tLLM = Date.now();
    const llmResult = await chatWithVision(frame, userText, conversationHistory);

    if (llmResult.error) {
      return json(llmResult.status, { text: null, audio: null, error: llmResult.error });
    }

    // ── TTS 语音合成 ──
    const tTTS = Date.now();
    const ttsResult = await synthesizeSpeech(llmResult.text);
    console.log('[api] TTS 耗时', Date.now() - tTTS, 'ms, audio:', ttsResult.audio ? `${ttsResult.audio.length} chars` : 'null');

    console.log('[api] LLM 耗时', Date.now() - tLLM, 'ms, 总耗时', Date.now() - tTotal, 'ms');
    return json(200, { text: llmResult.text, userText, audio: ttsResult.audio, error: null });

  } catch (err) {
    if (err.name === 'AbortError') {
      return json(500, { text: null, audio: null, error: '请求超时，请重试' });
    }
    console.error('[api] 异常:', err.message);
    return json(500, { text: null, audio: null, error: '服务内部错误' });
  }
}

// ═══════════════════════════════════════════════
//  共享：ASR + 校验（流式/非流式共用）
// ═══════════════════════════════════════════════

async function processAudio(body) {
  const parsed = parseAndValidate(body);
  if (!parsed.valid) return { error: parsed.error, status: 400 };

  const { audio, frame, history } = parsed.data;
  const asrResult = await transcribeAudio(audio);
  if (asrResult.error) return { error: asrResult.error, status: asrResult.status };
  if (!asrResult.text?.trim()) return { error: '未识别到语音内容，请重试', status: 200 };

  const model = body.model || process.env.LLM_MODEL || 'qwen-vl-plus';
  return { data: { frame, text: asrResult.text, history, model } };
}

// ═══════════════════════════════════════════════
//  流式端点 — POST /api/chat/stream (SSE)
// ═══════════════════════════════════════════════

async function handleStream(req) {
  let body;
  try { body = await req.json(); } catch {
    return json(400, { error: '请求格式错误，需要 JSON' });
  }

  const proc = await processAudio(body);
  if (proc.error) return json(proc.status, { error: proc.error });
  const { frame, text: userText, history, model } = proc.data;

  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    return json(500, { error: '服务未配置 LLM Key' });
  }
  const baseUrl = process.env.LLM_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';

  let streamResp;
  try {
    streamResp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: buildMessages(frame, userText, history),
        max_tokens: 300, temperature: 0.7, stream: true,
      }),
      signal: AbortSignal.timeout(25_000),
    });
  } catch (err) {
    if (err.name === 'AbortError') return json(500, { error: 'LLM 超时，请重试' });
    throw err;
  }

  if (!streamResp.ok) {
    const errText = await streamResp.text().catch(() => '');
    console.error('[stream] LLM error:', streamResp.status, errText.slice(0, 300));
    return json(streamResp.status, { error: `LLM 错误 (${streamResp.status})` });
  }

  // 拼接：第一个 SSE 事件 = userText，后续 = LLM 流
  const encoder = new TextEncoder();
  const userTextEvent = encoder.encode(`data: ${JSON.stringify({ userText })}\n\n`);

  const combined = new ReadableStream({
    async start(controller) {
      controller.enqueue(userTextEvent);
      const reader = streamResp.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
      } finally {
        reader.releaseLock();
        controller.close();
      }
    },
  });

  return new Response(combined, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

// ═══════════════════════════════════════════════
//  TTS 端点 — POST /api/tts
// ═══════════════════════════════════════════════

async function handleTTS(req) {
  let body;
  try { body = await req.json(); } catch {
    return json(400, { audio: null, error: '请求格式错误' });
  }

  const { text } = body;
  if (!text || typeof text !== 'string') {
    return json(400, { audio: null, error: '缺少 text 参数' });
  }

  const ttsResult = await synthesizeSpeech(text);
  return json(200, { audio: ttsResult.audio });
}

// ═══════════════════════════════════════════════
//  ASR Provider 注册表 — transcribeAudio(audio) → {text, error, status}
//  新增供应商：下面加一个 asrXxx 函数，在此对象加一条
// ═══════════════════════════════════════════════

const asrProviders = {
  baidu: asrBaidu,
};

async function transcribeAudio(audioBase64) {
  const fn = asrProviders[ASR_PROVIDER];
  if (!fn) return { text: null, error: `未知 ASR 供应商: ${ASR_PROVIDER}`, status: 500 };
  return fn(audioBase64);
}

async function asrBaidu(audioBase64) {
  const apiKey = process.env.ASR_API_KEY;
  const secretKey = process.env.ASR_SECRET_KEY;
  if (!apiKey || !secretKey) {
    return { text: null, error: '服务未配置 ASR Key', status: 500 };
  }

  const dataLen = Math.round(audioBase64.length * 0.75);

  async function call(token) {
    let resp;
    try {
      resp = await fetch('https://vop.baidu.com/server_api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format: 'pcm', rate: 16000, dev_pid: 1537, channel: 1, token, cuid: 'ai-visual-chat', len: dataLen, speech: audioBase64 }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      console.error('[asr] fetch 失败:', err.message);
      throw new Error(`ASR 网络错误: ${err.message}`);
    }

    if (!resp.ok) {
      const bodyText = await resp.text().catch(() => '');
      console.error('[asr] HTTP', resp.status, bodyText.slice(0, 300));
      throw new Error(`ASR 服务异常 (HTTP ${resp.status})`);
    }

    let data;
    try {
      data = await resp.json();
    } catch (err) {
      console.error('[asr] JSON 解析失败:', err.message);
      throw new Error('ASR 响应格式异常');
    }

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
    console.error('[asr] err_no:', data.err_no, data.err_msg);
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

  console.log('[oauth] 请求 token, key:', apiKey?.slice(0, 8) + '...', 'secret:', secretKey ? '***' : 'MISSING');

  let resp;
  try {
    resp = await fetch(
      `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${apiKey}&client_secret=${secretKey}`,
      { signal: AbortSignal.timeout(5_000) }
    );
  } catch (err) {
    console.error('[oauth] fetch 失败:', err.message);
    throw new Error(`ASR 鉴权网络错误: ${err.message}`);
  }

  if (!resp.ok) {
    const bodyText = await resp.text().catch(() => '');
    console.error('[oauth] HTTP', resp.status, bodyText.slice(0, 300));
    throw new Error(`ASR 鉴权失败 (${resp.status}): ${bodyText.slice(0, 200)}`);
  }

  const data = await resp.json();
  if (!data.access_token) {
    console.error('[oauth] 未返回 token:', JSON.stringify(data).slice(0, 200));
    throw new Error('ASR 鉴权未返回 token');
  }

  console.log('[oauth] token 获取成功, expires_in:', data.expires_in);
  cachedBaiduToken = data.access_token;
  baiduTokenExpiry = Date.now() + (data.expires_in - 3600) * 1000;
  return cachedBaiduToken;
}

// ═══════════════════════════════════════════════
//  LLM Provider 注册表 — chatWithVision(frame,text,history) → {text,error,status}
//  新增供应商：下面加一个 llmXxx 函数，在此对象加一条
// ═══════════════════════════════════════════════

const llmProviders = {
  dashscope: llmDashScope,
};

async function chatWithVision(frame, text, history = []) {
  const fn = llmProviders[LLM_PROVIDER];
  if (!fn) return { text: null, error: `未知 LLM 供应商: ${LLM_PROVIDER}`, status: 500 };
  return fn(frame, text, history);
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
//  请求校验
// ═══════════════════════════════════════════════

function parseAndValidate(body) {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: '请求格式错误，需要 JSON' };
  }

  if (!body.audio || typeof body.audio !== 'string' || body.audio.length < 100) {
    return { valid: false, error: '缺少 audio 参数' };
  }
  if (body.audio.length > 3_000_000) {
    return { valid: false, error: '音频过大（上限 3MB base64）' };
  }

  if (!body.frame || typeof body.frame !== 'string' || !body.frame.startsWith('data:image/')) {
    return { valid: false, error: '缺少 frame 参数或格式不正确' };
  }
  if (body.frame.length > 200_000) {
    return { valid: false, error: '图片过大' };
  }

  const history = Array.isArray(body.history) ? body.history : [];
  // 防御性截断（最多 12 条 = 6 轮）
  if (history.length > 12) {
    history.splice(0, history.length - 12);
  }

  return { valid: true, data: { audio: body.audio, frame: body.frame, history } };
}

// ═══════════════════════════════════════════════
//  辅助
// ═══════════════════════════════════════════════

function json(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' },
  });
}
