/* 行内翻译 · 共享配置
   翻译服务元信息、AI 服务目录、语言映射、默认设置。
   同时被 background（importScripts）、popup / options（<script>）、content（content_scripts）加载。
   ⚠️ 本文件是共享层，禁止出现 chrome.* 调用，否则 popup / options / content 会报错。 */
'use strict';

/* ---------------- 目标语言 ---------------- */

/* 目标语言映射：各服务的语言代码不同，统一成内部键 */
const LANGS = {
  'zh-CN': { label: '简体中文', google: 'zh-CN', deepl: 'ZH-HANS', baidu: 'zh',   youdao: 'zh-CHS', ai: '简体中文' },
  'zh-TW': { label: '繁體中文', google: 'zh-TW', deepl: 'ZH-HANT', baidu: 'cht',  youdao: 'zh-CHT', ai: '繁体中文（台湾）' },
  'en':    { label: 'English',  google: 'en',    deepl: 'EN',      baidu: 'en',   youdao: 'en',     ai: 'English' },
  'ja':    { label: '日本語',    google: 'ja',    deepl: 'JA',      baidu: 'jp',   youdao: 'ja',     ai: 'Japanese' },
  'ko':    { label: '한국어',     google: 'ko',    deepl: 'KO',      baidu: 'kor',  youdao: 'ko',     ai: 'Korean' },
  'fr':    { label: 'Français', google: 'fr',    deepl: 'FR',      baidu: 'fra',  youdao: 'fr',     ai: 'French' },
  'de':    { label: 'Deutsch',  google: 'de',    deepl: 'DE',      baidu: 'de',   youdao: 'de',     ai: 'German' },
  'es':    { label: 'Español',  google: 'es',    deepl: 'ES',      baidu: 'spa',  youdao: 'es',     ai: 'Spanish' },
  'ru':    { label: 'Русский',  google: 'ru',    deepl: 'RU',      baidu: 'ru',   youdao: 'ru',     ai: 'Russian' },
};

/* ---------------- AI 服务目录（OpenAI 兼容端点） ----------------
   模型 ID 与端点每年都在变（很多旧 ID 会直接 404），因此 modelPresets 只是「建议值」，
   设置页的模型输入框允许自由填写，并且提供「查看可用模型列表」直达官方文档。
   source 字段标注该条目的核实情况，便于后续会话判断要不要重新核对（核实时间 2026-09-12）：
   - [官方] 厂商自有文档
   - [二手] 可信二手来源，未能读到厂商官方页
   - [未验证] 未经核实，仅作占位提示 */

const AI_ENDPOINTS = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',          // 注意：无 /v1
    hint: '国内直连，性价比高',
    applyUrl: 'https://platform.deepseek.com/api_keys',
    docsUrl: 'https://api-docs.deepseek.com/quick_start/pricing',
    source: '官方',
    modelPresets: [
      { id: 'deepseek-flash',  note: '最新、推荐（V4.1-Flash，闲时半价）' },
      { id: 'deepseek-v4-pro', note: '上一代旗舰（V4-Pro）' },
    ],
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    hint: '国内直连，有免费模型',
    applyUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',
    docsUrl: 'https://docs.bigmodel.cn/cn/guide/start/model-overview',
    source: '官方',
    modelPresets: [
      { id: 'glm-4.7-flash',  note: '免费，适合翻译' },
      { id: 'glm-4.5-flash',  note: '免费' },
      { id: 'glm-5.3-flash',  note: '最新多模态，便宜' },
      { id: 'glm-5.3',        note: '旗舰（思考模型，JSON 可能不稳）' },
    ],
  },
  {
    id: 'siliconflow',
    name: '硅基流动 SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    hint: '国内聚合，开源模型便宜',
    applyUrl: 'https://cloud.siliconflow.cn/account/ak',
    docsUrl: 'https://docs.siliconflow.cn/cn/userguide/quickstart',
    source: '官方',
    modelPresets: [
      { id: 'Qwen/Qwen3-8B',                            note: '便宜、中文好' },
      { id: 'openai/gpt-oss-20b',                       note: '极便宜' },
      { id: 'zai-org/GLM-5.3-Flash',                    note: 'GLM 轻量版' },
      { id: 'deepseek-ai/DeepSeek-V4-Flash',            note: 'DeepSeek 轻量版' },
    ],
  },
  {
    id: 'moonshot',
    name: 'Moonshot Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    hint: '国内直连（单价偏高）',
    applyUrl: 'https://platform.moonshot.cn/console/api-keys',
    docsUrl: 'https://platform.kimi.com/docs/models',
    source: '官方',
    modelPresets: [
      { id: 'kimi-k3',                  note: '最新旗舰，1M 上下文' },
      { id: 'kimi-k2.7-code-highspeed', note: '高速版' },
      { id: 'kimi-k2.6',                note: '上一代' },
    ],
  },
  {
    id: 'qwen',
    name: '阿里通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    hint: '国内直连（密钥分区域）',
    applyUrl: 'https://bailian.console.aliyun.com/',
    docsUrl: 'https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope',
    source: '官方',
    modelPresets: [
      { id: 'qwen-flash',    note: '极便宜，适合大批量' },
      { id: 'qwen-mt-turbo', note: '翻译专用模型' },
      { id: 'qwen-mt-plus',  note: '翻译专用（质量更高）' },
      { id: 'qwen-plus',     note: '通用均衡' },
    ],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter（聚合）',
    baseUrl: 'https://openrouter.ai/api/v1',
    hint: '一个密钥用几百个模型',
    applyUrl: 'https://openrouter.ai/keys',
    docsUrl: 'https://openrouter.ai/models',
    source: '官方',
    modelPresets: [
      { id: 'deepseek/deepseek-v4-flash',       note: '便宜' },
      { id: 'google/gemini-2.5-flash-lite',     note: '便宜、快' },
      { id: 'openai/gpt-oss-20b',               note: '开源小模型' },
      { id: 'anthropic/claude-haiku-4.5',       note: '质量高（注意 ID 写法与官方不同）' },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    hint: '官方接口（国内需代理）',
    applyUrl: 'https://platform.openai.com/api-keys',
    docsUrl: 'https://platform.openai.com/docs/models',
    source: '二手',
    modelPresets: [
      { id: 'gpt-5-nano',    note: '最便宜' },
      { id: 'gpt-4o-mini',   note: '经典便宜档' },
      { id: 'gpt-5-mini',    note: '均衡' },
      { id: 'gpt-5.6-luna',  note: '较新，1M 上下文' },
    ],
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',  // 注意：v1beta，无 /v1
    hint: '有免费额度（国内需代理）',
    applyUrl: 'https://aistudio.google.com/app/apikey',
    docsUrl: 'https://ai.google.dev/gemini-api/docs/openai',
    source: '二手',
    modelPresets: [
      { id: 'gemini-2.5-flash-lite',     note: '最便宜' },
      { id: 'gemini-3.5-flash-lite',     note: '较新轻量' },
      { id: 'gemini-3.8-flash',          note: '最新 Flash' },
    ],
  },
  {
    id: 'ollama',
    name: 'Ollama（本地）',
    baseUrl: 'http://localhost:11434/v1',
    hint: '本地运行，免费、不联网、隐私最好',
    applyUrl: '',
    docsUrl: 'https://docs.ollama.com/api/openai-compatibility',
    source: '官方',
    needsKey: false,
    modelPresets: [
      { id: 'translategemma:4b', note: '翻译专用（Google TranslateGemma，55 语种，约 3.3GB）' },
      { id: 'translategemma:12b', note: '翻译专用，质量更好（约 8.1GB）' },
      { id: 'hy-mt2:7b',         note: '腾讯混元翻译专用（33 语种，约 4.6GB）' },
      { id: 'qwen3:8b',          note: '通用，中文强（约 5GB）' },
      { id: 'gemma3:4b',         note: '通用轻量，多语言' },
    ],
  },
  {
    id: 'custom',
    name: '其它 OpenAI 兼容服务',
    baseUrl: '',
    hint: '手动填写地址（MiniMax、Groq、Together、自建 vLLM 等）',
    applyUrl: '',
    docsUrl: '',
    source: '',
    modelPresets: [],
  },
];

/* 端点查找（id 可能为空或已失效，都要能安全返回） */
function findEndpoint(id) {
  return AI_ENDPOINTS.find(e => e.id === id) || AI_ENDPOINTS[AI_ENDPOINTS.length - 1];
}

/* 按 Base URL 反查端点：用户粘贴一个地址，自动识别是哪家服务 */
function guessEndpointId(baseUrl) {
  const u = normalizeBaseUrl(baseUrl).toLowerCase();
  if (!u) return '';
  // 先精确匹配内置端点（忽略协议与尾斜杠差异）
  const strip = s => String(s || '').toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const target = strip(u);
  const exact = AI_ENDPOINTS.find(e => e.baseUrl && strip(e.baseUrl) === target);
  if (exact) return exact.id;
  // 再按特征域名模糊识别，覆盖用户填写了带路径 / 尾斜杠的地址
  const rules = [
    [/api\.deepseek\.com/, 'deepseek'],
    [/bigmodel\.cn|api\.z\.ai/, 'zhipu'],
    [/siliconflow\.(cn|com)/, 'siliconflow'],
    [/moonshot\.(cn|ai)/, 'moonshot'],
    [/dashscope|aliyuncs\.com\/compatible-mode/, 'qwen'],
    [/openrouter\.ai/, 'openrouter'],
    [/api\.openai\.com/, 'openai'],
    [/generativelanguage\.googleapis\.com/, 'gemini'],
    [/localhost|127\.0\.0\.1/, 'ollama'],
  ];
  for (const [re, id] of rules) if (re.test(u)) return id;
  return 'custom';
}

/* 统一 Base URL：去空白、去尾斜杠（background 拼 /chat/completions 时依赖这一点） */
function normalizeBaseUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

/* ---------------- 翻译服务元信息 ----------------
   fields[].required  是否必填（baseUrl 对 OpenAI 兼容服务也是必填，但用户改地址时才算缺失）
   needsKey           该服务是否需要密钥（Ollama 本地不需要，缺失时不报错） */

const PROVIDERS = [
  {
    id: 'google',
    name: 'Google 翻译（免费）',
    desc: '无需密钥，免费使用，适合日常阅读',
    group: 'api',
    applyUrl: '',
    applyText: '无需申请',
    fields: [],
  },
  {
    id: 'deepl',
    name: 'DeepL',
    desc: '专业级翻译质量，免费额度 50 万字符/月',
    group: 'api',
    applyUrl: 'https://www.deepl.com/pro-api',
    applyText: '申请 DeepL API',
    fields: [
      { key: 'apiKey', label: 'DeepL API Key', type: 'password', placeholder: 'xxxx-xxxx-xxxx-xxxx（免费版以 :fx 结尾）', required: true },
    ],
  },
  {
    id: 'baidu',
    name: '百度翻译',
    desc: '通用文本翻译，免费额度 100 万字符/月（需实名认证）',
    group: 'api',
    applyUrl: 'https://fanyi-api.baidu.com/',
    applyText: '申请百度翻译开放平台',
    fields: [
      { key: 'appId', label: 'APP ID', type: 'text', placeholder: '在开发者信息中查看', required: true },
      { key: 'secretKey', label: '密钥', type: 'password', placeholder: '在开发者信息中查看', required: true },
    ],
  },
  {
    id: 'youdao',
    name: '有道翻译（智云）',
    desc: '网易有道智云翻译，注册赠送体验额度',
    group: 'api',
    applyUrl: 'https://ai.youdao.com/',
    applyText: '申请有道智云',
    fields: [
      { key: 'appKey', label: '应用 ID（appKey）', type: 'text', required: true },
      { key: 'appSecret', label: '应用密钥（appSecret）', type: 'password', required: true },
    ],
  },
  {
    id: 'openai',
    name: 'AI 大模型 · OpenAI 兼容接口',
    desc: 'OpenAI / DeepSeek / Kimi / 智谱 GLM / Ollama 本地等，任选一家填写',
    group: 'ai',
    applyUrl: 'https://platform.openai.com/api-keys',
    applyText: '申请 API Key',
    fields: [
      { key: 'endpoint',   label: '服务商', type: 'endpoint' },
      { key: 'baseUrl',    label: '接口地址（Base URL）', type: 'text', placeholder: 'https://api.deepseek.com', required: true },
      { key: 'apiKey',     label: 'API Key', type: 'password', required: true },
      { key: 'model',      label: '模型名称', type: 'model', placeholder: 'deepseek-flash', required: true },
    ],
  },
  {
    id: 'anthropic',
    name: 'AI 大模型 · Anthropic Claude',
    desc: 'Claude 系列模型，翻译质量高',
    group: 'ai',
    applyUrl: 'https://console.anthropic.com/settings/keys',
    applyText: '申请 Claude API Key',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password', required: true },
      { key: 'model',  label: '模型名称', type: 'model', placeholder: 'claude-sonnet-5', required: true,
        modelPresets: [
          { id: 'claude-sonnet-5',   note: '推荐，速度与质量平衡' },
          { id: 'claude-haiku-4-5',  note: '更快更省' },
          { id: 'claude-opus-5',     note: '最强，较贵' },
        ],
        docsUrl: 'https://platform.claude.com/docs/en/about-claude/models/overview',
      },
    ],
  },
];

/* 每个服务默认要提交字符数（仅 AI 模式与有道真正生效，其它服务走各自硬上限） */
const BATCHABLE = { openai: true, anthropic: true };

/* ---------------- 默认设置 ---------------- */

/* OpenAI 兼容服务的默认端点槽位：每家一套 baseUrl / apiKey / model，互不覆盖 */
const OPENAI_ADDRESS_SLOTS = {
  deepseek:    { baseUrl: 'https://api.deepseek.com',                                 apiKey: '', model: 'deepseek-flash' },
  zhipu:       { baseUrl: 'https://open.bigmodel.cn/api/paas/v4',                      apiKey: '', model: 'glm-4.7-flash' },
  siliconflow: { baseUrl: 'https://api.siliconflow.cn/v1',                            apiKey: '', model: 'Qwen/Qwen3-8B' },
  moonshot:    { baseUrl: 'https://api.moonshot.cn/v1',                               apiKey: '', model: 'kimi-k3' },
  qwen:        { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',        apiKey: '', model: 'qwen-flash' },
  openrouter:  { baseUrl: 'https://openrouter.ai/api/v1',                             apiKey: '', model: 'deepseek/deepseek-v4-flash' },
  openai:      { baseUrl: 'https://api.openai.com/v1',                                apiKey: '', model: 'gpt-5-nano' },
  gemini:      { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',  apiKey: '', model: 'gemini-2.5-flash-lite' },
  // 本地 Ollama 的 apiKey 是「必填但被忽略」的占位值，预填 ollama 省得用户困惑
  ollama:      { baseUrl: 'http://localhost:11434/v1',                                apiKey: 'ollama', model: 'translategemma:4b' },
  custom:      { baseUrl: '',                                                         apiKey: '', model: '' },
};

const DEFAULT_SETTINGS = {
  provider: 'google',
  targetLang: 'zh-CN',
  maxChars: 1200,
  providers: {
    deepl:     { apiKey: '' },
    baidu:     { appId: '', secretKey: '' },
    youdao:    { appKey: '', appSecret: '' },
    // OpenAI 兼容：addresses 按端点 id 分别保存，切换服务商不丢已填密钥
    openai:    { endpoint: 'deepseek', addresses: JSON.parse(JSON.stringify(OPENAI_ADDRESS_SLOTS)) },
    anthropic: { apiKey: '', model: 'claude-sonnet-5' },
  },
};

/* ---------------- 设置归一化 ---------------- */

/* 深拷贝默认设置（避免调用方改到常量） */
function cloneDefaults() {
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

/* OpenAI 兼容服务：把「当前端点」的配置提升为扁平字段（baseUrl / apiKey / model），
   供 background 直接读取；同时把扁平改动写回 addresses[endpoint]。
   历史上 openai 配置是扁平的，这里做一次兼容迁移。 */
function materializeOpenAI(cfg) {
  if (!cfg || typeof cfg !== 'object') cfg = {};
  const addresses = (cfg.addresses && typeof cfg.addresses === 'object')
    ? JSON.parse(JSON.stringify(cfg.addresses))
    : {};
  // 迁移旧结构：{ baseUrl, apiKey, model } → addresses[识别出的端点]
  let guessed = '';
  if (!cfg.addresses && (cfg.baseUrl || cfg.apiKey || cfg.model)) {
    guessed = guessEndpointId(cfg.baseUrl) || 'custom';
    const def = OPENAI_ADDRESS_SLOTS[guessed] || { baseUrl: '', apiKey: '', model: '' };
    addresses[guessed] = {
      baseUrl: normalizeBaseUrl(cfg.baseUrl) || def.baseUrl,
      apiKey: typeof cfg.apiKey === 'string' ? cfg.apiKey.trim() : '',
      model: typeof cfg.model === 'string' && cfg.model ? cfg.model : def.model,
    };
  }
  // 补齐所有内置端点的槽位
  for (const ep of AI_ENDPOINTS) {
    const def = OPENAI_ADDRESS_SLOTS[ep.id] || { baseUrl: '', apiKey: '', model: '' };
    const cur = addresses[ep.id] || {};
    addresses[ep.id] = {
      baseUrl: normalizeBaseUrl(typeof cur.baseUrl === 'string' ? cur.baseUrl : '') || def.baseUrl,
      apiKey:  typeof cur.apiKey === 'string' ? cur.apiKey : (def.apiKey || ''),
      model:   typeof cur.model === 'string' && cur.model ? cur.model : (def.model || ''),
    };
  }
  // 端点优先级：显式指定 > 迁移时识别出的 > 默认
  let endpoint = typeof cfg.endpoint === 'string' && cfg.endpoint ? cfg.endpoint : '';
  if (!AI_ENDPOINTS.some(e => e.id === endpoint)) endpoint = guessed || 'deepseek';
  if (!AI_ENDPOINTS.some(e => e.id === endpoint)) endpoint = 'deepseek';
  const active = addresses[endpoint];
  const epMeta = AI_ENDPOINTS.find(e => e.id === endpoint) || {};
  return {
    endpoint,
    addresses,
    baseUrl: active.baseUrl,
    apiKey: active.apiKey,
    model: active.model,
    // 本地 Ollama 不需要真正的密钥（接口要求传但会忽略）
    needsKey: epMeta.needsKey !== false,
  };
}

/* 把扁平字段写回 addresses（设置页保存前调用）
   flatAuthoritative=true  ：扁平字段代表「当前端点」的最新输入，用它覆盖该端点槽位（表单收集路径）
   flatAuthoritative=false ：扁平字段只是物化出来的派生值，可能还指向旧端点，
                             此时**不能**回写（mergeSettings 路径，否则切换服务商会被旧值覆盖） */
function flattenOpenAI(cfg, flatAuthoritative) {
  if (!cfg || typeof cfg !== 'object') cfg = {};
  const out = materializeOpenAI(cfg);
  const active = out.addresses[out.endpoint];
  if (flatAuthoritative !== false) {
    if (typeof cfg.baseUrl === 'string' && normalizeBaseUrl(cfg.baseUrl)) active.baseUrl = normalizeBaseUrl(cfg.baseUrl);
    if (typeof cfg.apiKey === 'string') active.apiKey = cfg.apiKey.trim();
    if (typeof cfg.model === 'string' && cfg.model.trim()) active.model = cfg.model.trim();
  }
  out.baseUrl = active.baseUrl;
  out.apiKey = active.apiKey;
  out.model = active.model;
  return out;
}

/* 将存储中的设置与默认值合并（含合法性约束） */
function mergeSettings(raw) {
  const base = cloneDefaults();
  base.providers.openai = flattenOpenAI(base.providers.openai);   // 让内部标记位同步就位
  if (!raw || typeof raw !== 'object') return base;
  if (PROVIDERS.some(p => p.id === raw.provider)) base.provider = raw.provider;
  if (LANGS[raw.targetLang]) base.targetLang = raw.targetLang;
  base.maxChars = Math.min(4000, Math.max(200, Number(raw.maxChars) || base.maxChars));

  const stored = (raw.providers && typeof raw.providers === 'object') ? raw.providers : {};

  for (const pid in base.providers) {
    const sp = (stored[pid] && typeof stored[pid] === 'object') ? stored[pid] : {};
    if (pid === 'openai') {
      // 注意第二参数：合并路径下扁平字段是派生值，不能回写（否则切换服务商会被旧端点覆盖）
      base.providers.openai = flattenOpenAI(sp, false);
      continue;
    }
    for (const k in base.providers[pid]) {
      const v = sp[k];
      if (typeof v === 'string') base.providers[pid][k] = v;
      else if (typeof v === 'number') base.providers[pid][k] = v;
    }
  }
  // 旧版把 openai 的密钥直接放在 raw.providers.openai 扁平字段里，materializeOpenAI 已迁移
  return base;
}

/* ---------------- 就绪判定 ----------------
   返回 null 表示可翻译；否则返回 { message, fields } ——
   fields 是缺失字段的 key 数组，设置页可据此高亮对应输入框。 */

function providerReady(settings) {
  const meta = PROVIDERS.find(p => p.id === settings.provider);
  if (!meta) return { message: '未知的翻译服务，请到设置中重新选择', fields: [] };
  const cfg = (settings.providers && settings.providers[settings.provider]) || {};

  // 本地服务（Ollama）不需要密钥，apiKey 缺失不算未就绪
  const skipKey = settings.provider === 'openai' && cfg.needsKey === false;
  const missing = meta.fields
    .filter(f => f.required)
    .filter(f => !(skipKey && f.key === 'apiKey'))
    .filter(f => !String(cfg[f.key] || '').trim());

  if (missing.length) {
    const epName = (settings.provider === 'openai')
      ? (AI_ENDPOINTS.find(e => e.id === cfg.endpoint) || {}).name
      : '';
    return {
      message: '「' + meta.name + (epName && epName !== meta.name ? ' · ' + epName : '') + '」还差：'
        + missing.map(f => f.label).join('、'),
      fields: missing.map(f => f.key),
    };
  }
  // OpenAI 兼容服务额外校验地址形状，避免保存了明显写错的地址
  if (settings.provider === 'openai') {
    const url = normalizeBaseUrl(cfg.baseUrl);
    if (!/^https?:\/\/.+/i.test(url)) {
      return { message: '接口地址需要以 http:// 或 https:// 开头（本地 Ollama 用 http://localhost:11434/v1）', fields: ['baseUrl'] };
    }
  }
  return null;
}

/* 就绪判定的文字版（供既有调用方与提示文案使用） */
function providerReadyMessage(settings) {
  const r = providerReady(settings);
  return r ? r.message : null;
}
