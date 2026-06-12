// api/chat.js
// Vercel Edge Function — 接收 frame + text，转发给 GPT-4o

export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  // ── CORS 预检 ──
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  // ── 只接受 POST ──
  if (req.method !== 'POST') {
    return json(405, { text: null, error: '仅支持 POST' });
  }

  // ── 解析请求 ──
  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { text: null, error: '请求格式错误，需要 JSON' });
  }

  const { frame, text } = body;

  // ── 参数校验 ──
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return json(400, { text: null, error: '缺少 text 参数' });
  }
  if (!frame || typeof frame !== 'string' || !frame.startsWith('data:image/')) {
    return json(400, { text: null, error: '缺少 frame 参数或格式不正确' });
  }
  // frame 大小限制：防止 base64 过大导致超时
  if (frame.length > 200_000) {
    return json(400, { text: null, error: '图片过大，请降低分辨率' });
  }

  // ── 构造 OpenAI 请求 ──
  const apiKey = process.env.OPENAI_API_KEY;
  const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';

  if (!apiKey) {
    return json(500, { text: null, error: '服务配置错误：未设置 API Key' });
  }

  const openaiBody = {
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: [
          '你是视觉对话助手。用户给你一张摄像头拍摄的画面和一个问题。',
          '请结合画面内容简洁回答。回复控制在150字以内，口语化，中文。',
          '不要编造画面中不存在的内容。不确定时诚实说明。',
          '不需要说"我看到了..."这类开场白，直接回答问题。',
        ].join(' '),
      },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: frame } },
          { type: 'text', text: text },
        ],
      },
    ],
    max_tokens: 300,
    temperature: 0.7,
  };

  // ── 调用 OpenAI（原生 fetch，不用 SDK） ──
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000); // 25s 超时

    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(openaiBody),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      const errText = await resp.text();
      return json(500, { text: null, error: `AI 服务返回错误 (${resp.status}): ${errText.slice(0, 200)}` });
    }

    const data = await resp.json();
    const reply = data.choices?.[0]?.message?.content;

    if (!reply) {
      return json(500, { text: null, error: 'AI 返回为空' });
    }

    return json(200, { text: reply, error: null });

  } catch (err) {
    if (err.name === 'AbortError') {
      return json(500, { text: null, error: 'AI 响应超时（超过25秒），请重试' });
    }
    return json(500, { text: null, error: `AI 服务调用失败: ${err.message}` });
  }
}

// ── 辅助函数 ──
function json(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
