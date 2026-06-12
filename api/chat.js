// api/chat.js
// Vercel Edge Function — 多模态 LLM 代理

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
    return json(405, { text: null, error: '仅支持 POST' });
  }

  let body;
  try { body = await req.json(); } catch {
    return json(400, { text: null, error: '请求格式错误，需要 JSON' });
  }

  const { frame, text } = body;

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return json(400, { text: null, error: '缺少 text 参数' });
  }
  if (!frame || typeof frame !== 'string' || !frame.startsWith('data:image/')) {
    return json(400, { text: null, error: '缺少 frame 参数或格式不正确' });
  }
  if (frame.length > 200_000) {
    return json(400, { text: null, error: '图片过大' });
  }

  const apiKey = process.env.LLM_API_KEY;
  const baseUrl = process.env.LLM_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  const model = process.env.LLM_MODEL || 'qwen-vl-plus';

  if (!apiKey) {
    return json(500, { text: null, error: '服务未配置 API Key' });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);

    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: [
              '你是视觉对话助手。用户给你一张摄像头画面和一个问题。',
              '结合画面简洁回答。150字以内，口语化，中文。',
              '不编造不存在的内容。不确定时诚实说明。',
              '不需要"我看到了..."开场白，直接回答。',
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
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      return json(500, { text: null, error: `LLM 错误 (${resp.status})` });
    }

    const data = await resp.json();
    const reply = data.choices?.[0]?.message?.content;

    if (!reply) {
      return json(500, { text: null, error: 'LLM 返回为空' });
    }

    return json(200, { text: reply, error: null });

  } catch (err) {
    if (err.name === 'AbortError') {
      return json(500, { text: null, error: 'AI 响应超时，请重试' });
    }
    return json(500, { text: null, error: '服务调用失败' });
  }
}

function json(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
