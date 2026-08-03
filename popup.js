/* 行内翻译 · 弹窗逻辑 */
'use strict';

const $ = s => document.querySelector(s);

let tabId = null;
let settings = null;
let hidden = false;

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab && tab.id;
  if (tabId == null) return;

  const stored = await chrome.storage.local.get('settings');
  settings = mergeSettings(stored.settings);

  /* 目标语言下拉 */
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
    $('#status').textContent = '目标语言已设为 ' + LANGS[settings.targetLang].label;
  });

  /* 服务状态 */
  const meta = PROVIDERS.find(p => p.id === settings.provider);
  const status = $('#status');
  const miss = providerReady(settings);
  if (miss) {
    status.innerHTML = miss + '，<a href="#" id="goOptions">前往设置</a>';
    $('#goOptions').addEventListener('click', e => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });
    $('#translateBtn').disabled = true;
  } else {
    status.textContent = meta.name + ' · 目标 ' + LANGS[settings.targetLang].label;
  }

  /* 确保内容脚本就绪（页面在扩展安装前打开时自动注入） */
  const ok = await ensureContent();
  if (!ok) {
    status.textContent = '此页面无法翻译（浏览器内部或受限页面）';
    $('#translateBtn').disabled = true;
    return;
  }
  const h = await sendToTab('getHidden');
  hidden = !!(h && h.hidden);
  updateToggleBtn();

  $('#translateBtn').addEventListener('click', async () => {
    await sendToTab('translatePage');
    window.close();
  });
  $('#toggleBtn').addEventListener('click', async () => {
    const resp = await sendToTab('toggleTranslations');
    hidden = !!(resp && resp.hidden);
    updateToggleBtn();
  });
  $('#removeBtn').addEventListener('click', async () => {
    await sendToTab('removeTranslations');
    window.close();
  });
  $('#optionsBtn').addEventListener('click', () => chrome.runtime.openOptionsPage());
})();

function updateToggleBtn() {
  $('#toggleBtn').textContent = hidden ? '显示译文' : '隐藏译文';
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
