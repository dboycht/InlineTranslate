/* 行内翻译 · 内容脚本
   提取正文段落 → 分批翻译 → 在每段原文下方插入译文块（不覆盖原文）。 */
(() => {
  'use strict';
  if (window.__vtLoaded) return;
  window.__vtLoaded = true;

  const SKIP_SELECTOR =
    'script, style, noscript, template, code, pre, kbd, samp, textarea, input, select, option, button, ' +
    'canvas, iframe, object, embed, svg, math, ruby, [contenteditable="true"], [aria-hidden="true"], [hidden], ' +
    '.vt-block, nav, [role="navigation"], [role="menu"], [role="banner"], [role="contentinfo"]';
  const INNER_BLOCK_SELECTOR =
    'p, div, li, blockquote, h1, h2, h3, h4, h5, h6, table, ul, ol, pre, figure, section, article, td, dd, figcaption, form, nav';
  const CANDIDATE_SELECTOR = 'p, li, blockquote, dd, figcaption, td, h1, h2, h3, h4, h5, h6, div';

  let sessionId = 0;      // 本次页面内的翻译会话号（取消/新任务时 +1 使旧循环失效）
  let currentRequestId = 0;

  /* ---------- 工具 ---------- */

  const normalize = s => (s || '').replace(/\s+/g, ' ').trim();

  function isVisible(el) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    if (cs.position === 'fixed') return false; // 悬浮层（导航 / 广告等），跳过避免破坏其定位
    const r = el.getBoundingClientRect();
    return r.width > 4 && r.height > 4;
  }

  /* ---------- 段落提取 ---------- */

  function extractParagraphs(targetLang) {
    const candidates = [];
    for (const el of document.querySelectorAll(CANDIDATE_SELECTOR)) {
      if (el.closest(SKIP_SELECTOR)) continue;      // 导航 / 代码 / 输入框 / 已有译文等
      if (!isVisible(el)) continue;
      // 提取文本时剔除上次插入的译文块（横向项译文嵌在元素内部，避免重复翻译叠罗汉）
      let raw = '';
      for (const node of el.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) raw += node.textContent;
        else if (node.nodeType === Node.ELEMENT_NODE && !node.classList.contains('vt-block')) raw += node.textContent;
      }
      const text = normalize(raw);
      if (text.length < 4 || text.length > 3000) continue;
      if (el.tagName === 'DIV') {                   // 大 div 仅当不含块级子元素时视为段落
        if (el.querySelector(INNER_BLOCK_SELECTOR)) continue;
        if (text.length < 30) continue;
      }
      if (el.tagName === 'LI' && el.querySelector(':scope > ul, :scope > ol, :scope > div, :scope > p')) continue;
      if (!/[A-Za-z一-鿿぀-ヿ가-힯]/.test(text)) continue; // 纯数字/符号
      if (isAlreadyTargetLang(text, targetLang)) continue; // 本来就是目标语言
      // 祖先中已有候选段落 → 跳过（避免父子重复翻译）
      let p = el.parentElement;
      let dup = false;
      while (p && p !== document.body) {
        if (p.hasAttribute('data-vt-cand')) { dup = true; break; }
        p = p.parentElement;
      }
      if (dup) continue;
      el.setAttribute('data-vt-cand', '1');
      candidates.push({ el, text });
    }
    return candidates;
  }

  /* 目标语言为中文时，跳过中文占比过高的段落（避免把中文翻译成中文） */
  function isAlreadyTargetLang(text, targetLang) {
    if (targetLang !== 'zh-CN' && targetLang !== 'zh-TW') return false;
    const cjk = (text.match(/[一-鿿]/g) || []).length;
    return cjk > text.length * 0.6;
  }

  /* ---------- 分批 ---------- */

  function chunkItems(items, maxChars) {
    const chunks = [];
    let cur = [], used = 0;
    for (const it of items) {
      if (cur.length && used + it.text.length > maxChars) {
        chunks.push(cur);
        cur = [];
        used = 0;
      }
      cur.push(it);
      used += it.text.length;
    }
    if (cur.length) chunks.push(cur);
    return chunks;
  }

  /* ---------- 译文块（布局感知嵌入） ----------
     placement 判定原文的空间分布，决定译文位置，保证不破坏原布局：
     - 'block'：块级段落 → 译文作为独立段落插入原文下方
     - 'item' ：横向项（flex/grid 项、float、inline-block、表格单元格）
                → 译文嵌入该项内部末尾，位于每个单词 / 项的下方，横排保持不变
     - 'flow' ：纯行内元素 → 译文以行内块跟在原文右侧 */

  function detectPlacement(el) {
    if (el.tagName === 'TD' || el.tagName === 'TH') return 'item';
    const parent = el.parentElement;
    if (parent) {
      const pd = getComputedStyle(parent).display;
      if (pd.startsWith('flex') || pd.startsWith('grid')) return 'item';
    }
    const cs = getComputedStyle(el);
    if (cs.float !== 'none') return 'item';
    if (cs.display === 'inline') return 'flow';
    if (cs.display.startsWith('inline')) return 'item'; // inline-block / inline-flex 横向项
    return 'block';
  }

  function upsertBlock(el, srcText, translation) {
    const placement = detectPlacement(el);
    const existing = placement === 'item'
      ? el.querySelector(':scope > .vt-block')
      : el.nextElementSibling;
    if (existing && existing.classList.contains('vt-block')) {
      if (existing.dataset.src !== srcText) {
        const t = existing.querySelector('.vt-text');
        if (t) {
          t.textContent = translation;
          existing.dataset.src = srcText;
        }
      }
      return;
    }
    const block = document.createElement('div');
    block.className = 'vt-block' + (placement === 'item' ? ' vt-item' : placement === 'flow' ? ' vt-flow' : '');
    block.dataset.src = srcText;
    const badge = document.createElement('span');
    badge.className = 'vt-badge';
    badge.textContent = '译';
    badge.title = '复制译文';
    badge.addEventListener('click', () => {
      navigator.clipboard.writeText(translation).then(() => {
        badge.textContent = '✓';
        setTimeout(() => { badge.textContent = '译'; }, 1200);
      }).catch(() => {});
    });
    const textDiv = document.createElement('div');
    textDiv.className = 'vt-text';
    textDiv.textContent = translation;
    block.append(badge, textDiv);
    if (placement === 'item') el.appendChild(block);          // 横向项 / 单元格：嵌到项内末尾
    else el.insertAdjacentElement('afterend', block);          // 段落 / 行内：紧随其后
  }

  /* ---------- 进度 / 提示 ---------- */

  let progressEl = null;
  let progressLabel = null;

  function showProgress(total) {
    hideProgress();
    progressEl = document.createElement('div');
    progressEl.className = 'vt-progress';
    progressLabel = document.createElement('span');
    const cancel = document.createElement('button');
    cancel.className = 'vt-cancel';
    cancel.textContent = '取消';
    cancel.addEventListener('click', () => {
      sessionId++;
      chrome.runtime.sendMessage({ type: 'abortTranslate', requestId: currentRequestId });
      hideProgress();
      toast('已取消翻译');
    });
    progressEl.append(progressLabel, cancel);
    document.documentElement.appendChild(progressEl);
    updateProgress(0, total);
  }

  function updateProgress(done, total) {
    if (progressLabel) progressLabel.textContent = '翻译中 ' + done + '/' + total;
  }

  function hideProgress() {
    if (progressEl) {
      progressEl.remove();
      progressEl = null;
      progressLabel = null;
    }
  }

  let toastTimer = null;
  function toast(msg) {
    let el = document.querySelector('.vt-toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'vt-toast';
      document.documentElement.appendChild(el);
    }
    el.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.remove(), 3500);
  }

  /* ---------- 主流程 ---------- */

  async function translatePage() {
    const stored = await chrome.storage.local.get('settings');
    const settings = mergeSettings(stored.settings);
    const id = ++sessionId;
    currentRequestId = id;

    const items = extractParagraphs(settings.targetLang);
    if (!items.length) {
      toast('未找到可翻译的文字段落');
      return;
    }

    const maxChars = Math.min(4000, Math.max(200, Number(settings.maxChars) || 1200));
    const chunks = chunkItems(items, maxChars);
    showProgress(chunks.length);

    let done = 0;
    for (let ci = 0; ci < chunks.length; ci++) {
      if (sessionId !== id) return; // 已取消或被新任务取代
      const chunk = chunks[ci];
      let resp = null;
      try {
        resp = await chrome.runtime.sendMessage({
          type: 'translateTexts',
          requestId: id,
          texts: chunk.map((it, i) => ({ id: i, text: it.text })),
        });
      } catch (e) {
        toast('翻译失败：' + ((e && e.message) || e));
        break;
      }
      if (sessionId !== id) return;
      if (!resp || !resp.ok) {
        toast('翻译失败：' + ((resp && resp.error) || '未知错误'));
        break;
      }
      (resp.results || []).forEach((r, i) => {
        const it = chunk[i];
        if (it && r && r.text) upsertBlock(it.el, it.text, r.text);
      });
      done += chunk.length;
      updateProgress(done, chunks.length);
    }

    hideProgress();
    const failed = items.length - done;
    if (failed > 0) toast('翻译完成：成功 ' + done + ' 段，失败 ' + failed + ' 段');
    else if (done > 0) toast('翻译完成，共 ' + done + ' 段');
  }

  function removeTranslations() {
    document.querySelectorAll('.vt-block').forEach(b => b.remove());
    document.querySelectorAll('[data-vt-cand]').forEach(el => el.removeAttribute('data-vt-cand'));
  }

  function toggleTranslations() {
    return document.documentElement.classList.toggle('vt-hidden');
  }

  /* ---------- 消息监听 ---------- */

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'ping':
        sendResponse({ ok: true });
        break;
      case 'translatePage':
        translatePage()
          .then(() => sendResponse({ ok: true }))
          .catch(e => sendResponse({ ok: false, error: String((e && e.message) || e) }));
        return true;
      case 'removeTranslations':
        removeTranslations();
        sendResponse({ ok: true });
        break;
      case 'toggleTranslations':
        sendResponse({ ok: true, hidden: toggleTranslations() });
        break;
      case 'getHidden':
        sendResponse({ ok: true, hidden: document.documentElement.classList.contains('vt-hidden') });
        break;
    }
  });
})();
