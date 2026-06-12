// api/chat.js
// Vercel Edge Function — 百度 ASR + DashScope LLM

export const config = { runtime: 'edge' };

// ── Token 缓存（module-level，跨 warm start 复用） ──
let cachedToken = null;
let tokenExpiry = 0;

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
    return json(405, { text: null, error: '仅支持 POST' });
  }

  // ── 解析 JSON ──
  let body;
  try { body = await req.json(); } catch {
    return json(400, { text: null, error: '请求格式错误，需要 JSON' });
  }

  const { audio, pcmLen, frame } = body;

  if (!audio || typeof audio !== 'string' || audio.length < 100) {
    return json(400, { text: null, error: '缺少 audio 参数' });
  }
  if (audio.length > 3_000_000) {
    return json(400, { text: null, error: '音频过大（上限 3MB base64）' });
  }
  const dataLen = pcmLen || Math.round(audio.length * 0.75);
  if (!frame || typeof frame !== 'string' || !frame.startsWith('data:image/')) {
    return json(400, { text: null, error: '缺少 frame 参数或格式不正确' });
  }
  if (frame.length > 200_000) {
    return json(400, { text: null, error: '图片过大' });
  }

  const dashKey = process.env.LLM_API_KEY;
  if (!dashKey) {
    return json(500, { text: null, error: '服务未配置 DashScope Key' });
  }

  const tTotal = Date.now();
  try {

    // ── Step 1: 百度 ASR ──
    const t1 = Date.now();
    const bdApiKey = process.env.BAIDU_API_KEY;
    const bdSecret = process.env.BAIDU_SECRET_KEY;

    if (!bdApiKey || !bdSecret) {
      return json(500, { text: null, error: '服务未配置百度语音 Key' });
    }

    const tOAuth = Date.now();
    const token = await getBaiduToken(bdApiKey, bdSecret);
    console.log('[api] 百度OAuth 耗时', Date.now() - tOAuth, 'ms');

    const tASR = Date.now();
    const text = await baiduASR(token, audio, dataLen);
    console.log('[api] 百度ASR 耗时', Date.now() - tASR, 'ms, text:', text?.slice(0, 60));

    if (!text || text.trim().length === 0) {
      return json(200, { text: null, error: '未识别到语音内容，请重试' });
    }

    // ── Step 2: DashScope LLM ──
    const t2 = Date.now();
    const baseUrl = process.env.LLM_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    const model = process.env.LLM_MODEL || 'qwen-vl-plus';

    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${dashKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: [
            '你是视觉对话助手。用户给你一张摄像头画面和一个问题。',
            '结合画面简洁回答。150字以内，口语化，中文。',
            '不编造不存在的内容。不确定时诚实说明。',
            '不需要"我看到了..."开场白，直接回答。',
          ].join(' ') },
          { role: 'user', content: [
            { type: 'image_url', image_url: { url: frame } },
            { type: 'text', text },
          ] },
        ],
        max_tokens: 300, temperature: 0.7,
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      console.error('[api] LLM error:', resp.status, errText.slice(0, 200));
      return json(500, { text: null, error: `LLM 错误 (${resp.status})` });
    }

    const llmData = await resp.json();
    const reply = llmData.choices?.[0]?.message?.content;
    if (!reply) {
      return json(500, { text: null, error: 'LLM 返回为空' });
    }

    console.log('[api] LLM 耗时', Date.now() - t2, 'ms, 总耗时', Date.now() - tTotal, 'ms');
    return json(200, { text: reply, error: null });

  } catch (err) {
    const totalElapsed = Date.now() - tTotal;
    if (err.name === 'AbortError') {
      console.error('[api] 超时, 已耗时', totalElapsed, 'ms');
      return json(500, { text: null, error: `请求超时 (${totalElapsed}ms)，请重试` });
    }
    console.error('[api] 异常, 已耗时', totalElapsed, 'ms:', err.message);
    return json(500, { text: null, error: err.message });
  }
}

// ── 百度 OAuth Token（缓存 29 天） ──
async function getBaiduToken(apiKey, secretKey) {
  if (cachedToken && Date.now() < tokenExpiry) {
    console.log('[baidu] 使用缓存 token');
    return cachedToken;
  }

  const resp = await fetch(
    `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${apiKey}&client_secret=${secretKey}`,
    { signal: AbortSignal.timeout(5_000) }
  );

  if (!resp.ok) {
    throw new Error(`百度鉴权失败 (${resp.status})`);
  }

  const data = await resp.json();
  if (!data.access_token) {
    console.error('[baidu] 鉴权响应:', JSON.stringify(data));
    throw new Error('百度鉴权未返回 token');
  }

  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 3600) * 1000; // 提前 1 小时刷新
  console.log('[baidu] 获取 token 成功, expires_in:', data.expires_in);
  return cachedToken;
}

// ── 百度短语音识别 ──
async function baiduASR(token, audioBase64, dataLen) {
  const resp = await fetch('https://vop.baidu.com/server_api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      format: 'pcm',
      rate: 16000,
      dev_pid: 1537,       // 中文普通话
      channel: 1,
      token,
      cuid: 'ai-visual-chat',
      len: dataLen,
      speech: audioBase64,
    }),
    signal: AbortSignal.timeout(20_000),
  });

  const data = await resp.json();
  console.log('[baidu] ASR 完整响应:', JSON.stringify(data).slice(0, 500));
  console.log('[baidu] 使用 token:', token.slice(0, 10) + '...');

  if (data.err_no !== 0) {
    throw new Error(`百度 ASR 错误 (${data.err_no}): ${data.err_msg}`);
  }

  return Array.isArray(data.result) ? data.result.join('') : (data.result || '');
}

// ── 辅助 ──
function json(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' },
  });
}
