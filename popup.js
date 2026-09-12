/* 行内翻译 · 弹窗逻辑 */
'use strict';

const $ = s => document.querySelector(s);

let tabId = null;
let settings = null;
let hidden = false;
let busy = false;

(async () => {
  showVersion();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab && tab.id;
  if (tabId == null) return;

  const stored = await chrome.storage.local.get('settings');
  settings = mergeSettings(stored.settings);

  fillLang();
  renderStatus();

  /* 确保内容脚本就绪（页面在扩展安装前打开时自动注入） */
  const ok = await ensureContent();
  if (!ok) {
    const status = $('#status');
    status.textContent = '此页面无法翻译（浏览器内部页或受限页面，如 edge:// 、扩展商店等）';
    status.className = 'status warn';
    $('#translateBtn').disabled = true;
    return;
  }
  const h = await sendToTab('getHidden');
  hidden = !!(h && h.hidden);
  updateToggleBtn();

  $('#translateBtn').addEventListener('click', onTranslate);
  $('#toggleBtn').addEventListener('click', onToggle);
  $('#removeBtn').addEventListener('click', onRemove);
  $('#optionsBtn').addEventListener('click', () => chrome.runtime.openOptionsPage());
  const goOptions = $('#goOptions');
  if (goOptions) goOptions.addEventListener('click', e => { e.preventDefault(); chrome.runtime.openOptionsPage(); });
})();

function showVersion() {
  const el = $('#ver');
  if (!el) return;
  try { el.textContent = 'v' + chrome.runtime.getManifest().version; } catch (e) { /* 忽略 */ }
}

/* 当前服务的显示名（OpenAI 兼容时带上具体服务商，避免只显示「AI 大模型」） */
function providerLabel() {
  const meta = PROVIDERS.find(p => p.id === settings.provider);
  if (!meta) return '未知服务';
  if (settings.provider === 'openai') {
    const cfg = settings.providers.openai || {};
    const ep = AI_ENDPOINTS.find(e => e.id === cfg.endpoint);
    return 'AI · ' + ((ep && ep.name) || 'OpenAI 兼容');
  }
  return meta.name;
}

function renderStatus() {
  const status = $('#status');
  const miss = providerReady(settings);
  if (miss) {
    status.textContent = '';
    status.append(miss.message + '，');
    const a = document.createElement('a');
    a.href = '#';
    a.id = 'goOptions';
    a.textContent = '前往设置';
    status.appendChild(a);
    status.className = 'status warn';
    $('#translateBtn').disabled = true;
  } else {
    const model = settings.provider === 'openai'
      ? (settings.providers.openai.model || '')
      : settings.provider === 'anthropic'
        ? (settings.providers.anthropic.model || '')
        : '';
    status.textContent = providerLabel()
      + (model ? ' · ' + model : '')
      + ' · 目标 ' + LANGS[settings.targetLang].label;
    status.className = 'status';
  }
}

function fillLang() {
  const langSel = $('#lang');
  for (const key of Object.keys(LANGS)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = LANGS[key].label;
    langSel.appendChild(opt);
  }
  langSel.value = settings.targetLang;
  langSel.addEventListener('change', async () => {
    settings.targetLang = langSel.value;
    await chrome.storage.local.set({ settings });
    renderStatus();
  });
}

/* 翻译：进度由页面内浮窗展示，这里只做即时反馈，不立刻关窗 */
async function onTranslate() {
  if (busy) return;
  busy = true;
  const btn = $('#translateBtn');
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = '翻译中…（进度见页面右上角）';
  const resp = await sendToTab('translatePage');
  busy = false;
  btn.textContent = old;
  btn.disabled = false;
  if (!resp || resp.ok === false) {
    toastStatus('翻译未能启动：' + ((resp && resp.error) || '未知原因'), 'err');
  } else {
    toastStatus('已开始翻译，进度显示在页面右上角', 'ok');
  }
}

async function onToggle() {
  const resp = await sendToTab('toggleTranslations');
  hidden = !!(resp && resp.hidden);
  updateToggleBtn();
}

async function onRemove() {
  await sendToTab('removeTranslations');
  toastStatus('已移除本页译文', 'ok');
}

function updateToggleBtn() {
  $('#toggleBtn').textContent = hidden ? '显示译文' : '隐藏译文';
}

function toastStatus(text, kind) {
  const status = $('#status');
  status.textContent = text;
  status.className = 'status' + (kind ? ' ' + kind : '');
}

async function ensureContent() {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'ping' });
    return true;
  } catch (e) { /* 未注入，继续兜底注入 */ }
  try {
    await chrome.scripting.insertCSS({ target: { tabId }, files: ['content.css'] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['providers.js', 'content.js'] });
    return true;
  } catch (e) {
    return false;
  }
}

async function sendToTab(type, data) {
  try {
    return await chrome.tabs.sendMessage(tabId, Object.assign({ type }, data));
  } catch (e) {
    return null;
  }
}
