// js/settings.js
// 设置单例 + Provider 元数据 + 面板动态渲染

// ── Provider 元数据（新增 Provider 只需在此加一条） ──
const PROVIDERS = {
  asr: [
    { id: 'baidu', name: '百度', fields: ['apiKey', 'secretKey'], link: 'https://ai.baidu.com/ai-doc/REFERENCE/Ck3dwjgn3' },
    { id: 'dashscope', name: 'DashScope', fields: ['apiKey'], link: 'https://help.aliyun.com/zh/model-studio/getting-started/what-is-model-studio' },
  ],
  llm: [
    { id: 'dashscope', name: 'DashScope', fields: ['apiKey', 'baseUrl'], link: 'https://help.aliyun.com/zh/model-studio/getting-started/what-is-model-studio' },
  ],
  tts: [
    { id: 'baidu', name: '百度', fields: ['apiKey', 'secretKey'], link: 'https://ai.baidu.com/ai-doc/REFERENCE/Ck3dwjgn3' },
  ],
};

// ── 设置单例 ──
export const settings = {
  get model() { return localStorage.getItem('model') || 'qwen-vl-plus'; },
  set model(v) { localStorage.setItem('model', v); },

  get asrProvider() { return localStorage.getItem('asr_provider') || 'baidu'; },
  set asrProvider(v) { localStorage.setItem('asr_provider', v); },
  get llmProvider() { return localStorage.getItem('llm_provider') || 'dashscope'; },
  set llmProvider(v) { localStorage.setItem('llm_provider', v); },
  get ttsProvider() { return localStorage.getItem('tts_provider') || 'baidu'; },
  set ttsProvider(v) { localStorage.setItem('tts_provider', v); },

  get asrApiKey() { return localStorage.getItem('asr_api_key') || ''; },
  set asrApiKey(v) { localStorage.setItem('asr_api_key', v); },
  get asrSecretKey() { return localStorage.getItem('asr_secret_key') || ''; },
  set asrSecretKey(v) { localStorage.setItem('asr_secret_key', v); },
  get llmApiKey() { return localStorage.getItem('llm_api_key') || ''; },
  set llmApiKey(v) { localStorage.setItem('llm_api_key', v); },
  get llmBaseUrl() { return localStorage.getItem('llm_base_url') || ''; },
  set llmBaseUrl(v) { localStorage.setItem('llm_base_url', v); },

  get ttsReuseAsrKey() { return localStorage.getItem('tts_reuse_asr') !== 'false'; },
  set ttsReuseAsrKey(v) { localStorage.setItem('tts_reuse_asr', String(v)); },
  get ttsEnabled() { return localStorage.getItem('tts') !== 'false'; },
  set ttsEnabled(v) { localStorage.setItem('tts', String(v)); },

  get frameQuality() { return parseFloat(localStorage.getItem('quality') || '0.6'); },
  set frameQuality(v) { localStorage.setItem('quality', String(v)); },

  get hasConversed() { return localStorage.getItem('has_conversed') === 'true'; },
  set hasConversed(v) { localStorage.setItem('has_conversed', String(v)); },
};

let envConfigured = { asr: false, llm: false };

// ── 初始化面板 ──
export async function initSettingsPanel() {
  try {
    const resp = await fetch('/api/config');
    const data = await resp.json();
    envConfigured = { asr: data.asr_configured, llm: data.llm_configured };
  } catch (e) { /* 默认 false */ }

  const toggleBtn = document.getElementById('settingsToggle');
  const body = document.getElementById('settingsBody');
  toggleBtn.addEventListener('click', () => {
    body.classList.toggle('hidden');
    toggleBtn.querySelector('.arrow').textContent = body.classList.contains('hidden') ? '▲' : '▼';
  });

  if (!settings.asrApiKey && !settings.llmApiKey && !envConfigured.asr && !envConfigured.llm) {
    body.classList.remove('hidden');
  }

  renderAllSections();
  bindStaticControls();
}

// ── 渲染三个 Provider 层 ──
function renderAllSections() {
  renderSection('asr', '语音识别 (ASR)');
  renderSection('llm', '对话模型 (LLM)');
  renderSection('tts', '语音合成 (TTS)');
}

function renderSection(kind, label) {
  const section = document.getElementById(kind + 'Section');
  if (!section) return;
  const providers = PROVIDERS[kind];
  const currentId = settings[kind + 'Provider'];
  const provider = providers.find(p => p.id === currentId) || providers[0];
  const single = providers.length === 1;
  const envOk = kind === 'asr' ? envConfigured.asr : envConfigured.llm;
  const fieldLabels = { apiKey: 'API Key', secretKey: 'Secret Key', baseUrl: 'Base URL' };

  let html = `<p class="text-gray-500 text-xs font-medium">${label}</p>`;

  // Provider 下拉（单 provider 时显示标签文字）
  if (single) {
    html += `<span class="text-gray-400 text-xs">提供商: ${provider.name}</span>`;
  } else {
    html += `<div class="flex items-center justify-between">`;
    html += `<span class="text-gray-400 text-xs">提供商</span>`;
    html += `<select id="setting_${kind}_provider" class="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm">`;
    for (const p of providers) {
      html += `<option value="${p.id}" ${p.id === currentId ? 'selected' : ''}>${p.name}</option>`;
    }
    html += `</select></div>`;
  }

  // Key 输入框（根据 Provider.fields 动态生成）
  for (const field of provider.fields) {
    const valKey = field === 'apiKey' ? (kind === 'llm' ? 'llmApiKey' : 'asrApiKey')
                : field === 'secretKey' ? 'asrSecretKey'
                : 'llmBaseUrl';
    const isPwd = field !== 'baseUrl';
    const disabled = envOk ? 'disabled' : '';
    const placeholder = envOk ? '✓ 已通过环境变量配置' : (fieldLabels[field] ? '在此粘贴 ' + fieldLabels[field] : '');
    const value = escapeAttr(String(settings[valKey] || ''));

    html += `<div class="flex gap-1">`;
    html += `<input type="${isPwd ? 'password' : 'text'}" id="setting_${kind}_${field}" class="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm" placeholder="${placeholder}" value="${value}" ${disabled} />`;
    if (isPwd) html += `<button class="toggle-pwd text-xs px-1">👁</button>`;
    html += `</div>`;
  }

  // LLM: 模型选择器
  if (kind === 'llm') {
    html += `<div class="flex items-center justify-between">`;
    html += `<span class="text-gray-400 text-xs">模型</span>`;
    html += `<select id="settingModel" class="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm">`;
    for (const m of ['qwen-vl-plus', 'qwen-vl-max']) {
      html += `<option value="${m}" ${settings.model === m ? 'selected' : ''}>${m}</option>`;
    }
    html += `</select></div>`;
  }

  // TTS: 复用 ASR Key
  if (kind === 'tts') {
    const asrBaidu = settings.asrProvider === 'baidu';
    const reuse = asrBaidu && settings.ttsReuseAsrKey;
    html += `<label class="flex items-center gap-2 text-gray-400 text-xs">`;
    html += `<input type="checkbox" id="settingTtsReuse" class="w-3 h-3 accent-green-500" ${reuse ? 'checked' : ''} ${!asrBaidu ? 'disabled' : ''} />`;
    html += `复用 ASR 的百度 Key`;
    if (!asrBaidu) html += ` <span class="text-gray-600">(ASR 未选百度)</span>`;
    html += `</label>`;
  }

  // 注册链接
  if (provider.link) {
    html += `<a href="#" class="reg-link text-blue-400 text-xs hover:underline inline-block" data-url="${provider.link}">注册指引 →</a>`;
  }

  section.innerHTML = html;
  bindSectionEvents(kind, providers, single);
}

// ── 事件绑定 ──
function bindSectionEvents(kind, providers, single) {
  // Provider 切换
  if (!single) {
    const sel = document.getElementById(`setting_${kind}_provider`);
    if (sel) sel.addEventListener('change', () => {
      settings[kind + 'Provider'] = sel.value;
      renderSection(kind, sectionLabel(kind));
      if (kind === 'asr') renderSection('tts', '语音合成 (TTS)');
    });
  }

  // Key 输入
  const provider = providers.find(p => p.id === settings[kind + 'Provider']) || providers[0];
  for (const field of provider.fields) {
    const input = document.getElementById(`setting_${kind}_${field}`);
    if (!input || input.disabled) continue;
    const valKey = field === 'apiKey' ? (kind === 'llm' ? 'llmApiKey' : 'asrApiKey')
                : field === 'secretKey' ? 'asrSecretKey' : 'llmBaseUrl';
    input.addEventListener('input', () => { settings[valKey] = input.value; });
  }

  // LLM 模型
  if (kind === 'llm') {
    const model = document.getElementById('settingModel');
    if (model) model.addEventListener('change', () => { settings.model = model.value; });
  }

  // TTS 复用
  if (kind === 'tts') {
    const reuseBox = document.getElementById('settingTtsReuse');
    if (reuseBox) reuseBox.addEventListener('change', () => {
      settings.ttsReuseAsrKey = reuseBox.checked;
      renderSection('tts', '语音合成 (TTS)');
    });
  }

  // 密码 👁
  document.querySelectorAll('.toggle-pwd').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = btn.previousElementSibling;
      if (input && input.type === 'password') { input.type = 'text'; btn.textContent = '🙈'; }
      else if (input) { input.type = 'password'; btn.textContent = '👁'; }
    });
  });

  // 注册链接
  document.querySelectorAll('.reg-link').forEach(link => {
    link.addEventListener('click', (e) => { e.preventDefault(); const u = link.dataset.url; if (u) window.open(u, '_blank'); });
  });
}

function sectionLabel(k) { return { asr: '语音识别 (ASR)', llm: '对话模型 (LLM)', tts: '语音合成 (TTS)' }[k] || ''; }

// ── 静态控件 ──
function bindStaticControls() {
  const ttsCheck = document.getElementById('settingTTS');
  if (ttsCheck) { ttsCheck.checked = settings.ttsEnabled; ttsCheck.addEventListener('change', () => { settings.ttsEnabled = ttsCheck.checked; }); }

  const q = document.getElementById('settingQuality'), ql = document.getElementById('settingQualityLabel');
  if (q) { q.value = settings.frameQuality; ql.textContent = Math.round(settings.frameQuality * 100) + '%'; q.addEventListener('input', () => { settings.frameQuality = parseFloat(q.value); ql.textContent = Math.round(settings.frameQuality * 100) + '%'; }); }

  wireTest('testDashScope', { service: 'dashscope', llm_api_key: settings.llmApiKey });
  wireTest('testBaidu', { service: 'baidu', asr_api_key: settings.asrApiKey, asr_secret_key: settings.asrSecretKey });

  const saveBtn = document.getElementById('saveSettings');
  if (saveBtn) saveBtn.addEventListener('click', () => {
    const dsOk = settings.llmApiKey || envConfigured.llm;
    const bdOk = settings.asrApiKey || envConfigured.asr;
    showToast(`设置已保存 — 模型: ${settings.model} | ASR: ${settings.asrProvider === 'dashscope' ? 'DashScope' : '百度'} | DashScope: ${dsOk ? '✓' : '✗'} | 百度: ${bdOk ? '✓' : '✗'} | TTS: ${settings.ttsEnabled ? '开' : '关'} | 帧: ${Math.round(settings.frameQuality * 100)}%`);
  });
}

function wireTest(btnId, body) {
  const btn = document.getElementById(btnId); if (!btn) return;
  btn.addEventListener('click', async () => {
    const resultEl = document.getElementById('testResult'), label = btnId === 'testDashScope' ? 'DashScope' : '百度';
    btn.disabled = true; btn.textContent = '⏳ 测试中...';
    try {
      const r = await fetch('/api/ping', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      resultEl.innerHTML = d.ok ? `<span class="text-green-400">✓ ${label} 连接成功</span>` : `<span class="text-red-400">✗ ${label}: ${d.error || '连接失败'}</span>`;
    } catch (e) { resultEl.innerHTML = `<span class="text-red-400">✗ ${label}: 网络错误</span>`; }
    btn.disabled = false; btn.textContent = '测试 ' + label;
  });
}

function showToast(msg) {
  const old = document.querySelector('.settings-toast'); if (old) old.remove();
  const t = document.createElement('div');
  t.className = 'settings-toast fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-gray-800 border border-gray-600 rounded-xl px-4 py-2 text-white text-xs shadow-lg';
  t.textContent = msg; document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3000);
}

function escapeAttr(s) { return String(s || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
