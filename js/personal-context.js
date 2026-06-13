// js/personal-context.js
// 用户自定义 System Prompt 附加文本 — 纯字符串，用户完全控制
// 通过 storage-backend.js 抽象层读写存储

import { getStorage } from './storage-backend.js';

const STORAGE_KEY = 'omni_system_prompt';

export const personalContext = {
  _text: '',

  // ── 初始化 ──
  async init() {
    try {
      const storage = getStorage();
      const saved = await storage.get(STORAGE_KEY);
      this._text = typeof saved === 'string' ? saved : '';
    } catch (e) {
      console.error('[pc] init failed:', e.message);
      this._text = '';
    }
    return this._text;
  },

  // ── 读取 ──
  get() { return this._text; },

  // ── 保存 ──
  async save(text) {
    this._text = String(text || '');
    try {
      const storage = getStorage();
      await storage.set(STORAGE_KEY, this._text);
    } catch (e) {
      console.error('[pc] save failed:', e.message);
    }
  },
};
