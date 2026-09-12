/* 行内翻译 · background service worker
   职责：集中调用各翻译 API（批量 / 去重 / 缓存 / 重试）、连接测试、快捷键处理。 */
'use strict';

importScripts('crypto-utils.js', 'providers.js');

const STORAGE_KEY = 'settings';
const CACHE_KEY = 'vtCache';
const CACHE_LIMIT = 5000;      // 缓存条目上限，超出后整体清空重建
const REQUEST_TIMEOUT = 45000; // 单次 API 请求超时（毫秒），避免无响应时一直转圈
const MAX_RETRY = 2;           // 限流 / 网络抖动时的最大重试次数

/* 取消标记：key = "tabId:requestId"；任务结束会清理，避免无限增长 */
const aborts = new Map();

/* ---------------- 设置与缓存 ---------------- */

async function getSettings() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return mergeSettings(stored[STORAGE_KEY]);
}

let cachePromise = null;
function loadCache() {
  if (!cachePromise) cachePromise = chrome.storage.local.get(CACHE_KEY).then(r => r[CACHE_KEY] || {});
  return cachePromise;
}
async function commitCache(cache) {
  if (Object.keys(cache).length > CACHE_LIMIT) {
    cache = {};
    cachePromise = Promise.resolve(cache);
  }
  await chrome.storage.local.set({ [CACHE_KEY]: cache });
  return cache;
}

/* 缓存键：用 '|' 作为分隔符。
   ⚠️ 历史坑：这里曾被写入两个 NUL 字节（U+0000），导致本文件被 git 判定为二进制文件、
   且缓存键经存储往返后不可靠。**切勿改回任何不可见控制字符**（详见 ERROR.md E1）。 */
function cacheKey(text, provider, targetLang) {
  return provider + '|' + targetLang + '|' + text;
}

/* 清空缓存 */
async function clearCache() {
  cachePromise = Promise.resolve({});
  await chrome.storage.local.set({ [CACHE_KEY]: {} });
}

/* ---------------- 网络请求：超时 + 失败重试 ---------------- */

/* 带超时的 fetch：外部接口挂起时及时失败，而不是让页面永远显示「翻译中」 */
async function fetchWithTimeout(url, options, timeout) {
  const ctrl = new AbortController();
  const ms = timeout || REQUEST_TIMEOUT;
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, Object.assign({}, options, { signal: ctrl.signal }));
  } catch (e) {
    if (e && e.name === 'AbortError') {
      throw new Error('请求超时（' + Math.round(ms / 1000) + ' 秒无响应），请检查网络或代理');
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/* 是否值得重试：限流 / 服务端错误 / 网络中断；鉴权与参数错误重试无意义 */
function isRetriable(err) {
  const status = err && err.status;
  if (status === 429) return true;
  if (typeof status === 'number' && status >= 500) return true;
  const msg = String((err && err.message) || err);
  return /failed to fetch|networkerror|load failed|timeout|超时/i.test(msg);
}

/* 统一重试包装：指数退避 600ms → 1200ms */
async function withRetry(fn, label) {
  let lastErr = null;
  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt === MAX_RETRY || !isRetriable(e)) break;
      await new Promise(r => setTimeout(r, 600 * Math.pow(2, attempt)));
    }
  }
  const msg = String((lastErr && lastErr.message) || lastErr);
  // 已经是「翻译已取消」这类语义明确的错误，不要重复加前缀
  if (/^翻译已取消$/.test(msg)) throw lastErr;
  throw new Error(label ? label + '：' + msg : msg);
}

/* ---------------- 分批策略 ---------------- */

function chunkTexts(texts, maxChars, maxItems) {
  const chunks = [];
  let cur = [], used = 0;
  for (const t of texts) {
    const len = t.text.length;
    if (cur.length && (used + len > maxChars || (maxItems && cur.length >= maxItems))) {
      chunks.push(cur);
      cur = [];
      used = 0;
    }
    cur.push(t);
    used += len;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

/* 百度按 UTF-8 字节数分批（接口限制 q ≤ 6000 字节），且每批只放一段 */
function chunkByBytes(texts, maxBytes) {
  const enc = new TextEncoder();
  const chunks = [];
  let cur = [], used = 0;
  for (const t of texts) {
    const n = enc.encode(t.text).length;
    if (cur.length && used + n > maxBytes) {
      chunks.push(cur);
      cur = [];
      used = 0;
    }
    cur.push(t);
    used += n;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

/* 分批规则
   ⚠️ google / baidu 的接口是「一次请求返回一段整体结果」，与逐段对齐无法保证：
   - Google 的响应只有一条句段数组（所有 q 的译文按顺序拼在一起，无法可靠切回原段落）；
   - 百度按换行拆分结果，段落文字自带换行就会错位。
   因此这两种服务强制 maxItems=1：一次只翻译一段，从根上消除错位。
   （v1.0.2 及更早版本在这里批量发送，导致第 2 段起译文错位或丢失。） */
function getChunks(provider, texts, settings) {
  switch (provider) {
    case 'google':    return chunkTexts(texts, 5000, 1);
    case 'deepl':     return chunkTexts(texts, 5000, 50);
    case 'baidu':     return chunkTexts(texts, 5500, 1);
    case 'youdao':    return chunkTexts(texts, 3900, 1); // 有道每个 q 一个请求，天然单段
    case 'openai':    return chunkTexts(texts, settings.maxChars, 60);
    case 'anthropic': return chunkTexts(texts, settings.maxChars, 60);
    default: throw new Error('未知的翻译服务: ' + provider);
  }
}

/* ---------------- 各服务实现 ---------------- */

/* Google 免费接口（一次请求一个 q，保证响应可确定地对齐） */
async function translateGoogle(texts, lang) {
  const out = [];
  for (const t of texts) {
    const body = new URLSearchParams();
    body.set('client', 'gtx');
    body.set('sl', 'auto');
    body.set('tl', lang.google);
    body.set('dt', 't');
    body.append('q', t.text);
    const resp = await fetchWithTimeout('https://translate.googleapis.com/translate_a/single', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: body.toString(),
    });
    if (!resp.ok) {
      const err = new Error('Google 翻译请求失败 (HTTP ' + resp.status + ')');
      err.status = resp.status;
      throw err;
    }
    const data = await resp.json().catch(() => null);
    out.push({ text: t.text, translation: parseGoogleResult(data) });
  }
  return out;
}

/* 解析 Google 免费接口响应：译文句段全部在 data[0] 里，逐段拼接
   形如 [[["译文","原文",…],["译文2","原文2",…]],null,"en",…]
   ⚠️ 不能按 data[i] 取第 i 段——响应里并没有「一段一个顶层元素」的结构。 */
function parseGoogleResult(data) {
  if (!Array.isArray(data) || !Array.isArray(data[0])) return '';
  return data[0]
    .map(seg => (Array.isArray(seg) && typeof seg[0] === 'string') ? seg[0] : '')
    .join('')
    .trim();
}

/* DeepL：Key 以 :fx 结尾走免费端点 */
async function translateDeepL(texts, lang, apiKey) {
  const free = String(apiKey).endsWith(':fx');
  const url = free
    ? 'https://api-free.deepl.com/v2/translate'
    : 'https://api.deepl.com/v2/translate';
  const body = new URLSearchParams();
  body.set('target_lang', lang.deepl);
  for (const t of texts) body.append('text', t.text);
  const resp = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { Authorization: 'DeepL-Auth-Key ' + apiKey },
    body: body.toString(),
  });
  const data = await resp.json().catch(() => null);
  if (!resp.ok) {
    const msg = (data && data.message) || '';
    const err = new Error('DeepL 请求失败 (HTTP ' + resp.status + '): ' + msg);
    err.status = resp.status;
    err.msg = msg;
    throw err;
  }
  const list = (data && data.translations) || [];
  return texts.map((t, i) => ({
    text: t.text,
    translation: ((list[i] && list[i].text) || '').trim(),
  }));
}

/* 百度翻译 v2：md5(appid + q + salt + 密钥) 签名；每段单独请求（见 getChunks 注释） */
async function translateBaidu(texts, lang, cfg) {
  const out = [];
  for (const t of texts) {
    const salt = String(Date.now()) + String(Math.floor(Math.random() * 100000));
    const sign = md5(cfg.appId + t.text + salt + cfg.secretKey);
    const params = new URLSearchParams({
      q: t.text, from: 'auto', to: lang.baidu, appid: cfg.appId, salt, sign,
    });
    const resp = await fetchWithTimeout('https://fanyi-api.baidu.com/api/trans/vip/translate?' + params.toString(), {
      method: 'GET',
    });
    const data = await resp.json().catch(() => null);
    if (!data || data.error_code) {
      const err = new Error('百度翻译错误 ' + (data ? data.error_code + ': ' + (data.error_msg || '') : '（无响应）'));
      err.status = resp.status;
      throw err;
    }
    const first = (data.trans_result || [])[0];
    out.push({ text: t.text, translation: ((first && first.dst) || '').trim() });
  }
  return out;
}

/* 有道智云 v3：sha256(appKey + input + salt + curtime + 密钥)，每个 q 一个请求 */
async function translateYoudao(texts, lang, cfg) {
  const out = [];
  for (const t of texts) {
    const salt = String(Date.now()) + String(out.length);
    const curtime = String(Math.floor(Date.now() / 1000));
    const q = t.text;
    const input = q.length > 20 ? q.slice(0, 20) + q.length : q;
    const sign = await sha256Hex(cfg.appKey + input + salt + curtime + cfg.appSecret);
    const body = new URLSearchParams({
      q, from: 'auto', to: lang.youdao,
      appKey: cfg.appKey, salt, sign, signType: 'v3', curtime,
    });
    const resp = await fetchWithTimeout('https://openapi.youdao.com/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const data = await resp.json().catch(() => null);
    if (!data || String(data.errorCode) !== '0') {
      const err = new Error('有道翻译错误 ' + (data ? data.errorCode + (data.message ? ': ' + data.message : '') : '（无响应）'));
      err.status = resp.status;
      throw err;
    }
    out.push({ text: t.text, translation: (((data.translation || [])[0]) || '').trim() });
  }
  return out;
}

/* ---------------- AI 通用部分 ---------------- */

/* 去掉思考模型泄漏到正文的推理段落（MiniMax 等会把思考包在 <think> 里） */
function stripThinking(content) {
  if (!content) return '';
  return String(content)
    .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
    .replace(/<think(?:ing)?>[\s\S]*$/i, '')
    .trim();
}

/* 从 AI 回复中解析 JSON 数组/对象（容忍代码块与多余文字） */
function extractJsonArray(content) {
  const text = stripThinking(content);
  if (!text) return null;
  const s = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = s.indexOf('[');
  const end = s.lastIndexOf(']');
  if (start !== -1 && end > start) {
    try {
      const v = JSON.parse(s.slice(start, end + 1));
      if (Array.isArray(v)) return v;
    } catch (e) { /* 继续尝试对象形式 */ }
  }
  const oStart = s.indexOf('{');
  const oEnd = s.lastIndexOf('}');
  if (oStart !== -1 && oEnd > oStart) {
    try {
      const v = JSON.parse(s.slice(oStart, oEnd + 1));
      if (v && Array.isArray(v.translations)) return v.translations;
    } catch (e) { /* 返回 null */ }
  }
  return null;
}

/* 提示词
   ⚠️ 必须出现字面量 "json"：DeepSeek / 通义千问等 OpenAI 兼容接口在 JSON 模式下会校验
   提示词中是否含「json」一词，否则直接 400（提示 'messages' must contain the word 'json'）。 */
function buildAIPrompt(lang) {
  return '你是专业的网页翻译引擎，输出 json。把用户消息中 JSON 数组里的每一段文字翻译成' + lang.ai + '。要求：'
    + '忠实传达原意，保持语气与段落结构；人名、地名、产品名等专有名词按常见译法或音译处理；'
    + '数字、单位、货币符号保持原样；只输出一个 json 对象，格式为 {"translations": ["译文1", "译文2", ...]}，'
    + '数组元素数量与顺序必须与输入完全一致，不要输出任何解释、思考过程或其它文字。';
}

/* 通用：解析 chat/completions 回复并校验数量 */
function mapAIResult(texts, content) {
  const clean = stripThinking(content);
  const arr = extractJsonArray(clean);
  if (arr && arr.length === texts.length) {
    return texts.map((t, i) => ({ text: t.text, translation: String(arr[i]).trim() }));
  }
  if (!arr && texts.length === 1 && clean) {
    return [{ text: texts[0].text, translation: clean }];
  }
  if (arr) {
    throw new Error('AI 返回的段落数量与请求不一致（请求 ' + texts.length + ' 段，返回 ' + arr.length + ' 段）。可在设置中调小「每批最大字符数」后重试。');
  }
  throw new Error('AI 返回内容无法解析为 json。可尝试：换用支持 JSON 输出的模型、关闭模型思考模式，或调小「每批最大字符数」。');
}

async function callChatCompletion(base, headers, body, texts) {
  const resp = await fetchWithTimeout(base + '/chat/completions', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => null);
  if (!resp.ok) {
    const msg = (data && data.error && data.error.message) || resp.statusText || '未知错误';
    const err = new Error('AI 请求失败 (HTTP ' + resp.status + '): ' + msg);
    err.status = resp.status;
    err.msg = msg;
    throw err;
  }
  const content = ((data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '');
  return mapAIResult(texts, content);
}

/* OpenAI 兼容接口：优先 JSON 输出模式；不支持的服务自动降级重试。
   注意：baseUrl 用整串拼接，绝不程序化追加 /v1 —— 各家的路径约定不同
   （DeepSeek 无 /v1、智谱是 /api/paas/v4、Gemini 是 /v1beta/openai）。 */
async function translateOpenAI(texts, lang, cfg) {
  const base = normalizeBaseUrl(cfg.baseUrl);
  if (!base) throw new Error('接口地址（Base URL）为空，请到设置中填写或选择服务商');
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey };
  const system = buildAIPrompt(lang);
  const user = JSON.stringify(texts.map(t => t.text));
  try {
    const out = await callChatCompletion(base, headers, {
      model: cfg.model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }, texts);
    // DeepSeek 等在 JSON 模式下偶发返回空内容，此时降级重试一次
    if (out.every(r => !r.translation)) throw new Error('AI 返回了空内容');
    return out;
  } catch (e) {
    const msg = String((e && e.msg) || (e && e.message) || '');
    const canFallback = !e.status || /response_format|400|空内容|json|JSON/i.test(msg);
    if (!canFallback) throw e;
  }
  return await callChatCompletion(base, headers, {
    model: cfg.model,
    temperature: 0.2,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  }, texts);
}

/* Anthropic Claude Messages API
   注意：Claude 的 Messages 接口没有 OpenAI 那种 response_format，因此走的是
   「要求模型输出 json 文本 + 本地解析」的路径，属正常用法而非降级。 */
async function translateAnthropic(texts, lang, cfg) {
  const system = buildAIPrompt(lang);
  const user = JSON.stringify(texts.map(t => t.text));
  const resp = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': cfg.apiKey,
      'anthropic-version': '2023-06-01',   // 该头缺失会直接 400
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: 4096,
      temperature: 0.2,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  const data = await resp.json().catch(() => null);
  if (!resp.ok) {
    const msg = (data && data.error && data.error.message) || '';
    const err = new Error('Claude 请求失败 (HTTP ' + resp.status + '): ' + msg);
    err.status = resp.status;
    err.msg = msg;
    throw err;
  }
  const content = ((data.content || []).filter(b => b.type === 'text').map(b => b.text).join(''));
  return mapAIResult(texts, content);
}

async function translateChunk(provider, texts, settings, lang) {
  const cfg = settings.providers[provider] || {};
  switch (provider) {
    case 'google':    return translateGoogle(texts, lang);
    case 'deepl':     return translateDeepL(texts, lang, cfg.apiKey);
    case 'baidu':     return translateBaidu(texts, lang, cfg);
    case 'youdao':    return translateYoudao(texts, lang, cfg);
    case 'openai':    return translateOpenAI(texts, lang, cfg);
    case 'anthropic': return translateAnthropic(texts, lang, cfg);
    default: throw new Error('未知的翻译服务: ' + provider);
  }
}

/* ---------------- 主入口：去重 → 查缓存 → 分批翻译（带重试） → 回填缓存 ---------------- */

async function translateTexts(requestKey, texts) {
  const settings = await getSettings();
  const provider = settings.provider;
  const lang = LANGS[settings.targetLang] || LANGS['zh-CN'];
  const need = providerReady(settings);
  if (need) throw new Error(need.message);

  // 去重：相同文本只翻译一次
  const unique = [];
  const seen = new Set();
  for (const t of texts) {
    if (t && t.text && !seen.has(t.text)) {
      seen.add(t.text);
      unique.push(t.text);
    }
  }

  const cache = await loadCache();
  const missing = unique.filter(text => !(cacheKey(text, provider, settings.targetLang) in cache));

  try {
    if (missing.length) {
      const chunked = getChunks(provider, missing.map(text => ({ text })), settings);
      for (const chunk of chunked) {
        if (aborts.get(requestKey) === true) throw new Error('翻译已取消');
        const res = await withRetry(
          () => translateChunk(provider, chunk, settings, lang),
          '翻译失败'
        );
        for (const r of res) {
          cache[cacheKey(r.text, provider, settings.targetLang)] = r.translation;
        }
      }
    }
  } finally {
    aborts.delete(requestKey); // 任务结束清理取消标记，避免 Map 无限增长
  }

  const saved = await commitCache(cache);
  // 若缓存超限被清空重建，把本次新增的译文补回
  if (saved !== cache && missing.length) {
    for (const text of missing) {
      saved[cacheKey(text, provider, settings.targetLang)] = cache[cacheKey(text, provider, settings.targetLang)];
    }
    await chrome.storage.local.set({ [CACHE_KEY]: saved });
  }
  return texts.map(t => ({
    id: t.id,
    text: saved[cacheKey(t.text, provider, settings.targetLang)] || '',
  }));
}

/* ---------------- 连接测试 ----------------
   用两段真实文本走完整链路（含 JSON 解析），比只探活更能暴露配置问题：
   模型名写错、密钥无效、区域不匹配、JSON 模式不被支持，都会在这里现形。 */

async function testConnection(rawSettings) {
  const settings = mergeSettings(rawSettings);
  const need = providerReady(settings);
  if (need) return { ok: false, error: need.message };
  const lang = LANGS[settings.targetLang] || LANGS['zh-CN'];
  const sample = [
    { text: 'Hello, world! This is a test message.', id: 0 },
    { text: 'Translation quality matters.', id: 1 },
  ];
  try {
    const res = await withRetry(
      () => translateChunk(settings.provider, sample, settings, lang),
      '测试失败'
    );
    const got = res.filter(r => r && r.translation);
    if (!got.length) {
      return { ok: false, error: '接口有响应但没有返回译文，请检查模型名称与目标语言设置' };
    }
    return {
      ok: true,
      text: got.map(r => r.translation).join(' / '),
      count: got.length,
      total: sample.length,
    };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

/* ---------------- 消息与快捷键 ---------------- */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'translateTexts') {
    const tabKey = sender.tab ? sender.tab.id : 'popup';
    translateTexts(tabKey + ':' + msg.requestId, msg.texts || [])
      .then(results => sendResponse({ ok: true, results }))
      .catch(e => sendResponse({ ok: false, error: String((e && e.message) || e) }));
    return true; // 异步响应
  }
  if (msg.type === 'abortTranslate') {
    const tabKey = sender.tab ? sender.tab.id : 'popup';
    const key = tabKey + ':' + msg.requestId;
    aborts.set(key, true);
    // 兜底：万一任务异常没能走到 finally，标记也不会永久滞留
    setTimeout(() => aborts.delete(key), 10 * 60 * 1000);
    sendResponse({ ok: true });
  }
  if (msg.type === 'testConnection') {
    testConnection(msg.settings).then(sendResponse);
    return true;
  }
  if (msg.type === 'getSettings') {
    getSettings().then(s => sendResponse({ ok: true, settings: s }));
    return true;
  }
  if (msg.type === 'clearCache') {
    clearCache().then(() => sendResponse({ ok: true }));
    return true;
  }
});

/* 快捷键 Alt+Q：翻译当前页面 */
chrome.commands.onCommand.addListener(async command => {
  if (command !== 'translate-page') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id == null) return;
  try {
    await ensureContentScript(tab.id);
    await chrome.tabs.sendMessage(tab.id, { type: 'translatePage' });
  } catch (e) { /* 受限页面静默失败 */ }
});

/* ---------------- 右键菜单 ---------------- */

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'vt-translate-page',
      title: '翻译此页（行内翻译）',
      contexts: ['page'],
    });
    chrome.contextMenus.create({
      id: 'vt-toggle',
      title: '隐藏 / 显示译文',
      contexts: ['page'],
    });
    chrome.contextMenus.create({
      id: 'vt-remove',
      title: '移除译文',
      contexts: ['page'],
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab || tab.id == null) return;
  try {
    await ensureContentScript(tab.id);
    switch (info.menuItemId) {
      case 'vt-translate-page':
        await chrome.tabs.sendMessage(tab.id, { type: 'translatePage' });
        break;
      case 'vt-toggle':
        await chrome.tabs.sendMessage(tab.id, { type: 'toggleTranslations' });
        break;
      case 'vt-remove':
        await chrome.tabs.sendMessage(tab.id, { type: 'removeTranslations' });
        break;
    }
  } catch (e) { /* 受限页面静默失败 */ }
});

/* 确保内容脚本就绪（页面在扩展安装前已打开时使用注入兜底） */
async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'ping' });
    return;
  } catch (e) { /* 未注入，继续 */ }
  await chrome.scripting.insertCSS({ target: { tabId }, files: ['content.css'] });
  await chrome.scripting.executeScript({ target: { tabId }, files: ['providers.js', 'content.js'] });
}
