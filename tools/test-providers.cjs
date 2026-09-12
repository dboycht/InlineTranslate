/* providers.js 逻辑测试（临时脚本，不入库）
   用 Node 直接跑共享层，验证：旧结构迁移 / 端点隔离 / 就绪判定 / 地址识别 */
'use strict';
const fs = require('fs');
const vm = require('vm');

const src = fs.readFileSync('D:/code/DeepSeekHarness/InlineTranslate/providers.js', 'utf8');
const ctx = { console };
vm.createContext(ctx);
// providers.js 顶层用 const 声明，不会自动挂到 context 上，这里显式导出
vm.runInContext(
  src + '\n;globalThis.__exp = { mergeSettings, providerReady, guessEndpointId, flattenOpenAI,'
      + ' materializeOpenAI, normalizeBaseUrl, DEFAULT_SETTINGS, AI_ENDPOINTS, LANGS, PROVIDERS };',
  ctx
);
const {
  mergeSettings, providerReady, guessEndpointId, flattenOpenAI,
  materializeOpenAI, normalizeBaseUrl, DEFAULT_SETTINGS, AI_ENDPOINTS, LANGS, PROVIDERS,
} = ctx.__exp;

let pass = 0, fail = 0;
function t(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  → ' + extra : '')); }
}

console.log('\n[1] 空设置 → 默认值');
const d = mergeSettings(undefined);
t('provider 默认 google', d.provider === 'google', d.provider);
t('maxChars 默认 1200', d.maxChars === 1200);
t('openai.endpoint 默认 deepseek', d.providers.openai.endpoint === 'deepseek');
t('openai 扁平字段已就位', d.providers.openai.baseUrl === 'https://api.deepseek.com', 'got=' + JSON.stringify(d.providers.openai.baseUrl));
t('openai.model 预填', d.providers.openai.model === 'deepseek-flash', d.providers.openai.model);
t('ollama 槽位密钥占位 ollama', d.providers.openai.addresses.ollama.apiKey === 'ollama');
t('每种端点都有槽位', AI_ENDPOINTS.every(e => d.providers.openai.addresses[e.id]), '缺槽位');

console.log('\n[2] 旧扁平结构迁移（v1.00.2 用户升级）');
const legacy = mergeSettings({
  provider: 'openai',
  providers: { openai: { baseUrl: 'https://api.moonshot.cn/v1', apiKey: 'sk-old', model: 'kimi-latest' } },
});
t('旧 provider 保留', legacy.provider === 'openai');
t('baseUrl 被识别为 moonshot 槽位', legacy.providers.openai.endpoint === 'moonshot', legacy.providers.openai.endpoint);
t('apiKey 迁移成功', legacy.providers.openai.apiKey === 'sk-old', legacy.providers.openai.apiKey);
t('model 迁移成功', legacy.providers.openai.model === 'kimi-latest');
t('moonshot 槽位同时写入', legacy.providers.openai.addresses.moonshot.apiKey === 'sk-old');
t('deepseek 槽位未被污染', legacy.providers.openai.addresses.deepseek.apiKey === '');

console.log('\n[3] 端点隔离：切换服务商互不覆盖');
let s = mergeSettings({
  provider: 'openai',
  providers: { openai: { endpoint: 'deepseek', addresses: {
    deepseek: { baseUrl: 'https://api.deepseek.com', apiKey: 'KEY-A', model: 'deepseek-flash' },
    zhipu:    { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', apiKey: 'KEY-B', model: 'glm-4.7-flash' },
  } } },
});
t('切到 deepseek 拿到 KEY-A', s.providers.openai.apiKey === 'KEY-A', s.providers.openai.apiKey);
t('deepseek 地址正确', s.providers.openai.baseUrl === 'https://api.deepseek.com');
s.providers.openai.endpoint = 'zhipu';
s = mergeSettings(s);
t('切到 zhipu 拿到 KEY-B', s.providers.openai.apiKey === 'KEY-B', s.providers.openai.apiKey);
t('zhipu 地址正确', s.providers.openai.baseUrl === 'https://open.bigmodel.cn/api/paas/v4', s.providers.openai.baseUrl);
t('zhipu 模型正确', s.providers.openai.model === 'glm-4.7-flash');

console.log('\n[3b] 回归：切换端点后再次 mergeSettings 不得被旧端点覆盖');
{
  let a = mergeSettings({
    provider: 'openai',
    providers: { openai: { endpoint: 'deepseek', addresses: {
      deepseek: { baseUrl: 'https://api.deepseek.com', apiKey: 'KEY-A', model: 'deepseek-flash' },
      zhipu:    { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', apiKey: 'KEY-B', model: 'glm-4.7-flash' },
    } } },
  });
  // 模拟「刚刚通过界面切到 zhipu 并保存」
  a.providers.openai.endpoint = 'zhipu';
  const b = mergeSettings(a);
  t('端点保持 zhipu', b.providers.openai.endpoint === 'zhipu', b.providers.openai.endpoint);
  t('apiKey 仍为 KEY-B（未被 KEY-A 覆盖）', b.providers.openai.apiKey === 'KEY-B', b.providers.openai.apiKey);
  t('baseUrl 仍为智谱地址', b.providers.openai.baseUrl === 'https://open.bigmodel.cn/api/paas/v4', b.providers.openai.baseUrl);
  t('zhipu 槽位未被污染', b.providers.openai.addresses.zhipu.apiKey === 'KEY-B', JSON.stringify(b.providers.openai.addresses.zhipu));
  // 再走一遍（幂等性）
  const c = mergeSettings(b);
  t('多次合并保持稳定（幂等）', c.providers.openai.apiKey === 'KEY-B' && c.providers.openai.baseUrl === b.providers.openai.baseUrl);
}

console.log('\n[4] flattenOpenAI 写回（设置页保存路径）');
const flat = flattenOpenAI({
  endpoint: 'deepseek',
  baseUrl: 'https://api.deepseek.com/',
  apiKey: '  KEY-C  ',
  model: 'deepseek-v4-pro',
  addresses: JSON.parse(JSON.stringify(DEFAULT_SETTINGS.providers.openai.addresses)),
});
t('尾斜杠被去掉', flat.baseUrl === 'https://api.deepseek.com', flat.baseUrl);
t('扁平 apiKey 写入槽位（并去空白）', flat.addresses.deepseek.apiKey === 'KEY-C', JSON.stringify(flat.addresses.deepseek.apiKey));
t('模型写入槽位', flat.addresses.deepseek.model === 'deepseek-v4-pro');
t('其它槽位不受影响', flat.addresses.zhipu.apiKey === '');

console.log('\n[5] 就绪判定');
t('google 无需配置即可用', providerReady({ provider: 'google', providers: {} }) === null);
t('anthropic 缺密钥被拦', !!providerReady({ provider: 'anthropic', providers: { anthropic: { apiKey: '', model: 'claude-sonnet-5' } } }));
t('anthropic 齐全通过', providerReady({ provider: 'anthropic', providers: { anthropic: { apiKey: 'k', model: 'claude-sonnet-5' } } }) === null);
const ollamaS = mergeSettings({ provider: 'openai', providers: { openai: { endpoint: 'ollama', addresses: { ollama: { baseUrl: 'http://localhost:11434/v1', apiKey: '', model: 'translategemma:4b' } } } } });
t('Ollama 无密钥也算就绪', providerReady(ollamaS) === null, JSON.stringify(providerReady(ollamaS)));
const badUrl = mergeSettings({ provider: 'openai', providers: { openai: { endpoint: 'custom', addresses: { custom: { baseUrl: 'api.example.com/v1', apiKey: 'k', model: 'm' } } } } });
const badRes = providerReady(badUrl);
t('缺协议的地址被拦下', !!badRes && badRes.fields.includes('baseUrl'), JSON.stringify(badRes));
const dm = mergeSettings({ provider: 'openai', providers: { openai: { endpoint: 'deepseek', addresses: { deepseek: { baseUrl: 'https://api.deepseek.com', apiKey: '', model: 'deepseek-flash' } } } } });
const dmRes = providerReady(dm);
t('缺密钥时报出 apiKey 字段', !!dmRes && dmRes.fields.includes('apiKey'), JSON.stringify(dmRes));
t('缺密钥提示带服务商名', !!dmRes && dmRes.message.includes('DeepSeek'), dmRes && dmRes.message);

console.log('\n[6] Base URL 自动识别');
const cases = [
  ['https://api.deepseek.com', 'deepseek'],
  ['https://api.deepseek.com/', 'deepseek'],
  ['HTTPS://API.DEEPSEEK.COM', 'deepseek'],
  ['https://api.moonshot.cn/v1', 'moonshot'],
  ['https://open.bigmodel.cn/api/paas/v4', 'zhipu'],
  ['https://api.siliconflow.cn/v1', 'siliconflow'],
  ['https://dashscope.aliyuncs.com/compatible-mode/v1', 'qwen'],
  ['https://openrouter.ai/api/v1', 'openrouter'],
  ['https://api.openai.com/v1', 'openai'],
  ['https://generativelanguage.googleapis.com/v1beta/openai', 'gemini'],
  ['http://localhost:11434/v1', 'ollama'],
  ['http://127.0.0.1:1234/v1', 'ollama'],
  ['https://my-own-gateway.example.com/v1', 'custom'],
  ['', ''],
];
for (const [url, want] of cases) {
  const got = guessEndpointId(url);
  t('识别 ' + (url || '(空)') + ' → ' + (want || '(空)'), got === want, 'got=' + got);
}

console.log('\n[7] 非法输入不崩');
t('mergeSettings(null)', !!mergeSettings(null));
t('mergeSettings("x")', !!mergeSettings('x'));
t('mergeSettings({providers:null})', !!mergeSettings({ providers: null }));
t('maxChars 越界被夹紧', mergeSettings({ maxChars: 99999 }).maxChars === 4000);
t('maxChars 过小被夹紧', mergeSettings({ maxChars: 1 }).maxChars === 200);
t('未知 provider 回落', mergeSettings({ provider: 'nope' }).provider === 'google');
t('未知 targetLang 回落', mergeSettings({ targetLang: 'xx' }).targetLang === 'zh-CN');
t('地址归一化', normalizeBaseUrl('  https://a.com/v1///  ') === 'https://a.com/v1', normalizeBaseUrl('  https://a.com/v1///  '));

console.log('\n[8] 目录自检');
t('每个端点有 name/baseUrl 字段', AI_ENDPOINTS.every(e => e.name && typeof e.baseUrl === 'string'));
t('模型预设都有 id', AI_ENDPOINTS.every(e => (e.modelPresets || []).every(m => m.id)));
t('google 不需要字段', (PROVIDERS.find(p => p.id === 'google').fields || []).length === 0);
t('9 种语言', Object.keys(LANGS).length === 9);

console.log('\n' + '='.repeat(46));
console.log(`通过 ${pass}  失败 ${fail}`);
process.exit(fail ? 1 : 0);
