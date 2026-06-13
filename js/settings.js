// js/settings.js
// 设置单例 — localStorage 持久化，其他模块通过 import 访问

export const settings = {
  // ── 模型 ──
  get model() { return localStorage.getItem('model') || 'qwen-vl-plus'; },
  set model(v) { localStorage.setItem('model', v); },

  // ── 提供商 ──
  get asrProvider() { return localStorage.getItem('asr_provider') || 'baidu'; },
  set asrProvider(v) { localStorage.setItem('asr_provider', v); },
  get llmProvider() { return localStorage.getItem('llm_provider') || 'dashscope'; },
  set llmProvider(v) { localStorage.setItem('llm_provider', v); },
  get ttsProvider() { return localStorage.getItem('tts_provider') || 'baidu'; },
  set ttsProvider(v) { localStorage.setItem('tts_provider', v); },

  // ── API Keys ──
  get asrApiKey() { return localStorage.getItem('asr_api_key') || ''; },
  set asrApiKey(v) { localStorage.setItem('asr_api_key', v); },
  get asrSecretKey() { return localStorage.getItem('asr_secret_key') || ''; },
  set asrSecretKey(v) { localStorage.setItem('asr_secret_key', v); },
  get llmApiKey() { return localStorage.getItem('llm_api_key') || ''; },
  set llmApiKey(v) { localStorage.setItem('llm_api_key', v); },

  // ── TTS ──
  get ttsEnabled() { return localStorage.getItem('tts') !== 'false'; },
  set ttsEnabled(v) { localStorage.setItem('tts', String(v)); },

  // ── 帧质量 ──
  get frameQuality() { return parseFloat(localStorage.getItem('quality') || '0.6'); },
  set frameQuality(v) { localStorage.setItem('quality', String(v)); },

  // ── 首次使用 ──
  get hasConversed() { return localStorage.getItem('has_conversed') === 'true'; },
  set hasConversed(v) { localStorage.setItem('has_conversed', String(v)); },
};

// ── 注册指引链接 ──
const REG_LINKS = {
  dashscope: 'https://help.aliyun.com/zh/model-studio/getting-started/what-is-model-studio',
  baidu: 'https://ai.baidu.com/ai-doc/REFERENCE/Ck3dwjgn3',
};

// ── 设置面板 UI ──
let envConfigured = { asr: false, llm: false };

export async function initSettingsPanel() {
  // 获取环境变量配置状态
  try {
    const resp = await fetch('/api/config');
    const data = await resp.json();
    envConfigured = { asr: data.asr_configured, llm: data.llm_configured };
  } catch (e) { /* 默认 false */ }

  const panel = document.getElementById('settingsPanel');
  const toggleBtn = document.getElementById('settingsToggle');
  const body = document.getElementById('settingsBody');

  toggleBtn.addEventListener('click', () => {
    body.classList.toggle('hidden');
    toggleBtn.querySelector('.arrow').textContent = body.classList.contains('hidden') ? '▲' : '▼';
  });

  // 首次打开自动展开
  if (!settings.asrApiKey && !settings.llmApiKey && !envConfigured.asr && !envConfigured.llm) {
    body.classList.remove('hidden');
  }

  bindSettingsControls();
}

function bindSettingsControls() {
  // ASR Provider
  const asrSelect = document.getElementById('settingAsrProvider');
  if (asrSelect) { asrSelect.value = settings.asrProvider; asrSelect.addEventListener('change', () => { settings.asrProvider = asrSelect.value; }); }

  // DashScope (LLM + ASR) Key
  const dsKey = document.getElementById('settingDsKey');
  if (dsKey) {
    dsKey.value = settings.llmApiKey;
    if (envConfigured.llm) { dsKey.placeholder = '✓ 已通过环境变量配置'; dsKey.disabled = true; }
    dsKey.addEventListener('input', () => { settings.llmApiKey = dsKey.value; settings.asrApiKey = dsKey.value; });
  }

  // 百度 Key（ASR + TTS）
  const bdApi = document.getElementById('settingBdApiKey');
  if (bdApi) {
    bdApi.value = settings.asrApiKey;
    if (envConfigured.asr) { bdApi.placeholder = '✓ 已通过环境变量配置'; bdApi.disabled = true; }
    bdApi.addEventListener('input', () => { settings.asrApiKey = bdApi.value; });
  }
  const bdSecret = document.getElementById('settingBdSecret');
  if (bdSecret) {
    bdSecret.value = settings.asrSecretKey;
    if (envConfigured.asr) { bdSecret.disabled = true; }
    bdSecret.addEventListener('input', () => { settings.asrSecretKey = bdSecret.value; });
  }

  // 模型
  const modelSelect = document.getElementById('settingModel');
  if (modelSelect) { modelSelect.value = settings.model; modelSelect.addEventListener('change', () => { settings.model = modelSelect.value; }); }

  // TTS
  const ttsCheck = document.getElementById('settingTTS');
  if (ttsCheck) { ttsCheck.checked = settings.ttsEnabled; ttsCheck.addEventListener('change', () => { settings.ttsEnabled = ttsCheck.checked; }); }

  // 帧质量
  const qualitySlider = document.getElementById('settingQuality');
  const qualityLabel = document.getElementById('settingQualityLabel');
  if (qualitySlider) {
    qualitySlider.value = settings.frameQuality;
    qualityLabel.textContent = Math.round(settings.frameQuality * 100) + '%';
    qualitySlider.addEventListener('input', () => {
      settings.frameQuality = parseFloat(qualitySlider.value);
      qualityLabel.textContent = Math.round(settings.frameQuality * 100) + '%';
    });
  }

  // 密码框切换可见性
  document.querySelectorAll('.toggle-pwd').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = btn.previousElementSibling;
      if (input.type === 'password') { input.type = 'text'; btn.textContent = '🙈'; }
      else { input.type = 'password'; btn.textContent = '👁'; }
    });
  });

  // 注册指引链接
  document.querySelectorAll('.reg-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const provider = link.dataset.provider;
      if (REG_LINKS[provider]) window.open(REG_LINKS[provider], '_blank');
    });
  });

  // 测试连接
  const testBtn = document.getElementById('testConnection');
  if (testBtn) {
    testBtn.addEventListener('click', async () => {
      const resultEl = document.getElementById('testResult');
      testBtn.disabled = true;
      testBtn.textContent = '⏳ 测试中...';
      try {
        const resp = await fetch('/api/ping', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            llm_api_key: settings.llmApiKey,
            llm_base_url: settings.llmProvider === 'dashscope' ? 'https://dashscope.aliyuncs.com/compatible-mode/v1' : undefined,
          }),
        });
        const data = await resp.json();
        if (data.ok) {
          resultEl.innerHTML = '<span class="text-green-400">✓ 连接成功</span>';
        } else {
          resultEl.innerHTML = '<span class="text-red-400">✗ ' + (data.error || '连接失败') + '</span>';
        }
      } catch (err) {
        resultEl.innerHTML = '<span class="text-red-400">✗ 网络错误</span>';
      }
      testBtn.disabled = false;
      testBtn.textContent = '测试连接';
    });
  }

  // 保存按钮 + Toast
  const saveBtn = document.getElementById('saveSettings');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      const model = settings.model;
      const asr = settings.asrProvider === 'dashscope' ? 'DashScope' : '百度';
      const tts = settings.ttsEnabled ? '开' : '关';
      const quality = Math.round(settings.frameQuality * 100) + '%';
      const dsOk = settings.llmApiKey || envConfigured.llm;
      const bdOk = settings.asrApiKey || envConfigured.asr;
      showToast(`设置已保存 — 模型: ${model} | ASR: ${asr} | DashScope: ${dsOk ? '✓' : '✗'} | 百度: ${bdOk ? '✓' : '✗'} | TTS: ${tts} | 帧质量: ${quality}`);
    });
  }
}

// Toast 提示（页面底部居中，3s 消失）
function showToast(msg) {
  const existing = document.querySelector('.settings-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'settings-toast fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-gray-800 border border-gray-600 rounded-xl px-4 py-2 text-white text-xs shadow-lg transition-opacity';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3000);
}
