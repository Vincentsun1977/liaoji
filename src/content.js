(function () {
  'use strict';

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'SCAN_CHAT_HISTORY') {
      sendResponse({ ok: true, platform: detectPlatform(), conversations: scanChatHistory(message.platform) });
      return;
    }

    if (message?.type === 'SCAN_CHATGPT_HISTORY') {
      sendResponse({ ok: true, conversations: scanChatHistory('ChatGPT') });
      return;
    }

    if (message?.type === 'WAIT_FOR_CHAT_READY') {
      waitForChatReady(message)
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, ready: false, error: error?.message || 'Chat not ready.' }));
      return true;
    }

    if (message?.type === 'SHOW_OBSIDIAN_SAVE_DIALOG') {
      try {
        showObsidianSaveDialog(message);
        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({ ok: false, error: error?.message || 'Unable to show save dialog.' });
      }
      return;
    }

    if (message?.type !== 'EXTRACT_CHAT_HISTORY') return;

    try {
      sendResponse({ ok: true, chat: extractChat() });
    } catch (error) {
      sendResponse({ ok: false, error: error?.message || 'Extraction failed.' });
    }
  });

  function showObsidianSaveDialog(options = {}) {
    const uri = String(options.uri || '');
    if (!uri.startsWith('obsidian://')) throw new Error('Invalid Obsidian URI.');

    document.getElementById('chat-restore-note-save-dialog')?.remove();

    const root = document.createElement('div');
    root.id = 'chat-restore-note-save-dialog';
    const shadow = root.attachShadow({ mode: 'closed' });
    const platform = escapeHtml(options.platform || '笔记');
    const title = escapeHtml(options.title || '当前聊天');

    shadow.innerHTML = `
      <style>
        :host {
          all: initial;
          position: fixed;
          z-index: 2147483647;
          right: 22px;
          top: 22px;
          font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .panel {
          width: min(360px, calc(100vw - 44px));
          border: 1px solid rgba(232, 230, 237, 0.95);
          border-radius: 18px;
          padding: 16px;
          color: #28252d;
          background: #ffffff;
          box-shadow: 0 18px 48px rgba(40, 37, 45, 0.18);
        }
        .top {
          display: flex;
          align-items: start;
          justify-content: space-between;
          gap: 12px;
        }
        .eyebrow {
          margin: 0 0 6px;
          color: #e9458c;
          font-size: 11px;
          font-weight: 900;
          letter-spacing: 0;
          text-transform: uppercase;
        }
        h2 {
          margin: 0;
          color: #28252d;
          font-size: 18px;
          line-height: 1.25;
        }
        p {
          margin: 10px 0 0;
          color: #706b78;
          font-size: 13px;
          line-height: 1.5;
        }
        .title {
          overflow: hidden;
          margin-top: 10px;
          border-radius: 10px;
          padding: 10px;
          color: #28252d;
          background: #f6f6f8;
          font-size: 13px;
          font-weight: 750;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .actions {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 8px;
          margin-top: 14px;
        }
        button {
          min-height: 40px;
          border-radius: 10px;
          padding: 0 13px;
          font: inherit;
          font-weight: 850;
          cursor: pointer;
        }
        .primary {
          border: 0;
          color: #fff;
          background: #e9458c;
        }
        .secondary,
        .close {
          border: 1px solid #e8e6ed;
          color: #5d5965;
          background: #fff;
        }
        .close {
          min-width: 32px;
          min-height: 32px;
          padding: 0;
          border-radius: 999px;
          line-height: 1;
        }
      </style>
      <section class="panel" role="dialog" aria-label="保存到笔记">
        <div class="top">
          <div>
            <p class="eyebrow">${platform}</p>
            <h2>内容已复制，准备保存到笔记</h2>
          </div>
          <button class="close" type="button" aria-label="关闭">×</button>
        </div>
        <p>点击下方按钮打开 Obsidian。如果浏览器询问是否允许打开外部应用，请选择允许。</p>
        <div class="title">${title}</div>
        <div class="actions">
          <button class="primary" type="button">打开 Obsidian</button>
          <button class="secondary" type="button">稍后</button>
        </div>
      </section>
    `;

    shadow.querySelector('.primary').addEventListener('click', () => {
      window.location.href = uri;
      root.remove();
    });
    shadow.querySelector('.secondary').addEventListener('click', () => root.remove());
    shadow.querySelector('.close').addEventListener('click', () => root.remove());
    document.documentElement.appendChild(root);
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function scanChatHistory(platformOverride) {
    const platform = platformOverride || detectPlatform();
    if (platform === 'ChatGPT') return scanChatGptHistory();
    if (platform === 'Claude') return scanClaudeHistory();
    return [];
  }

  function scanChatGptHistory() {
    if (detectPlatform() !== 'ChatGPT') return [];

    const anchors = Array.from(document.querySelectorAll('a[href*="/c/"]'));
    const map = new Map();

    anchors.forEach((anchor) => {
      const href = anchor.href || '';
      const matched = href.match(/\/c\/([a-zA-Z0-9-]+)/);
      if (!matched) return;

      const title = cleanupHistoryTitle(anchor);
      if (!title || /^new chat$/i.test(title)) return;

      const url = new URL(`/c/${matched[1]}`, location.origin).toString();
      if (!map.has(url) || title.length > map.get(url).title.length) {
        map.set(url, {
          id: matched[1],
          title,
          dateLabel: inferHistoryDate(anchor),
          url,
          platform: 'ChatGPT',
        });
      }
    });

    return Array.from(map.values());
  }

  async function waitForChatReady(options = {}) {
    const timeoutMs = Number(options.timeoutMs || 25000);
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const chat = extractChat();
      if (isChatReady(chat)) {
        return { ok: true, ready: true, messageCount: chat.messages.length };
      }
      await delay(500);
    }

    const chat = extractChat();
    return {
      ok: false,
      ready: false,
      messageCount: chat.messages.length,
      error: `等待消息渲染超时，仅检测到 ${chat.messages.length} 条有效消息。`,
    };
  }

  function isChatReady(chat) {
    const messages = Array.isArray(chat.messages) ? chat.messages : [];
    const hasUser = messages.some((message) => message.role === 'user' && isRealChatMessage(message.content));
    const hasAssistant = messages.some((message) => message.role === 'assistant' && isRealChatMessage(message.content));
    return hasUser && hasAssistant;
  }

  function cleanupHistoryTitle(anchor) {
    const clone = anchor.cloneNode(true);
    clone.querySelectorAll('button, svg, [aria-hidden="true"]').forEach((node) => node.remove());
    return normalizeText(clone.innerText || clone.textContent || '')
      .replace(/\s*(More|Menu|更多)\s*$/i, '')
      .trim();
  }

  function inferHistoryDate(anchor) {
    const explicit = findExplicitDate(anchor);
    if (explicit) return explicit;

    let node = anchor.closest('li, [role="listitem"], div, section, article') || anchor;
    const seen = new Set();

    for (let depth = 0; node && depth < 5; depth += 1) {
      let sibling = node.previousElementSibling;
      for (let steps = 0; sibling && steps < 8; steps += 1) {
        const label = extractDateLabel(sibling);
        if (label) return label;
        sibling = sibling.previousElementSibling;
      }

      node = node.parentElement;
      if (!node || seen.has(node)) break;
      seen.add(node);
    }

    return '';
  }

  function findExplicitDate(anchor) {
    const time = anchor.querySelector('time[datetime], time');
    if (time) return normalizeText(time.getAttribute('datetime') || time.textContent || '');

    const aria = normalizeText(anchor.getAttribute('aria-label') || anchor.getAttribute('title') || '');
    return extractDateFromText(aria);
  }

  function extractDateLabel(element) {
    const clone = element.cloneNode(true);
    clone.querySelectorAll('a[href], button, svg, [aria-hidden="true"]').forEach((node) => node.remove());
    const text = normalizeText(clone.innerText || clone.textContent || '');
    return extractDateFromText(text);
  }

  function extractDateFromText(text) {
    const value = normalizeText(text);
    if (!value || value.length > 80) return '';

    const relative = value.match(/^(今天|昨天|前\s*7\s*天|前\s*30\s*天|更早|Today|Yesterday|Previous\s*7\s*days|Previous\s*30\s*days|Older)$/i);
    if (relative) return relative[0].replace(/\s+/g, ' ');

    const dateLike = value.match(/(\d{4}[年/-]\s*\d{1,2}([月/-]\s*\d{1,2}日?)?|\d{1,2}[月/-]\s*\d{1,2}日?|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(,\s*\d{4})?)/i);
    return dateLike ? dateLike[0].replace(/\s+/g, ' ') : '';
  }

  function scanClaudeHistory() {
    if (detectPlatform() !== 'Claude') return [];

    const anchors = Array.from(document.querySelectorAll('a[href*="/chat/"], a[href*="/project/"]'));
    const map = new Map();

    anchors.forEach((anchor) => {
      const href = anchor.href || '';
      const matched = href.match(/\/chat\/([a-zA-Z0-9-]+)/);
      if (!matched) return;

      const title = cleanupHistoryTitle(anchor);
      if (!title || /^new chat$/i.test(title)) return;

      const url = new URL(`/chat/${matched[1]}`, location.origin).toString();
      if (!map.has(url) || title.length > map.get(url).title.length) {
        map.set(url, {
          id: matched[1],
          title,
          dateLabel: inferHistoryDate(anchor),
          url,
          platform: 'Claude',
        });
      }
    });

    return Array.from(map.values());
  }

  function extractChat() {
    const platform = detectPlatform();
    const messages = extractPlatformMessages(platform);
    const fallback = messages.length ? messages : extractGenericMessages();
    const normalizedMessages = dedupeMessages(fallback).slice(0, 400);

    return {
      platform,
      title: detectTitle(platform, normalizedMessages),
      url: location.href,
      extractedAt: new Date().toISOString(),
      messages: normalizedMessages,
    };
  }

  function detectPlatform() {
    const host = location.hostname;
    if (/chatgpt\.com|chat\.openai\.com/.test(host)) return 'ChatGPT';
    if (/claude\.ai/.test(host)) return 'Claude';
    if (/gemini\.google\.com/.test(host)) return 'Gemini';
    if (/deepseek\.com/.test(host)) return 'DeepSeek';
    return 'AI Chat';
  }

  function detectTitle(platform, messages = []) {
    const heading = firstText([
      'main h1',
      'h1',
      '[data-testid="conversation-title"]',
      '[class*="conversation"] h1',
      '[class*="title"]',
    ]);
    const docTitle = normalizeText(document.title).replace(/\s*[-|]\s*(ChatGPT|Claude|Gemini|DeepSeek).*$/i, '');
    const firstUser = messages.find((message) => message.role === 'user')?.content || '';
    return meaningfulTitle(heading)
      || meaningfulTitle(docTitle)
      || meaningfulTitle(firstUser.slice(0, 48))
      || `${platform} Conversation`;
  }

  function extractPlatformMessages(platform) {
    if (platform === 'ChatGPT') return extractChatGptMessages();

    if (platform === 'Claude') return extractClaudeMessages();

    if (platform === 'Gemini') return extractBySelectors([
      { selector: 'user-query, [data-test-id="user-query"], .query-text', role: 'user' },
      { selector: 'model-response, [data-test-id="model-response"], .model-response-text', role: 'assistant' },
      { selector: '[class*="conversation-turn"]', roleFromText: true },
    ]);

    if (platform === 'DeepSeek') return extractBySelectors([
      { selector: '[class*="message"]', roleFromClass: true },
      { selector: '[data-role]', roleAttr: 'data-role' },
    ]);

    return [];
  }

  function extractChatGptMessages() {
    const roleNodes = Array.from(document.querySelectorAll('[data-message-author-role]'))
      .filter(isVisible);
    const items = [];
    const seenTurns = new Set();

    roleNodes.forEach((roleNode) => {
      const role = normalizeRole(roleNode.getAttribute('data-message-author-role'));
      const turn = roleNode.closest('[data-testid^="conversation-turn-"], article, [data-message-id]') || roleNode;
      if (seenTurns.has(turn)) return;
      seenTurns.add(turn);

      const content = extractChatGptMessageText(roleNode, turn, role);
      const images = extractImageLinks(turn);
      if (!isUsefulMessage(content) && !images.length) return;

      items.push({
        role,
        content,
        images,
        top: turn.getBoundingClientRect().top + window.scrollY,
      });
    });

    if (items.length) {
      return compactMessageItems(items);
    }

    return extractBySelectors([
      { selector: '[data-testid^="conversation-turn-"] [data-message-author-role]', roleAttr: 'data-message-author-role' },
      { selector: '[data-testid^="conversation-turn-"]', roleFromText: true },
    ]);
  }

  function extractChatGptMessageText(roleNode, turn, role) {
    const bodyRoot = roleNode.querySelector('[data-message-id], .markdown, .prose, [class*="markdown"], [class*="prose"]')
      || turn.querySelector('[data-message-id], .markdown, .prose, [class*="markdown"], [class*="prose"]')
      || roleNode;
    const bodyText = cleanupMessageText(bodyRoot);
    const roleText = cleanupMessageText(roleNode);
    const turnText = cleanupMessageText(turn);

    const candidates = [bodyText, roleText, stripChatGptChromeText(turnText, role)]
      .map((text) => cleanupChatGptText(text, role))
      .filter(isUsefulMessage)
      .sort((left, right) => right.length - left.length);

    return candidates[0] || '';
  }

  function stripChatGptChromeText(text, role) {
    let value = normalizeText(text);
    value = value.replace(/^(You said|ChatGPT said)\s*:\s*/i, '');
    value = value.replace(/\n?(Copy|Edit|Share|Regenerate|Like|Dislike|复制|编辑|分享|重新生成)\s*$/gi, '');

    if (role === 'assistant') {
      value = value.replace(/^ChatGPT said\s*:\s*/i, '');
    }
    if (role === 'user') {
      value = value.replace(/^You said\s*:\s*/i, '');
    }

    return value.trim();
  }

  function cleanupChatGptText(text, role) {
    let value = normalizeText(text);
    if (role === 'assistant') {
      value = value.replace(/^ChatGPT said\s*:\s*/i, '');
    }
    if (role === 'user') {
      value = value.replace(/^You said\s*:\s*/i, '');
    }
    return value.trim();
  }

  function extractClaudeMessages() {
    const userItems = collectMessageItems([
      { selector: '[data-testid="user-message"]', role: 'user' },
      { selector: '[data-testid*="user"][data-testid*="message"]', role: 'user' },
    ]);
    const assistantItems = collectMessageItems([
      { selector: '[data-testid="assistant-message"]', role: 'assistant' },
      { selector: '[data-testid*="assistant"][data-testid*="message"]', role: 'assistant' },
      { selector: '[class*="font-claude-message"]', role: 'assistant' },
      { selector: '[class*="claude-message"]', role: 'assistant' },
      { selector: '[class*="markdown"]', role: 'assistant' },
      { selector: '[class*="prose"]', role: 'assistant' },
    ]);

    const messages = compactMessageItems([...userItems, ...assistantItems]);
    const hasAssistant = messages.some((message) => message.role === 'assistant');
    if (hasAssistant) return messages;

    return extractClaudeByUserIntervals(userItems);
  }

  function collectMessageItems(configs) {
    const items = [];
    const seenNodes = new Set();

    configs.forEach((config) => {
      document.querySelectorAll(config.selector).forEach((node) => {
        if (seenNodes.has(node) || !isVisible(node)) return;
        seenNodes.add(node);

        const content = cleanupMessageText(node);
        const images = extractImageLinks(node);
        if (!isUsefulMessage(content) && !images.length) return;

        items.push({
          role: config.role,
          content,
          images,
          top: node.getBoundingClientRect().top + window.scrollY,
          node,
        });
      });
    });

    return items;
  }

  function compactMessageItems(items) {
    const sorted = items
      .filter((item) => isUsefulMessage(item.content))
      .sort((left, right) => left.top - right.top || right.content.length - left.content.length);
    const compact = [];

    sorted.forEach((item) => {
      const existingIndex = compact.findIndex((existing) => (
        existing.role === item.role
        && Math.abs(existing.top - item.top) < 12
      ));
      if (existingIndex >= 0) {
        if (item.content.length > compact[existingIndex].content.length) {
          compact[existingIndex] = item;
        }
        return;
      }

      const containedIndex = compact.findIndex((existing) => (
        existing.role === item.role
        && (existing.content.includes(item.content) || item.content.includes(existing.content))
      ));
      if (containedIndex >= 0) {
        if (item.content.length > compact[containedIndex].content.length) {
          compact[containedIndex] = item;
        }
        return;
      }

      compact.push({
        role: item.role,
        content: item.content,
        images: item.images || [],
        top: item.top,
      });
    });

    return compact.sort((left, right) => left.top - right.top).map(({ role, content, images }) => ({ role, content, images }));
  }

  function extractClaudeByUserIntervals(userItems) {
    const users = userItems
      .filter((item) => item.role === 'user')
      .sort((left, right) => left.top - right.top);
    if (!users.length) return [];

    const messages = [];
    users.forEach((user, index) => {
      messages.push({
        role: 'user',
        content: user.content,
        images: user.images || [],
      });

      const nextUser = users[index + 1];
      const start = user.top;
      const end = nextUser ? nextUser.top : Number.POSITIVE_INFINITY;
      const assistant = extractTextBetween(start, end, users.map((item) => item.content));
      if (assistant) {
        messages.push({
          role: 'assistant',
          content: assistant,
          images: [],
        });
      }
    });

    return messages;
  }

  function extractTextBetween(startY, endY, excludedTexts) {
    const blocks = Array.from(document.querySelectorAll('main p, main li, main pre, main code, main h1, main h2, main h3, main h4, main blockquote'))
      .filter(isVisible)
      .map((node) => ({
        top: node.getBoundingClientRect().top + window.scrollY,
        text: cleanupMessageText(node),
      }))
      .filter((item) => item.top > startY && item.top < endY)
      .filter((item) => isUsefulMessage(item.text))
      .filter((item) => !excludedTexts.some((text) => text.includes(item.text) || item.text.includes(text)));

    return mergeTextBlocks(blocks);
  }

  function mergeTextBlocks(blocks) {
    const seen = new Set();
    const lines = [];

    blocks
      .sort((left, right) => left.top - right.top)
      .forEach((block) => {
        const text = block.text;
        const key = text.slice(0, 300);
        if (seen.has(key)) return;
        if (lines.some((line) => line.includes(text) || text.includes(line))) return;
        seen.add(key);
        lines.push(text);
      });

    return lines.join('\n\n').trim();
  }

  function extractBySelectors(configs) {
    const collected = [];
    const seenNodes = new Set();

    configs.forEach((config) => {
      document.querySelectorAll(config.selector).forEach((node) => {
        if (seenNodes.has(node) || !isVisible(node)) return;
        seenNodes.add(node);

        const content = cleanupMessageText(node);
        const images = extractImageLinks(node);
        if (!isUsefulMessage(content) && !images.length) return;

        collected.push({
          role: resolveRole(node, config, content),
          content,
          images,
          top: node.getBoundingClientRect().top + window.scrollY,
        });
      });
    });

    return collected.sort((left, right) => left.top - right.top).map(({ role, content, images }) => ({ role, content, images }));
  }

  function extractGenericMessages() {
    const candidates = Array.from(document.querySelectorAll('main article, main [role="article"], main [data-testid], main div'))
      .filter(isVisible)
      .map((node) => ({
        node,
        text: cleanupMessageText(node),
      }))
      .filter((item) => isUsefulMessage(item.text))
      .filter((item) => item.text.length < 12000);

    const compact = [];
    candidates.forEach((item) => {
      const last = compact[compact.length - 1];
      if (last && last.text.includes(item.text)) return;
      if (compact.some((existing) => item.text.includes(existing.text) && existing.text.length > 80)) return;
      compact.push(item);
    });

    return compact.slice(-80).map((item, index) => ({
      role: inferRoleFromText(item.text, index),
      content: item.text,
      images: extractImageLinks(item.node),
    }));
  }

  function resolveRole(node, config, content) {
    if (config.role) return config.role;
    if (config.roleAttr) return normalizeRole(node.getAttribute(config.roleAttr));
    if (config.roleFromClass) return inferRoleFromClass(node);
    if (config.roleFromText) return inferRoleFromText(content);
    return 'message';
  }

  function inferRoleFromClass(node) {
    const className = String(node.className || '').toLowerCase();
    if (/user|human|mine|question|query/.test(className)) return 'user';
    if (/assistant|bot|ai|answer|response|model/.test(className)) return 'assistant';
    return inferRoleFromText(cleanupMessageText(node));
  }

  function inferRoleFromText(text, index = 0) {
    const head = normalizeText(text).slice(0, 80).toLowerCase();
    if (/^(you|user|human|me|我|用户)[:：]/.test(head)) return 'user';
    if (/^(assistant|chatgpt|claude|gemini|deepseek|ai|助手)[:：]/.test(head)) return 'assistant';
    return index % 2 === 0 ? 'user' : 'assistant';
  }

  function normalizeRole(value) {
    const role = String(value || '').toLowerCase();
    if (/user|human|me/.test(role)) return 'user';
    if (/assistant|model|bot|ai/.test(role)) return 'assistant';
    if (/system/.test(role)) return 'system';
    return role || 'message';
  }

  function cleanupMessageText(node) {
    const clone = node.cloneNode(true);
    clone.querySelectorAll('button, svg, style, script, noscript, [aria-hidden="true"], [role="button"]').forEach((item) => item.remove());
    return normalizeText(clone.innerText || clone.textContent || '')
      .replace(/^(You|User|Human|Assistant|ChatGPT|Claude|Gemini|DeepSeek|AI|我|用户|助手)\s*[:：]\s*/i, '')
      .trim();
  }

  function dedupeMessages(messages) {
    const result = [];
    const seen = new Set();

    messages.forEach((message) => {
      const content = normalizeText(message.content);
      const key = `${message.role}:${content.slice(0, 400)}`;
      if (!content || seen.has(key)) return;
      seen.add(key);
      result.push({
        role: normalizeRole(message.role),
        content,
        images: dedupeImages(message.images || []),
      });
    });

    return result;
  }

  function extractImageLinks(root) {
    const links = [];
    const seen = new Set();

    root.querySelectorAll('img').forEach((img) => {
      const src = resolveImageUrl(
        img.currentSrc
        || img.src
        || img.getAttribute('src')
        || img.getAttribute('data-src')
        || img.getAttribute('data-original')
      );
      if (!isUsefulImageUrl(src) || seen.has(src)) return;
      seen.add(src);
      links.push({
        url: src,
        alt: normalizeText(img.alt || img.getAttribute('aria-label') || '聊天图片'),
      });
    });

    root.querySelectorAll('a[href]').forEach((anchor) => {
      const href = resolveImageUrl(anchor.href || anchor.getAttribute('href'));
      if (!isUsefulImageUrl(href) || seen.has(href)) return;
      seen.add(href);
      links.push({
        url: href,
        alt: normalizeText(anchor.textContent || '聊天图片'),
      });
    });

    return links.slice(0, 12);
  }

  function resolveImageUrl(value) {
    const raw = String(value || '').trim();
    if (!raw || raw.startsWith('data:') || raw.startsWith('blob:')) return '';
    try {
      return new URL(raw, location.href).toString();
    } catch (_error) {
      return '';
    }
  }

  function isUsefulImageUrl(url) {
    if (!url) return false;
    if (/\/(favicon|apple-touch-icon|manifest|logo)([./_-]|$)/i.test(url)) return false;
    if (/\.(svg)(\?|#|$)/i.test(url)) return false;
    if (/\.(png|jpe?g|webp|gif|avif)(\?|#|$)/i.test(url)) return true;
    return /(image|file|attachment|oaiusercontent|oaidalleapiprodscus|cdn\.openai|chatgpt|claude|googleusercontent|gemini)/i.test(url);
  }

  function dedupeImages(images) {
    const seen = new Set();
    return (Array.isArray(images) ? images : [])
      .map((image) => ({
        url: resolveImageUrl(image?.url || image),
        alt: normalizeText(image?.alt || '聊天图片'),
      }))
      .filter((image) => {
        if (!isUsefulImageUrl(image.url) || seen.has(image.url)) return false;
        seen.add(image.url);
        return true;
      });
  }

  function firstText(selectors) {
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      const text = normalizeText(node?.textContent || '');
      if (text) return text;
    }
    return '';
  }

  function meaningfulTitle(value) {
    const text = normalizeText(value).replace(/^#+\s*/, '').trim();
    if (text.length < 3) return '';
    if (!/[\p{L}\p{N}]/u.test(text)) return '';
    if (/^(chatgpt|claude|gemini|deepseek|new chat|新聊天)$/i.test(text)) return '';
    return text;
  }

  function isUsefulMessage(text) {
    const value = normalizeText(text);
    if (value.length < 2) return false;
    if (value.length > 120000) return false;
    if (!isRealChatMessage(value)) return false;
    if (/^(copy|edit|share|regenerate|like|dislike|复制|编辑|分享|重新生成)$/i.test(value)) return false;
    return true;
  }

  function isRealChatMessage(text) {
    const value = normalizeText(text);
    if (/^ChatGPT can make mistakes\.? Check important info\.?$/i.test(value)) return false;
    if (/^ChatGPT 也可能会犯错/i.test(value)) return false;
    return true;
  }

  function isVisible(node) {
    const rect = node.getBoundingClientRect();
    const style = window.getComputedStyle(node);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  }

  function normalizeText(value) {
    return String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
})();
