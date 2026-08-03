/* 行内翻译 · 设置页逻辑 */
'use strict';

const $ = s => document.querySelector(s);
const fieldInput = key => document.getElementById('f_' + key);

let current = null; // 当前编辑中的设置（合并默认值后）

(async () => {
  const stored = await chrome.storage.local.get('settings');
  current = mergeSettings(stored.settings);

  renderProviders();
  renderFields();
  fillLang();
  $('#maxChars').value = current.maxChars;

  $('#saveBtn').addEventListener('click', saveSettings);
  $('#testBtn').addEventListener('click', testConnection);
  $('#resetBtn').addEventListener('click', () => {
    current = mergeSettings({});
    renderProviders();
    renderFields();
    $('#targetLang').value = current.targetLang;
    $('#maxChars').value = current.maxChars;
    setMsg('已恢复默认值（点击「保存设置」生效）', 'ok');
  });
})();

/* ---------- 渲染 ---------- */

function renderProviders() {
  const list = $('#providerList');
  list.innerHTML = '';
  for (const p of PROVIDERS) {
    const label = document.createElement('label');
    label.className = 'card' + (p.id === current.provider ? ' selected' : '');
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'provider';
    radio.value = p.id;
    radio.checked = p.id === current.provider;
    const info = document.createElement('div');
    info.className = 'info';
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = p.name;
    const desc = document.createElement('div');
    desc.className = 'desc';
    desc.textContent = p.desc;
    info.append(name, desc);
    label.append(radio, info);
    list.appendChild(label);
  }
  list.addEventListener('change', e => {
    if (e.target.name === 'provider') {
      current.provider = e.target.value;
      document.querySelectorAll('#providerList .card').forEach(c => c.classList.remove('selected'));
      e.target.closest('.card').classList.add('selected');
      renderFields();
    }
  });
}

function renderFields() {
  const meta = PROVIDERS.find(p => p.id === current.provider);
  const cfg = current.providers[current.provider] || {};
  const wrap = $('#fields');
  wrap.innerHTML = '';

  /* OpenAI 兼容接口：常用服务预设 */
  if (meta.id === 'openai') {
    wrap.appendChild(makeSelectRow('openaiPreset', '常用服务预设', '—— 手动填写 ——',
      OPENAI_PRESETS.map(pr => ({ value: pr.name, text: pr.name + '（' + pr.model + '）' })),
      sel => {
        const pr = OPENAI_PRESETS.find(x => x.name === sel.value);
        if (!pr) return;
        fieldInput('baseUrl').value = pr.baseUrl;
        fieldInput('model').value = pr.model;
      }));
  }

  /* Claude：模型预设 */
  if (meta.id === 'anthropic') {
    wrap.appendChild(makeSelectRow('anthropicModelPreset', '常用模型', '—— 手动填写 ——',
      ANTHROPIC_MODELS.map(m => ({ value: m, text: m })),
      sel => {
        if (sel.value) fieldInput('model').value = sel.value;
      }));
  }

  for (const f of meta.fields) {
    const row = document.createElement('div');
    row.className = 'form-item';
    const label = document.createElement('label');
    label.htmlFor = 'f_' + f.key;
    label.textContent = f.label;
    const input = document.createElement('input');
    input.id = 'f_' + f.key;
    input.type = f.type || 'text';
    input.value = cfg[f.key] || '';
    if (f.placeholder) input.placeholder = f.placeholder;
    row.append(label, input);
    wrap.appendChild(row);
  }

  /* 申请链接 */
  const apply = $('#applyLink');
  if (meta.applyUrl) {
    apply.innerHTML = '申请地址：<a href="' + meta.applyUrl + '" target="_blank" rel="noreferrer">' + meta.applyText + '</a>';
  } else {
    apply.textContent = meta.applyText + '，开箱即用。';
  }
}

function makeSelectRow(id, labelText, placeholderText, options, onChange) {
  const row = document.createElement('div');
  row.className = 'form-item';
  const label = document.createElement('label');
  label.htmlFor = id;
  label.textContent = labelText;
  const sel = document.createElement('select');
  sel.id = id;
  const opt0 = document.createElement('option');
  opt0.value = '';
  opt0.textContent = placeholderText;
  sel.appendChild(opt0);
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.text;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => onChange(sel));
  row.append(label, sel);
  return row;
}

function fillLang() {
  const sel = $('#targetLang');
  sel.innerHTML = '';
  for (const key of Object.keys(LANGS)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = LANGS[key].label;
    sel.appendChild(opt);
  }
  sel.value = current.targetLang;
}

/* ---------- 操作 ---------- */

function collectForm() {
  const meta = PROVIDERS.find(p => p.id === current.provider);
  const cfg = current.providers[current.provider];
  for (const f of meta.fields) {
    cfg[f.key] = fieldInput(f.key).value.trim();
  }
  current.targetLang = $('#targetLang').value;
  current.maxChars = Math.min(4000, Math.max(200, Number($('#maxChars').value) || 1200));
  return current;
}

async function saveSettings() {
  const s = collectForm();
  await chrome.storage.local.set({ settings: s });
  const miss = providerReady(s);
  if (miss) setMsg('✓ 已保存。提示：' + miss, 'ok');
  else setMsg('✓ 已保存。', 'ok');
}

async function testConnection() {
  const s = collectForm();
  setMsg('正在测试连接…');
  let resp = null;
  try {
    resp = await chrome.runtime.sendMessage({ type: 'testConnection', settings: s });
  } catch (e) {
    setMsg('测试失败：' + ((e && e.message) || e), 'err');
    return;
  }
  if (resp && resp.ok) setMsg('✓ 连接成功，示例译文：' + resp.text, 'ok');
  else setMsg('✗ 连接失败：' + ((resp && resp.error) || '未知错误'), 'err');
}

function setMsg(text, kind) {
  const msg = $('#msg');
  msg.textContent = text;
  msg.className = 'msg' + (kind ? ' ' + kind : '');
}
