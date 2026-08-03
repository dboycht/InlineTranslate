/* 行内翻译 · 共享配置
   翻译服务元信息、语言映射、默认设置。
   同时被 background（importScripts）、popup / options（<script>）、content（content_scripts）加载。 */
'use strict';

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

/* 翻译服务元信息（申请链接 + 表单字段 + 必填项） */
const PROVIDERS = [
  {
    id: 'google',
    name: 'Google 翻译（免费）',
    desc: '无需密钥，免费使用，适合日常阅读',
    applyUrl: '',
    applyText: '无需申请',
    fields: [],
  },
  {
    id: 'deepl',
    name: 'DeepL',
    desc: '专业级翻译质量，免费额度 50 万字符/月',
    applyUrl: 'https://www.deepl.com/pro-api',
    applyText: '申请 DeepL API',
    fields: [
      { key: 'apiKey', label: 'DeepL API Key', type: 'password', placeholder: 'xxxx-xxxx-xxxx-xxxx（免费版以 :fx 结尾）' },
    ],
  },
  {
    id: 'baidu',
    name: '百度翻译',
    desc: '通用文本翻译，免费额度 100 万字符/月（需实名认证）',
    applyUrl: 'https://fanyi-api.baidu.com/',
    applyText: '申请百度翻译开放平台',
    fields: [
      { key: 'appId', label: 'APP ID', type: 'text', placeholder: '在开发者信息中查看' },
      { key: 'secretKey', label: '密钥', type: 'password', placeholder: '在开发者信息中查看' },
    ],
  },
  {
    id: 'youdao',
    name: '有道翻译（智云）',
    desc: '网易有道智云翻译，注册赠送体验额度',
    applyUrl: 'https://ai.youdao.com/',
    applyText: '申请有道智云',
    fields: [
      { key: 'appKey', label: '应用 ID（appKey）', type: 'text' },
      { key: 'appSecret', label: '应用密钥（appSecret）', type: 'password' },
    ],
  },
  {
    id: 'openai',
    name: 'AI 大模型 · OpenAI 兼容接口',
    desc: '可接入 OpenAI / DeepSeek / Moonshot Kimi / 智谱 GLM / Ollama 本地 等',
    applyUrl: 'https://platform.openai.com/api-keys',
    applyText: '申请 OpenAI API Key（其它服务见 README）',
    fields: [
      { key: 'baseUrl', label: '接口地址 Base URL', type: 'text', placeholder: 'https://api.openai.com/v1' },
      { key: 'apiKey', label: 'API Key', type: 'password' },
      { key: 'model', label: '模型名称', type: 'text', placeholder: 'gpt-4o-mini' },
    ],
  },
  {
    id: 'anthropic',
    name: 'AI 大模型 · Anthropic Claude',
    desc: 'Claude 系列模型，翻译质量高',
    applyUrl: 'https://console.anthropic.com/settings/keys',
    applyText: '申请 Claude API Key',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password' },
      { key: 'model', label: '模型名称', type: 'text', placeholder: 'claude-haiku-4-5-20251001' },
    ],
  },
];

/* OpenAI 兼容接口常用预设 */
const OPENAI_PRESETS = [
  { name: 'OpenAI',        baseUrl: 'https://api.openai.com/v1',            model: 'gpt-4o-mini' },
  { name: 'DeepSeek',      baseUrl: 'https://api.deepseek.com',             model: 'deepseek-chat' },
  { name: 'Moonshot Kimi', baseUrl: 'https://api.moonshot.cn/v1',           model: 'kimi-latest' },
  { name: '智谱 GLM',       baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { name: 'Ollama 本地',    baseUrl: 'http://localhost:11434/v1',            model: 'llama3.1' },
];

/* Claude 模型预设 */
const ANTHROPIC_MODELS = [
  'claude-haiku-4-5-20251001',
  'claude-sonnet-5',
  'claude-opus-5',
];

/* 默认设置 */
const DEFAULT_SETTINGS = {
  provider: 'google',
  targetLang: 'zh-CN',
  maxChars: 1200,
  providers: {
    deepl:     { apiKey: '' },
    baidu:     { appId: '', secretKey: '' },
    youdao:    { appKey: '', appSecret: '' },
    openai:    { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o-mini' },
    anthropic: { apiKey: '', model: 'claude-haiku-4-5-20251001' },
  },
};

/* 将存储中的设置与默认值合并（含合法性约束） */
function mergeSettings(raw) {
  const base = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  if (!raw || typeof raw !== 'object') return base;
  if (PROVIDERS.some(p => p.id === raw.provider)) base.provider = raw.provider;
  if (LANGS[raw.targetLang]) base.targetLang = raw.targetLang;
  base.maxChars = Math.min(4000, Math.max(200, Number(raw.maxChars) || base.maxChars));
  for (const pid in base.providers) {
    const sp = (raw.providers && raw.providers[pid]) || {};
    for (const k in base.providers[pid]) {
      if (typeof sp[k] === 'string') base.providers[pid][k] = sp[k];
      else if (typeof sp[k] === 'number') base.providers[pid][k] = sp[k];
    }
  }
  return base;
}

/* 检查当前服务的必填项是否齐全；齐全返回 null，否则返回提示文字 */
function providerReady(settings) {
  const meta = PROVIDERS.find(p => p.id === settings.provider);
  if (!meta) return '未知的翻译服务';
  const cfg = settings.providers[settings.provider] || {};
  const missing = meta.fields
    .filter(f => f.key !== 'baseUrl') // baseUrl 有默认值兜底
    .filter(f => !cfg[f.key]);
  if (missing.length) {
    return '“' + meta.name + '”还差：' + missing.map(f => f.label).join('、') + '，请到设置中填写';
  }
  return null;
}
