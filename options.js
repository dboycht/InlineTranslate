/* 行内翻译 · 设置页逻辑 */
'use strict';

const $ = s => document.querySelector(s);
const fieldInput = key => document.getElementById('f_' + key);

let current = null;               // 当前编辑中的设置（已合并默认值）
const testState = {};             // 各服务的连通性预检结果
let dirty = false;                // 是否有未保存改动

(async () => {
  const stored = await chrome.storage.local.get('settings');
  current = mergeSettings(stored.settings);

  showVersion();
  bindProviderEvents();              // 只绑定一次
  renderProviders();
  renderFields();
  fillLang();
  $('#maxChars').value = current.maxChars;
  $('#maxChars').addEventListener('input', markDirty);
  clearDirty();

  $('#saveBtn').addEventListener('click', saveSettings);
  $('#testBtn').addEventListener('click', testConnection);
  $('#resetBtn').addEventListener('click', resetAll);
  window.addEventListener('beforeunload', e => {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = '';
  });
})();

/* ---------------- 版本号（单一来源：manifest.json） ---------------- */

function showVersion() {
  const el = $('#ver');
  if (!el) return;
  try {
    el.textContent = 'v' + chrome.runtime.getManifest().version;
  } catch (e) { /* 非扩展环境忽略 */ }
}

/* ---------------- 脏标记 ---------------- */

function markDirty() {
  dirty = true;
  const btn = $('#saveBtn');
  if (btn) btn.textContent = '保存设置 •';
  const hint = $('#dirtyHint');
  if (hint) hint.hidden = false;
}

function clearDirty() {
  dirty = false;
  const btn = $('#saveBtn');
  if (btn) btn.textContent = '保存设置';
  const hint = $('#dirtyHint');
  if (hint) hint.hidden = true;
}

/* ---------------- 渲染：服务选择卡片 ---------------- */

function renderProviders() {
  const list = $('#providerList');
  list.textContent = '';

  const groups = [
    { title: '翻译接口', items: PROVIDERS.filter(p => p.group === 'api') },
    { title: 'AI 大模型', items: PROVIDERS.filter(p => p.group === 'ai') },
  ];

  for (const g of groups) {
    const head = document.createElement('div');
    head.className = 'group-title';
    head.textContent = g.title;
    list.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'grid';
    for (const p of g.items) {
      const label = document.createElement('label');
      label.className = 'card' + (p.id === current.provider ? ' selected' : '');
      label.dataset.pid = p.id;

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
      // 用「各服务自己的配置槽位」判断，才能准确显示已配置/待配置
      if (p.fields.length) {
        const ready = serviceReady(p.id);
        const tag = document.createElement('span');
        tag.className = 'tag ' + (ready ? 'ok' : 'warn');
        tag.textContent = ready ? '已配置' : '待配置';
        name.appendChild(tag);
      }

      info.append(name, desc);
      label.append(radio, info);
      grid.appendChild(label);
    }
    list.appendChild(grid);
  }
}

/* 只在初始化时绑定一次（避免重复渲染叠加监听） */
function bindProviderEvents() {
  $('#providerList').addEventListener('change', e => {
    if (!e.target || e.target.name !== 'provider') return;
    collectForm();                       // 切换前先收下已填内容，避免丢草稿
    current.provider = e.target.value;
    renderProviders();
    renderFields();
    updateReadyHint();
    markDirty();
  });
}

/* 判断某个服务（各自独立的配置槽位）是否已配置完整 */
function serviceReady(pid) {
  const providers = JSON.parse(JSON.stringify(current.providers));
  if (pid === 'openai' && pid === current.provider) {
    // 当前正在编辑 openai 时，以界面上的输入为准
    const cfg = providers.openai;
    const el = id => document.getElementById('f_' + id);
    if (el('baseUrl')) {
      cfg.baseUrl = normalizeBaseUrl(el('baseUrl').value);
      cfg.apiKey = el('apiKey').value.trim();
      cfg.model = el('model').value.trim();
      if (cfg.addresses && cfg.addresses[cfg.endpoint]) {
        cfg.addresses[cfg.endpoint] = { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model };
      }
    }
  }
  return !providerReady({ provider: pid, providers });
}

/* ---------------- 渲染：服务配置表单 ---------------- */

function renderFields() {
  const meta = PROVIDERS.find(p => p.id === current.provider);
  const cfg = current.providers[current.provider] || {};
  const wrap = $('#fields');
  wrap.textContent = '';

  // ① OpenAI 兼容：服务商选择（改了它 = 换一套 baseUrl/密钥/模型）
  if (meta.id === 'openai') wrap.appendChild(makeEndpointRow(cfg));

  // ② 各字段（OpenAI 兼容的文档链接随所选服务商变化）
  const epMeta = meta.id === 'openai' ? AI_ENDPOINTS.find(e => e.id === cfg.endpoint) : null;
  for (const f of meta.fields) {
    if (f.type === 'endpoint') continue;                 // 已单独渲染
    const docsUrl = f.docsUrl || (epMeta ? epMeta.docsUrl : '');
    if (f.type === 'model') wrap.appendChild(makeModelRow(meta, f, cfg, docsUrl));
    else wrap.appendChild(makeInputRow(f, cfg[f.key]));
  }

  // ③ 申请指引 / 文档链接
  renderApplyLink(meta);

  // ④ 缺失字段高亮
  updateReadyHint();
}

function makeInputRow(f, value) {
  const row = document.createElement('div');
  row.className = 'form-item';
  const label = document.createElement('label');
  label.htmlFor = 'f_' + f.key;
  label.textContent = f.label;
  if (!f.required) {
    const hint = document.createElement('span');
    hint.className = 'hint';
    hint.textContent = '（可选）';
    label.appendChild(hint);
  }
  const input = document.createElement('input');
  input.id = 'f_' + f.key;
  input.type = f.type || 'text';
  input.value = value || '';
  if (f.placeholder) input.placeholder = f.placeholder;
  input.addEventListener('input', () => {
    markDirty();
    updateReadyHint();
    if (f.type === 'text' && f.key === 'baseUrl') autoDetectEndpoint();
  });
  row.append(label, input);
  return row;
}

/* 服务商下拉：选中即切换 baseUrl / 密钥 / 模型为一套独立配置 */
function makeEndpointRow(cfg) {
  const row = document.createElement('div');
  row.className = 'form-item';
  const label = document.createElement('label');
  label.htmlFor = 'f_endpoint';
  label.textContent = '服务商';
  const hint = document.createElement('span');
  hint.className = 'hint';
  hint.textContent = '（选好后自动填好地址与推荐模型）';
  label.appendChild(hint);

  const sel = document.createElement('select');
  sel.id = 'f_endpoint';
  for (const ep of AI_ENDPOINTS) {
    const opt = document.createElement('option');
    opt.value = ep.id;
    opt.textContent = ep.name + (ep.hint ? '（' + ep.hint + '）' : '');
    sel.appendChild(opt);
  }
  sel.value = cfg.endpoint || 'custom';

  const note = document.createElement('div');
  note.className = 'endpoint-note';
  note.id = 'endpointNote';

  sel.addEventListener('change', () => {
    switchEndpoint(sel.value);
  });

  row.append(label, sel, note);
  return row;
}

/* 模型名称：下拉建议 + 可自由填写（模型 ID 变动频繁，不能写死） */
function makeModelRow(meta, f, cfg, docsUrl) {
  const row = document.createElement('div');
  row.className = 'form-item';
  const label = document.createElement('label');
  label.htmlFor = 'f_' + f.key;
  label.textContent = f.label;

  const presets = f.modelPresets || [];
  if (presets.length) {
    const hint = document.createElement('span');
    hint.className = 'hint';
    hint.textContent = '（下拉为推荐值，也可手动填写）';
    label.appendChild(hint);
  }

  const input = document.createElement('input');
  input.id = 'f_' + f.key;
  input.type = 'text';
  input.value = cfg[f.key] || '';
  input.placeholder = f.placeholder || '模型 ID';
  input.setAttribute('autocomplete', 'off');

  if (presets.length) {
    const listId = 'modelList_' + meta.id;
    const dl = document.createElement('datalist');
    dl.id = listId;
    for (const pr of presets) {
      const opt = document.createElement('option');
      opt.value = pr.id;
      if (pr.note) opt.label = pr.note;
      dl.appendChild(opt);
    }
    input.setAttribute('list', listId);
    row.appendChild(dl);
  }

  input.addEventListener('input', () => { markDirty(); updateReadyHint(); });

  const foot = document.createElement('div');
  foot.className = 'field-foot';
  if (presets.length) {
    const chips = document.createElement('div');
    chips.className = 'chips';
    for (const pr of presets) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = pr.id;
      if (pr.note) chip.title = pr.note;
      chip.addEventListener('click', () => {
        input.value = pr.id;
        markDirty();
        updateReadyHint();
      });
      chips.appendChild(chip);
    }
    foot.appendChild(chips);
  }
  const docs = docsUrl || '';
  if (docs) {
    const a = document.createElement('a');
    a.href = docs;
    a.target = '_blank';
    a.rel = 'noreferrer';
    a.className = 'docs-link';
    a.textContent = '查看可用模型列表 ↗';
    foot.appendChild(a);
  }

  row.append(label, input, foot);
  return row;
}

/* ---------------- 服务商切换 / 自动识别 ---------------- */

/* 切换服务商：把当前表单收进旧端点槽位，再载入新端点槽位 */
function switchEndpoint(nextId) {
  const cfg = current.providers.openai;
  collectForm(true);                 // 先把当前端点的填写收进 addresses
  cfg.endpoint = nextId;
  const target = cfg.addresses[nextId] || {};
  setFieldValue('baseUrl', target.baseUrl || '');
  setFieldValue('apiKey', target.apiKey || '');
  setFieldValue('model', target.model || '');
  cfg.baseUrl = target.baseUrl || '';
  cfg.apiKey = target.apiKey || '';
  cfg.model = target.model || '';
  renderFields();
  markDirty();
}

/* 用户手动粘贴地址时，自动识别服务商（不回填、不覆盖用户输入） */
function autoDetectEndpoint() {
  const input = fieldInput('baseUrl');
  const note = $('#endpointNote');
  if (!input || !note) return;
  const guess = guessEndpointId(input.value);
  const ep = AI_ENDPOINTS.find(e => e.id === guess);
  if (ep && ep.id !== 'custom') {
    note.textContent = '已识别为：' + ep.name;
    note.className = 'endpoint-note ok';
  } else if (String(input.value || '').trim()) {
    note.textContent = '将作为自定义 OpenAI 兼容地址使用';
    note.className = 'endpoint-note';
  } else {
    note.textContent = '';
    note.className = 'endpoint-note';
  }
}

function setFieldValue(key, value) {
  const el = fieldInput(key);
  if (el) el.value = value == null ? '' : value;
}

/* 从当前 OpenAI 表单收集扁平值（不写回 addresses，只读） */
function collectOpenAIFields(cfg) {
  return {
    baseUrl: normalizeBaseUrl(fieldInput('baseUrl') ? fieldInput('baseUrl').value : ''),
    apiKey: fieldInput('apiKey') ? fieldInput('apiKey').value.trim() : '',
    model: fieldInput('model') ? fieldInput('model').value.trim() : (cfg.model || ''),
  };
}

/* ---------------- 申请链接 ---------------- */

function renderApplyLink(meta) {
  const apply = $('#applyLink');
  apply.textContent = '';
  const cfg = current.providers[meta.id] || {};
  const ep = meta.id === 'openai' ? AI_ENDPOINTS.find(e => e.id === cfg.endpoint) : null;
  const applyUrl = (ep && ep.applyUrl) || meta.applyUrl;
  const applyText = (ep && ep.applyUrl) ? '申请 ' + ep.name + ' API Key' : meta.applyText;

  if (applyUrl) {
    apply.append('申请地址：');
    const a = document.createElement('a');
    a.href = applyUrl;
    a.target = '_blank';
    a.rel = 'noreferrer';
    a.textContent = applyText;
    apply.appendChild(a);
  } else {
    apply.textContent = applyText + (applyText && !/。$/.test(applyText) ? '，开箱即用。' : '');
  }
}

/* ---------------- 就绪提示 / 缺失字段高亮 ---------------- */

function updateReadyHint() {
  const hint = $('#readyHint');
  if (!hint) return { ok: true };
  const s = collectForm(true);                 // 静默收集，不触发重渲染
  const miss = providerReady(s);
  // 清除旧高亮
  document.querySelectorAll('#fields .form-item.missing').forEach(el => el.classList.remove('missing'));
  if (!miss) {
    hint.textContent = '✓ 当前服务已配置完整，可以开始翻译';
    hint.className = 'ready-hint ok';
    return { ok: true };
  }
  hint.textContent = '还需填写：' + miss.fields
    .map(k => {
      const f = (PROVIDERS.find(p => p.id === s.provider) || {}).fields || [];
      const hit = f.find(x => x.key === k);
      const el = document.getElementById('f_' + k);
      if (el && el.closest('.form-item')) el.closest('.form-item').classList.add('missing');
      return hit ? hit.label : k;
    })
    .join('、');
  hint.className = 'ready-hint warn';
  return { ok: false, miss };
}

/* ---------------- 表单收集 ---------------- */

/* 把界面上的值收进 current（silent=true 时不改动 dirty 标记） */
function collectForm(silent) {
  if (!silent) dirty = true;
  const meta = PROVIDERS.find(p => p.id === current.provider);
  const cfg = current.providers[current.provider];

  if (meta.id === 'openai') {
    const endpointSel = $('#f_endpoint');
    if (endpointSel) cfg.endpoint = endpointSel.value;
    const flat = collectOpenAIFields(cfg);
    cfg.baseUrl = flat.baseUrl || cfg.baseUrl;
    cfg.apiKey = flat.apiKey;
    cfg.model = flat.model;
    // 写回该端点的独立槽位
    if (cfg.addresses && cfg.addresses[cfg.endpoint]) {
      cfg.addresses[cfg.endpoint] = { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model };
    }
  } else {
    for (const f of meta.fields) {
      const el = fieldInput(f.key);
      if (el) cfg[f.key] = el.value.trim();
    }
  }

  const langSel = $('#targetLang');
  if (langSel && LANGS[langSel.value]) current.targetLang = langSel.value;
  const mc = $('#maxChars');
  if (mc) current.maxChars = Math.min(4000, Math.max(200, Number(mc.value) || 1200));
  return current;
}

/* ---------------- 操作 ---------------- */

async function saveSettings() {
  const s = collectForm();
  await chrome.storage.local.set({ settings: s });
  clearDirty();
  renderProviders();                 // 刷新「已配置 / 待配置」标签
  const miss = providerReady(s);
  if (miss) setMsg('✓ 已保存。' + miss.message + '，补全后即可使用。', 'warn');
  else setMsg('✓ 已保存，' + providerLabel(s.provider) + ' 配置完整。', 'ok');
}

async function testConnection() {
  const s = collectForm(true);       // 用当前表单值直接测，不必先保存
  const btn = $('#testBtn');
  btn.disabled = true;
  setMsg('正在测试连接…');
  let resp = null;
  try {
    resp = await chrome.runtime.sendMessage({ type: 'testConnection', settings: s });
  } catch (e) {
    btn.disabled = false;
    testState[s.provider] = 'fail';
    setMsg('✗ 测试失败：' + ((e && e.message) || e), 'err');
    return;
  }
  btn.disabled = false;
  const label = providerLabel(s.provider);
  if (resp && resp.ok) {
    testState[s.provider] = 'ok';
    setMsg('✓ ' + label + ' 连接成功，示例译文：' + resp.text, 'ok');
  } else {
    testState[s.provider] = 'fail';
    const err = (resp && resp.error) || '未知错误';
    const tip = /401|403|key|密钥|unauthor|invalid.*token/i.test(err)
      ? '（密钥可能不正确或未生效）'
      : /404|model|模型/i.test(err)
        ? '（模型名称可能不对，请核对服务商文档里的模型 ID）'
        : /Failed to fetch|NetworkError|load failed/i.test(err)
          ? '（网络不通：本地 Ollama 请确认已启动；云端服务请检查地址与代理）'
          : '';
    setMsg('✗ ' + label + ' 连接失败：' + err + tip, 'err');
  }
}

async function resetAll() {
  current = mergeSettings({});
  renderProviders();
  renderFields();
  fillLang();
  $('#maxChars').value = current.maxChars;
  markDirty();
  setMsg('已恢复默认值（点击「保存设置」生效）', 'warn');
}

function providerLabel(pid) {
  const p = PROVIDERS.find(x => x.id === pid);
  if (!p) return pid;
  if (pid === 'openai') {
    const ep = AI_ENDPOINTS.find(e => e.id === (current.providers.openai.endpoint || ''));
    if (ep && ep.id !== 'custom') return 'AI · ' + ep.name;
  }
  return p.name;
}

function fillLang() {
  const sel = $('#targetLang');
  sel.textContent = '';
  for (const key of Object.keys(LANGS)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = LANGS[key].label;
    sel.appendChild(opt);
  }
  sel.value = current.targetLang;
  sel.addEventListener('change', markDirty);
}

function setMsg(text, kind) {
  const msg = $('#msg');
  msg.textContent = text;
  msg.className = 'msg' + (kind ? ' ' + kind : '');
}
