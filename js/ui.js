// js/ui.js
// DOM 渲染 — 消息列表、气泡、Lightbox

// ── DOM 引用 ──
const messageList = document.getElementById('messageList');
const emptyHint = document.getElementById('emptyHint');
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightboxImg');

// ── 工具 ──
function escapeHtml(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }
function escapeAttr(str) { return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

// ── Lightbox ──
function openLightbox(src) {
  lightboxImg.src = src;
  lightbox.classList.remove('hidden');
  lightbox.classList.add('flex');
}

function closeLightbox() {
  lightbox.classList.add('hidden');
  lightbox.classList.remove('flex');
  lightboxImg.src = '';
}

lightbox.addEventListener('click', closeLightbox);

messageList.addEventListener('click', function(e) {
  const img = e.target.closest('.thumbnail');
  if (img) { e.stopPropagation(); openLightbox(img.src); }
});

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape' && !lightbox.classList.contains('hidden')) {
    closeLightbox();
  }
});

// ── 消息列表 ──
export function renderMessages(conversationHistory) {
  messageList.querySelectorAll('.msg-bubble').forEach(el => el.remove());
  if (conversationHistory.length === 0) {
    emptyHint.classList.remove('hidden');
  } else {
    emptyHint.classList.add('hidden');
    for (const msg of conversationHistory) {
      appendBubble(msg.role, msg.text, msg.frame);
    }
  }
  messageList.scrollTop = messageList.scrollHeight;
}

export function appendBubble(role, text, frame) {
  emptyHint.classList.add('hidden');
  const wrapper = document.createElement('div');
  wrapper.className = 'msg-bubble flex ' + (role === 'user' ? 'justify-end' : 'justify-start');

  if (role === 'user') {
    wrapper.innerHTML =
      `<div class="max-w-[80%] bg-blue-600 rounded-xl px-3 py-2">` +
        (frame ? `<img src="${escapeAttr(frame)}" class="thumbnail w-16 h-12 object-cover rounded-lg mb-1.5 cursor-pointer hover:opacity-80 transition-opacity" title="点击查看原图" />` : '') +
        `<p class="text-white text-sm whitespace-pre-wrap">${escapeHtml(text)}</p>` +
      `</div>`;
  } else if (role === 'assistant') {
    wrapper.innerHTML =
      `<div class="max-w-[80%] bg-gray-700 rounded-xl px-3 py-2">` +
        `<p class="text-gray-100 text-sm whitespace-pre-wrap">${escapeHtml(text)}</p>` +
      `</div>`;
  }
  messageList.appendChild(wrapper);
  messageList.scrollTop = messageList.scrollHeight;
  return wrapper;
}

export function updateBubbleText(wrapper, newText) {
  const p = wrapper.querySelector('p');
  if (p) p.textContent = newText;
  messageList.scrollTop = messageList.scrollHeight;
}

export function showErrorBubble(msg) {
  const wrapper = document.createElement('div');
  wrapper.className = 'msg-bubble flex justify-center';
  wrapper.innerHTML = `<div class="max-w-[85%] bg-red-900/50 border border-red-700/50 rounded-xl px-3 py-2"><p class="text-red-300 text-xs">${escapeHtml(msg)}</p></div>`;
  messageList.appendChild(wrapper);
  messageList.scrollTop = messageList.scrollHeight;
  setTimeout(() => { if (wrapper.parentNode) wrapper.remove(); }, 3500);
}
