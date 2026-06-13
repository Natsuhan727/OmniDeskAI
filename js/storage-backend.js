// js/storage-backend.js
// 存储抽象层 — Provider Registry 模式，默认 localStorage，预留 IndexedDB/Mem0 接口

/**
 * StorageBackend 接口契约（抽象类，仅定义签名）
 *
 * 所有存储后端必须实现以下方法。
 * 参考本项目 ASR/LLM/TTS Provider 注册表模式。
 *
 * @interface
 */
class StorageBackend {
  /** 初始化存储（建立连接、创建表/索引等） */
  async init() { throw new Error('Not implemented'); }
  /** 读取 JSON 数据 */
  async get(key) { throw new Error('Not implemented'); }
  /** 写入 JSON 数据 */
  async set(key, value) { throw new Error('Not implemented'); }
  /** 删除数据 */
  async delete(key) { throw new Error('Not implemented'); }
  /** 列出所有 key */
  async keys() { throw new Error('Not implemented'); }
  /** 获取存储统计 */
  async stats() { throw new Error('Not implemented'); }
  /** 后端标识 */
  get name() { throw new Error('Not implemented'); }
  get version() { throw new Error('Not implemented'); }
}

// ── 默认实现：localStorageBackend ──
export const localStorageBackend = {
  name: 'localStorage',
  version: '1.0.0',

  async init() {
    try {
      const testKey = '__omni_storage_test__';
      localStorage.setItem(testKey, '1');
      localStorage.removeItem(testKey);
      return true;
    } catch (e) {
      throw new Error('localStorage 不可用（可能处于私密模式或配额满）');
    }
  },

  async get(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.error(`[storage] get(${key}) 失败:`, e.message);
      return null;
    }
  },

  async set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.error(`[storage] set(${key}) 失败:`, e.message);
      throw e;
    }
  },

  async delete(key) {
    localStorage.removeItem(key);
  },

  async keys() {
    const result = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('omni_')) result.push(key);
    }
    return result;
  },

  async stats() {
    let totalBytes = 0;
    for (const key of await this.keys()) {
      totalBytes += (localStorage.getItem(key) || '').length * 2; // UTF-16
    }
    return { totalBytes, keyCount: (await this.keys()).length };
  },
};

// ── Provider 注册表 ──
const storageBackends = {
  localStorage: localStorageBackend,
  // 未来扩展：
  // indexedDB: indexedDBBackend,
  // mem0: mem0Backend,
  // vercelKV: vercelKVBackend,
};

// ── 当前使用的后端 ──
let currentBackend = localStorageBackend;

// ── 调度函数 ──
export async function initStorage(backendName = 'localStorage', config = {}) {
  const backend = storageBackends[backendName];
  if (!backend) throw new Error(`未知存储后端: ${backendName}`);
  await backend.init(config);
  currentBackend = backend;
  return backend;
}

export function getStorage() {
  return currentBackend;
}

export function registerStorageBackend(name, backend) {
  storageBackends[name] = backend;
}
