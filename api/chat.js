// api/chat.js
// Vercel Edge Function — ASR + 多模态 LLM 编排

export const config = { runtime: 'edge' };

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

  if (req.method !== 'POST') {
    return json(405, { text: null, error: '仅支持 POST' });
  }

  // ── 解析 multipart/form-data ──
  let formData;
  try {
    formData = await req.formData();
  } catch {
    return json(400, { text: null, error: '请求格式错误，需要 multipart/form-data' });
  }

  const audio = formData.get('audio');
  const frame = formData.get('frame');

  // ── 参数校验 ──
  if (!audio || !(audio instanceof Blob) || audio.size === 0) {
    return json(400, { text: null, error: '缺少 audio 参数' });
  }
  if (audio.size > 5_000_000) {
    return json(400, { text: null, error: '音频过大（上限 5MB）' });
  }
  if (!frame || typeof frame !== 'string' || !frame.startsWith('data:image/')) {
    return json(400, { text: null, error: '缺少 frame 参数或格式不正确' });
  }
  if (frame.length > 200_000) {
    return json(400, { text: null, error: '图片过大，请降低分辨率' });
  }

  try {
    // ── Step 1: 上传音频到云存储 ──
    const audioUrl = await uploadToStorage(audio);

    // ── Step 2: 调用 ASR 服务 ──
    const text = await speechToText(audioUrl);

    if (!text || text.trim().length === 0) {
      return json(200, { text: null, error: '未识别到语音内容，请重试' });
    }

    // ── Step 3: 调用多模态 LLM ──
    const reply = await chatWithVision(frame, text);

    return json(200, { text: reply, error: null });

  } catch (err) {
    return json(500, { text: null, error: `服务处理失败: ${err.message}` });
  }
}

// ── 上传音频到云存储（S3 兼容 API） ──
async function uploadToStorage(audioBlob) {
  const endpoint = process.env.STORAGE_ENDPOINT;
  const bucket = process.env.STORAGE_BUCKET;
  const accessKey = process.env.STORAGE_ACCESS_KEY;
  const secretKey = process.env.STORAGE_SECRET_KEY;
  const region = process.env.STORAGE_REGION || 'auto';

  if (!endpoint || !bucket || !accessKey || !secretKey) {
    throw new Error('云存储未配置');
  }

  const fileName = `audio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.webm`;

  // 构造 S3 兼容的 PUT 请求
  const url = `${endpoint}/${bucket}/${fileName}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  const resp = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'audio/webm',
      'Authorization': signRequest('PUT', `/${bucket}/${fileName}`, accessKey, secretKey, region),
    },
    body: audioBlob,
    signal: controller.signal,
  });
  clearTimeout(timeout);

  if (!resp.ok) {
    throw new Error(`云存储上传失败 (${resp.status})`);
  }

  // 返回可访问的 URL（供 ASR 服务使用）
  return `${endpoint}/${bucket}/${fileName}`;
}

// ── 调用 ASR 服务 ──
async function speechToText(audioUrl) {
  const asrEndpoint = process.env.ASR_API_ENDPOINT;
  const asrKey = process.env.ASR_API_KEY;

  if (!asrEndpoint || !asrKey) {
    throw new Error('ASR 服务未配置');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  const resp = await fetch(asrEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${asrKey}`,
    },
    body: JSON.stringify({ audio_url: audioUrl }),
    signal: controller.signal,
  });
  clearTimeout(timeout);

  if (!resp.ok) {
    throw new Error(`ASR 服务返回错误 (${resp.status})`);
  }

  const data = await resp.json();
  // 兼容多种 ASR 响应格式
  return data.text || data.result || data.data?.text || '';
}

// ── 调用多模态 LLM（OpenAI 兼容 API） ──
async function chatWithVision(frame, text) {
  const apiKey = process.env.LLM_API_KEY;
  const baseUrl = process.env.LLM_BASE_URL;
  const model = process.env.LLM_MODEL || 'gpt-4o';

  if (!apiKey || !baseUrl) {
    throw new Error('LLM 服务未配置');
  }

  const body = {
    model,
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: controller.signal,
  });
  clearTimeout(timeout);

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`LLM 返回错误 (${resp.status}): ${errText.slice(0, 200)}`);
  }

  const data = await resp.json();
  const reply = data.choices?.[0]?.message?.content;

  if (!reply) {
    throw new Error('LLM 返回为空');
  }

  return reply;
}

// ── S3 兼容签名 ──
// Phase 1 简化：假设存储服务使用 Bearer Token 鉴权
function signRequest(_method, _path, _accessKey, secretKey, _region) {
  return `Bearer ${secretKey}`;
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
