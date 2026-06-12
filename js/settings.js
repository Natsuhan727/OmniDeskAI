// js/settings.js
// 设置单例 — localStorage 持久化，其他模块通过 import 访问

export const settings = {
  get model() { return localStorage.getItem('model') || 'qwen-vl-plus'; },
  set model(v) { localStorage.setItem('model', v); },

  get ttsEnabled() { return localStorage.getItem('tts') !== 'false'; },
  set ttsEnabled(v) { localStorage.setItem('tts', String(v)); },

  get frameQuality() { return parseFloat(localStorage.getItem('quality') || '0.6'); },
  set frameQuality(v) { localStorage.setItem('quality', String(v)); },
};

// ── 设置面板 UI ──
export function initSettingsPanel() {
  const panel = document.getElementById('settingsPanel');
  const toggleBtn = document.getElementById('settingsToggle');
  const body = document.getElementById('settingsBody');

  // 展开/折叠
  toggleBtn.addEventListener('click', () => {
    body.classList.toggle('hidden');
    toggleBtn.querySelector('.arrow').textContent = body.classList.contains('hidden') ? '▲' : '▼';
  });

  // 控件绑定
  const modelSelect = document.getElementById('settingModel');
  modelSelect.value = settings.model;
  modelSelect.addEventListener('change', () => { settings.model = modelSelect.value; });

  const ttsCheck = document.getElementById('settingTTS');
  ttsCheck.checked = settings.ttsEnabled;
  ttsCheck.addEventListener('change', () => { settings.ttsEnabled = ttsCheck.checked; });

  const qualitySlider = document.getElementById('settingQuality');
  const qualityLabel = document.getElementById('settingQualityLabel');
  qualitySlider.value = settings.frameQuality;
  qualityLabel.textContent = Math.round(settings.frameQuality * 100) + '%';
  qualitySlider.addEventListener('input', () => {
    settings.frameQuality = parseFloat(qualitySlider.value);
    qualityLabel.textContent = Math.round(settings.frameQuality * 100) + '%';
  });
}
