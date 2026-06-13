// js/settings.js
// 设置单例 + 从后端获取 Provider 元数据 + 面板动态渲染

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

// ── 运行时状态 ──
let providerMeta = { asr: [], llm: [], tts: [] };
let envConfigured = {};

// ── 工具：field → settings 属性名 ──
function fieldToProp(kind, field) {
  if (field === 'apiKey') return kind === 'llm' ? 'llmApiKey' : 'asrApiKey';
  if (field === 'secretKey') return 'asrSecretKey';
  if (field === 'baseUrl') return 'llmBaseUrl';
  return '';
}

// ── 工具：field → 环境变量名 ──
function fieldToEnv(kind, field) {
  if (kind === 'llm') return field === 'apiKey' ? 'LLM_API_KEY' : 'LLM_BASE_URL';
  if (kind === 'tts') return field === 'apiKey' ? 'ASR_API_KEY' : 'ASR_SECRET_KEY';
  return field === 'apiKey' ? 'ASR_API_KEY' : 'ASR_SECRET_KEY';
}

// ── 初始化面板 ──
export async function initSettingsPanel() {
  // 并行获取 Provider 元数据 + env 配置
  const [provResp, cfgResp] = await Promise.allSettled([
    fetch('/api/providers'),
    fetch('/api/config'),
  ]);

  if (provResp.status === 'fulfilled') {
    try { providerMeta = await provResp.value.json(); } catch (e) { /* keep default */ }
  }
  if (cfgResp.status === 'fulfilled') {
    try { const d = await cfgResp.value.json(); envConfigured = d.env || {}; } catch (e) { /* keep default */ }
  }

  const toggleBtn = document.getElementById('settingsToggle');
  const body = document.getElementById('settingsBody');
  toggleBtn.addEventListener('click', () => {
    body.classList.toggle('hidden');
    toggleBtn.querySelector('.arrow').textContent = body.classList.contains('hidden') ? '▲' : '▼';
  });

  if (!settings.asrApiKey && !settings.llmApiKey && !envConfigured.ASR_API_KEY && !envConfigured.LLM_API_KEY) {
    body.classList.remove('hidden');
    // 智能路径指引
    const dashscopeLlm = (providerMeta.llm || []).some(p => p.id === 'dashscope');
    const guide = document.getElementById('settingsGuide');
    if (guide) { guide.classList.remove('hidden'); guide.textContent = dashscopeLlm ? '💡 只需填入 DashScope Key 即可开始（LLM + ASR 通用）' : '💡 请填入下方各服务的 API Key'; }
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
  const providers = providerMeta[kind] || [];
  if (!providers.length) return;

  const currentId = settings[kind + 'Provider'];
  const provider = providers.find(p => p.id === currentId) || providers[0];
  const single = providers.length === 1;

  section.innerHTML = buildSectionHtml(kind, label, providers, provider, single);
  bindSectionEvents(kind, providers, single);
  bindTestButton(kind, section, providers);
}

function buildSectionHtml(kind, label, providers, provider, single) {
  let html = `<p class="text-gray-500 text-xs font-medium">${label}</p>`;

  // Provider 选择
  if (single) {
    html += `<span class="text-gray-400 text-xs">提供商: ${provider.name}</span>`;
  } else {
    html += `<div class="flex items-center justify-between"><span class="text-gray-400 text-xs">提供商</span><select id="setting_${kind}_provider" class="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm">`;
    for (const p of providers) html += `<option value="${p.id}" ${p.id === settings[kind + 'Provider'] ? 'selected' : ''}>${p.name}</option>`;
    html += `</select></div>`;
  }

  // Key 输入框
  for (const field of provider.fields) {
    const prop = fieldToProp(kind, field);
    const val = escapeAttr(String(settings[prop] || ''));
    const envOk = !!envConfigured[fieldToEnv(kind, field)];
    const isPwd = field !== 'baseUrl';
    const ph = envOk ? '✓ 已通过环境变量配置' : (field === 'apiKey' ? '在此粘贴 API Key' : field === 'secretKey' ? '在此粘贴 Secret Key' : 'https://...（可选）');
    html += `<div class="flex gap-1"><input type="${isPwd ? 'password' : 'text'}" id="setting_${kind}_${field}" class="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm" placeholder="${ph}" value="${val}" ${envOk ? 'disabled' : ''} />${isPwd ? '<button class="toggle-pwd text-xs px-1">👁</button>' : ''}</div>`;
  }

  // LLM 模型
  if (kind === 'llm' && provider.models?.length) {
    html += `<div class="flex items-center justify-between"><span class="text-gray-400 text-xs">模型</span><select id="settingModel" class="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm">`;
    for (const m of provider.models) html += `<option value="${m}" ${settings.model === m ? 'selected' : ''}>${m}</option>`;
    html += `</select></div>`;
  }

  // TTS 复用
  if (kind === 'tts') {
    const asrBaidu = settings.asrProvider === 'baidu';
    html += `<label class="flex items-center gap-2 text-gray-400 text-xs"><input type="checkbox" id="settingTtsReuse" class="w-3 h-3 accent-green-500" ${asrBaidu && settings.ttsReuseAsrKey ? 'checked' : ''} ${!asrBaidu ? 'disabled' : ''} />复用 ASR 的百度 Key${!asrBaidu ? ' <span class="text-gray-600">(ASR 未选百度)</span>' : ''}</label>`;
  }

  if (provider.link) html += `<a href="#" class="reg-link text-blue-400 text-xs hover:underline inline-block" data-url="${provider.link}">注册指引 →</a>`;

  // 测试按钮
  const labelMap = { asr: 'ASR', llm: 'LLM', tts: 'TTS' };
  html += `<div class="flex items-center gap-2 pt-1"><button id="test_${kind}" class="py-1 px-3 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs transition-colors">测试 ${labelMap[kind]}</button><span id="result_${kind}" class="text-xs"></span></div>`;

  return html;
}

function bindTestButton(kind, section, providers) {
  const labelMap = { asr: 'ASR', llm: 'LLM', tts: 'TTS' };
  const btn = section.querySelector(`#test_${kind}`);
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const resultEl = section.querySelector(`#result_${kind}`);
    btn.disabled = true; btn.textContent = '⏳';
    try {
      const provider = providers.find(p => p.id === settings[kind + 'Provider']) || providers[0];
      const body = { service: provider.id };
      if (kind === 'llm') body.llm_api_key = settings.llmApiKey;
      else { body.asr_api_key = settings.asrApiKey; body.asr_secret_key = settings.asrSecretKey; }
      const r = await fetch('/api/ping', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      const sn = { asr: '语音识别', llm: '对话模型', tts: '语音合成' }[kind];
      resultEl.innerHTML = d.ok ? `<span class="text-green-400">✓ ${provider.name} ${sn}连接正常 — API Key 验证通过</span>` : `<span class="text-red-400">✗ ${provider.name} ${sn}: ${d.error || '连接失败'}</span>`;
    } catch (e) { resultEl.innerHTML = '<span class="text-red-400">✗ 网络错误：无法连接到服务器</span>'; }
    btn.disabled = false; btn.textContent = `测试 ${labelMap[kind]}`;
  });
}

// ── 事件绑定（仅在 section 内查询） ──
function bindSectionEvents(kind, providers, single) {
  const section = document.getElementById(kind + 'Section');
  if (!section) return;

  // Provider 切换
  if (!single) {
    const sel = section.querySelector(`#setting_${kind}_provider`);
    if (sel) sel.addEventListener('change', () => {
      settings[kind + 'Provider'] = sel.value;
      renderSection(kind, sectionLabel(kind));
      if (kind === 'asr') renderSection('tts', '语音合成 (TTS)');
    });
  }

  // Key 输入
  const provider = providers.find(p => p.id === settings[kind + 'Provider']) || providers[0];
  for (const field of provider.fields) {
    const input = section.querySelector(`#setting_${kind}_${field}`);
    if (!input || input.disabled) continue;
    const prop = fieldToProp(kind, field);
    input.addEventListener('input', () => { settings[prop] = input.value; });
  }

  // LLM 模型
  if (kind === 'llm') {
    const model = section.querySelector('#settingModel');
    if (model) model.addEventListener('change', () => { settings.model = model.value; });
  }

  // TTS 复用
  if (kind === 'tts') {
    const reuseBox = section.querySelector('#settingTtsReuse');
    if (reuseBox) reuseBox.addEventListener('change', () => {
      settings.ttsReuseAsrKey = reuseBox.checked;
      renderSection('tts', '语音合成 (TTS)');
    });
  }

  // 密码切换
  section.querySelectorAll('.toggle-pwd').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = btn.previousElementSibling;
      if (input && input.type === 'password') { input.type = 'text'; btn.textContent = '🙈'; }
      else if (input) { input.type = 'password'; btn.textContent = '👁'; }
    });
  });

  // 注册链接
  section.querySelectorAll('.reg-link').forEach(link => {
    link.addEventListener('click', e => { e.preventDefault(); const u = link.dataset.url; if (u) window.open(u, '_blank'); });
  });
}

function sectionLabel(k) { return { asr: '语音识别 (ASR)', llm: '对话模型 (LLM)', tts: '语音合成 (TTS)' }[k] || ''; }

// ── 静态控件 ──
function bindStaticControls() {
  const ttsCheck = document.getElementById('settingTTS');
  if (ttsCheck) { ttsCheck.checked = settings.ttsEnabled; ttsCheck.addEventListener('change', () => { settings.ttsEnabled = ttsCheck.checked; }); }

  const q = document.getElementById('settingQuality'), ql = document.getElementById('settingQualityLabel');
  if (q) { q.value = settings.frameQuality; ql.textContent = Math.round(settings.frameQuality * 100) + '%'; q.addEventListener('input', () => { settings.frameQuality = parseFloat(q.value); ql.textContent = Math.round(settings.frameQuality * 100) + '%'; }); }

  const saveBtn = document.getElementById('saveSettings');
  if (saveBtn) saveBtn.addEventListener('click', () => {
    const parts = [];
    const asrName = providerMeta.asr?.find?.(p => p.id === settings.asrProvider)?.name || { baidu: '百度', dashscope: 'DashScope' }[settings.asrProvider] || settings.asrProvider;
    const llmName = providerMeta.llm?.find?.(p => p.id === settings.llmProvider)?.name || { dashscope: 'DashScope' }[settings.llmProvider] || settings.llmProvider;
    if (settings.asrApiKey || envConfigured.ASR_API_KEY) parts.push(`ASR: ${asrName} ✓`);
    else parts.push(`ASR: 未配置`);
    if (settings.llmApiKey || envConfigured.LLM_API_KEY) parts.push(`LLM: ${llmName} ✓`);
    else parts.push(`LLM: 未配置`);
    showToast(`✓ 设置已保存 — ${parts.join(' | ')}`);
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
