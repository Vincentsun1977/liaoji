(function () {
  'use strict';

  const scanButton = document.getElementById('scan-button');
  const platformTitle = document.getElementById('platform-title');
  const chooseDirButton = document.getElementById('choose-dir-button');
  const exportButton = document.getElementById('export-button');
  const searchInput = document.getElementById('search-input');
  const selectAllInput = document.getElementById('select-all-input');
  const selectAllButton = document.getElementById('select-all-button');
  const selectNoneButton = document.getElementById('select-none-button');
  const overwriteInput = document.getElementById('overwrite-input');
  const settingsButton = document.getElementById('settings-button');
  const planBadge = document.getElementById('plan-badge');
  const statusPill = document.getElementById('status-pill');
  const platformLogo = document.getElementById('platform-logo');
  const brandIcon = document.querySelector('.brand-icon');
  const totalCount = document.getElementById('total-count');
  const selectedCount = document.getElementById('selected-count');
  const doneCount = document.getElementById('done-count');
  const directoryLabel = document.getElementById('directory-label');
  const conversationList = document.getElementById('conversation-list');
  const logList = document.getElementById('log-list');
  const clearLogButton = document.getElementById('clear-log-button');
  const membershipOverlay = document.getElementById('membership-overlay');
  const membershipKicker = document.getElementById('membership-kicker');
  const membershipTitle = document.getElementById('membership-title');
  const membershipMessage = document.getElementById('membership-message');
  const membershipLoginButton = document.getElementById('membership-login-button');
  const membershipUpgradeButton = document.getElementById('membership-upgrade-button');
  const membershipBackButton = document.getElementById('membership-back-button');

  let conversations = [];
  let selectedUrls = new Set();
  let directoryHandle = null;
  let exporting = false;
  let completed = 0;
  const params = new URLSearchParams(location.search);
  let activePlatform = normalizePlatform(params.get('platform') || 'ChatGPT');

  scanButton.addEventListener('click', scanHistory);
  chooseDirButton.addEventListener('click', chooseDirectory);
  exportButton.addEventListener('click', exportSelected);
  searchInput.addEventListener('input', renderList);
  selectAllInput.addEventListener('change', toggleSelectVisible);
  selectAllButton.addEventListener('click', selectAllConversations);
  selectNoneButton.addEventListener('click', selectNoConversations);
  settingsButton.addEventListener('click', () => {
    if (hasChromeOptions()) chrome.runtime.openOptionsPage();
  });
  clearLogButton.addEventListener('click', () => {
    logList.innerHTML = '';
  });
  membershipLoginButton.addEventListener('click', handleMembershipAction);
  membershipUpgradeButton.addEventListener('click', handleMembershipAction);
  membershipBackButton.addEventListener('click', () => {
    if (hasChromeRuntime()) chrome.tabs.getCurrent((tab) => tab?.id && chrome.tabs.remove(tab.id));
  });

  init();

  async function init() {
    await loadDefaultDirectoryLabel();
    updateCounts();
    platformTitle.textContent = activePlatform;
    updatePlatformIcon();
    await updatePlanBadge();
    await enforceMembershipGate();
  }

  async function loadDefaultDirectoryLabel() {
    if (!hasChromeStorage()) return;
    const saved = await chrome.storage.sync.get({
      obsidianVault: '',
      obsidianFolder: '',
    });
    const target = [saved.obsidianVault, saved.obsidianFolder].filter(Boolean).join('/');
    if (target) directoryLabel.textContent = target;
  }

  async function scanHistory() {
    if (!(await hasProAccess())) {
      await showMembershipOverlay();
      return;
    }
    setStatus('扫描中');
    try {
      const tab = await findPlatformTab(activePlatform);
      if (!tab) throw new Error(`请先打开 ${activePlatform} 页面。`);
      const response = await sendMessageToTab(tab.id, { type: 'SCAN_CHAT_HISTORY', platform: activePlatform });
      if (!response?.ok) throw new Error(response?.error || '扫描失败。');

      activePlatform = normalizePlatform(response.platform || activePlatform);
      platformTitle.textContent = activePlatform;
      updatePlatformIcon();
      conversations = response.conversations || [];
      selectedUrls = new Set(conversations.map((item) => item.url));
      renderList();
      setStatus(`已扫描 ${conversations.length}`);
      log(`扫描到 ${conversations.length} 个已加载 ${activePlatform} 会话。`);
    } catch (error) {
      setStatus('扫描失败');
      log(error?.message || '扫描失败。', true);
    }
  }

  async function chooseDirectory() {
    if (!(await hasProAccess())) {
      await showMembershipOverlay();
      return false;
    }

    if (!window.showDirectoryPicker) {
      log('当前 Chrome 不支持直接写入目录，请升级浏览器。', true);
      return false;
    }

    try {
      directoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      directoryLabel.textContent = directoryHandle.name;
      directoryLabel.closest('.output-ready')?.classList.add('is-ready');
      updateCounts();
      log(`导出目录：${directoryHandle.name}`);
      return true;
    } catch (error) {
      if (error?.name !== 'AbortError') {
        log(error?.message || '选择目录失败。', true);
      }
      return false;
    }
  }

  async function exportSelected() {
    if (!(await hasProAccess())) {
      await showMembershipOverlay();
      return;
    }
    if (exporting) return;
    const selected = conversations.filter((item) => selectedUrls.has(item.url));
    if (!selected.length) {
      log('请至少选择一个会话。', true);
      return;
    }

    if (!directoryHandle) {
      log('请选择导出目录。');
      const picked = await chooseDirectory();
      if (!picked) return;
    }

    exporting = true;
    completed = 0;
    updateCounts();
    setStatus('导出中');
    setControlsDisabled(true);

    for (const item of selected) {
      await exportOne(item);
      completed += 1;
      updateCounts();
    }

    exporting = false;
    setControlsDisabled(false);
    setStatus('已完成');
    log(`完成：${completed}/${selected.length}`);
  }

  async function exportOne(item) {
    let tab = null;
    let previousTab = null;
    try {
      log(`打开：${item.title}`);
      [previousTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      tab = await chrome.tabs.create({ url: item.url, active: true });
      await waitForTabComplete(tab.id);
      log(`等待渲染：${item.title}`);
      const ready = await sendMessageToTab(tab.id, { type: 'WAIT_FOR_CHAT_READY', timeoutMs: 30000 });
      if (!ready?.ready) throw new Error(ready?.error || '对话正文未渲染完成。');

      const response = await sendMessageToTab(tab.id, { type: 'EXTRACT_CHAT_HISTORY' });
      if (!response?.ok) throw new Error(response?.error || '提取失败。');
      if (!hasUsefulConversation(response.chat)) throw new Error('提取结果缺少真实用户/助手消息。');

      const chat = {
        ...response.chat,
        title: response.chat?.title || item.title,
        url: item.url,
      };
      const markdown = window.ChatRestoreMarkdown.buildMarkdown(chat);
      const filename = window.ChatRestoreMarkdown.buildFilename(chat);
      await writeMarkdownFile(filename, markdown);
      setItemState(item.url, '完成');
      log(`写入：${filename}`);
    } catch (error) {
      setItemState(item.url, '失败');
      log(`${item.title}: ${error?.message || '导出失败。'}`, true);
    } finally {
      if (tab?.id) {
        chrome.tabs.remove(tab.id).catch(() => {});
      }
      if (previousTab?.id) {
        chrome.tabs.update(previousTab.id, { active: true }).catch(() => {});
      }
    }
  }

  async function writeMarkdownFile(filename, markdown) {
    const safeName = sanitizeFilename(filename);
    const exists = await fileExists(safeName);
    if (exists && !overwriteInput.checked) {
      log(`跳过已存在：${safeName}`);
      return;
    }

    const fileHandle = await directoryHandle.getFileHandle(safeName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(markdown);
    await writable.close();
  }

  async function fileExists(filename) {
    try {
      await directoryHandle.getFileHandle(filename, { create: false });
      return true;
    } catch (_error) {
      return false;
    }
  }

  async function findPlatformTab(platform) {
    const matcher = platformMatcher(platform);
    const tabs = await chrome.tabs.query({ currentWindow: true });
    return tabs.find((tab) => matcher.test(tab.url || ''))
      || (await chrome.tabs.query({})).find((tab) => matcher.test(tab.url || ''));
  }

  function platformMatcher(platform) {
    if (platform === 'Claude') return /https:\/\/claude\.ai\//;
    return /https:\/\/(chatgpt\.com|chat\.openai\.com)\//;
  }

  function normalizePlatform(platform) {
    return String(platform || '').toLowerCase() === 'claude' ? 'Claude' : 'ChatGPT';
  }

  async function sendMessageToTab(tabId, message) {
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (_error) {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['src/content.js'],
      });
      return chrome.tabs.sendMessage(tabId, message);
    }
  }

  function waitForTabComplete(tabId) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error('页面加载超时。'));
      }, 30000);

      const listener = (updatedTabId, changeInfo) => {
        if (updatedTabId !== tabId || changeInfo.status !== 'complete') return;
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      };

      chrome.tabs.onUpdated.addListener(listener);
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError) return;
        if (tab?.status === 'complete') {
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      });
    });
  }

  function hasUsefulConversation(chat) {
    const messages = Array.isArray(chat?.messages) ? chat.messages : [];
    const hasUser = messages.some((message) => message.role === 'user' && isRealMessage(message.content));
    const hasAssistant = messages.some((message) => message.role === 'assistant' && isRealMessage(message.content));
    return hasUser && hasAssistant;
  }

  function isRealMessage(content) {
    const text = String(content || '').trim();
    if (!text) return false;
    if (/^ChatGPT can make mistakes\.? Check important info\.?$/i.test(text)) return false;
    return true;
  }

  function renderList() {
    const visible = getVisibleConversations();
    totalCount.textContent = String(conversations.length);

    if (!visible.length) {
      conversationList.innerHTML = '<div class="empty-state">没有匹配的会话。先扫描，或调整搜索词。</div>';
      updateCounts();
      return;
    }

    conversationList.innerHTML = visible.map((item) => `
      <label class="conversation-item" data-url="${escapeHtml(item.url)}">
        <input type="checkbox" ${selectedUrls.has(item.url) ? 'checked' : ''}>
        <span>
          <span class="conversation-title">${escapeHtml(item.title)}</span>
          <span class="conversation-url">${escapeHtml(item.url)}</span>
        </span>
        <span class="conversation-date">${escapeHtml(item.dateLabel || '-')}</span>
        <span class="item-state" data-state="${escapeHtml(normalizeState(item.state))}" title="${escapeHtml(item.state || '待导出')}">${escapeHtml(item.state || '待导出')}</span>
      </label>
    `).join('');

    conversationList.querySelectorAll('.conversation-item').forEach((row) => {
      const checkbox = row.querySelector('input');
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) selectedUrls.add(row.dataset.url);
        else selectedUrls.delete(row.dataset.url);
        updateCounts();
      });
    });

    selectAllInput.checked = visible.every((item) => selectedUrls.has(item.url));
    updateCounts();
  }

  function toggleSelectVisible() {
    getVisibleConversations().forEach((item) => {
      if (selectAllInput.checked) selectedUrls.add(item.url);
      else selectedUrls.delete(item.url);
    });
    renderList();
  }

  function selectAllConversations() {
    conversations.forEach((item) => selectedUrls.add(item.url));
    renderList();
  }

  function selectNoConversations() {
    selectedUrls = new Set();
    renderList();
  }

  function getVisibleConversations() {
    const query = searchInput.value.trim().toLowerCase();
    if (!query) return conversations;
    return conversations.filter((item) => item.title.toLowerCase().includes(query));
  }

  function setItemState(url, state) {
    conversations = conversations.map((item) => item.url === url ? { ...item, state } : item);
    const row = conversationList.querySelector(`.conversation-item[data-url="${cssEscape(url)}"] .item-state`);
    if (row) {
      row.textContent = state;
      row.dataset.state = normalizeState(state);
      row.title = state;
    }
  }

  function setControlsDisabled(disabled) {
    scanButton.disabled = disabled;
    chooseDirButton.disabled = disabled;
    selectAllButton.disabled = disabled;
    selectNoneButton.disabled = disabled;
    exportButton.disabled = disabled || selectedUrls.size === 0;
  }

  function updateCounts() {
    selectedCount.textContent = String(selectedUrls.size);
    doneCount.textContent = String(completed);
    totalCount.textContent = String(conversations.length);
    exportButton.disabled = exporting || selectedUrls.size === 0;
    exportButton.textContent = selectedUrls.size ? `导出 (${selectedUrls.size})` : '导出';
  }

  function setStatus(text) {
    statusPill.textContent = text;
  }

  function updatePlatformIcon() {
    document.body.dataset.platform = activePlatform.toLowerCase();
    const logo = getPlatformLogo(activePlatform);
    if (!platformLogo || !brandIcon) return;

    if (logo) {
      platformLogo.src = logo;
      platformLogo.alt = `${activePlatform} logo`;
      brandIcon.classList.add('has-logo');
      return;
    }

    platformLogo.removeAttribute('src');
    platformLogo.alt = '';
    brandIcon.classList.remove('has-logo');
  }

  function getPlatformLogo(platform) {
    const key = String(platform || '').toLowerCase();
    const logos = {
      chatgpt: 'AI_logos/chatgpt_openai.svg',
      claude: 'AI_logos/anthropic.svg',
      gemini: 'AI_logos/gemini.svg',
      deepseek: 'AI_logos/deepseek.svg',
      qwen: 'AI_logos/qwen.svg',
      kimi: 'AI_logos/kimi.svg',
      minimax: 'AI_logos/minimax.svg',
      zhipu: 'AI_logos/zhipu.svg',
    };
    return logos[key] || '';
  }

  function normalizeState(state) {
    if (state === '完成') return 'done';
    if (state === '失败') return 'error';
    return 'pending';
  }

  function log(message, isError = false) {
    const line = document.createElement('div');
    line.className = `log-line ${isError ? 'error' : ''}`.trim();
    line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    logList.prepend(line);
  }

  function sanitizeFilename(value) {
    return String(value || 'chat.md')
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 160);
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function cssEscape(value) {
    return window.CSS?.escape ? CSS.escape(value) : String(value).replace(/"/g, '\\"');
  }

  async function enforceMembershipGate() {
    if (await hasProAccess()) return;
    await showMembershipOverlay();
  }

  async function hasProAccess() {
    if (!hasChromeStorage() || !window.ChatRestoreCloud) return false;
    return window.ChatRestoreCloud.hasProAccess();
  }

  async function showMembershipOverlay() {
    const membership = window.ChatRestoreCloud
      ? await window.ChatRestoreCloud.getMembership()
      : { authenticated: false, pro: false };

    if (membership.authenticated && !membership.pro) {
      membershipKicker.textContent = 'ACCOUNT READY';
      membershipTitle.textContent = '已登录，尚未开通 Pro';
      membershipMessage.textContent = 'Supabase 登录已经成功，但批量导出需要 Pro 会员。请开通 Pro，或在 Supabase memberships 表中为当前用户设置试用会员。';
      membershipLoginButton.textContent = '重新登录';
      membershipUpgradeButton.textContent = '开通 Pro';
    } else {
      membershipKicker.textContent = 'PRO BATCH EXPORT';
      membershipTitle.textContent = '批量导出需要 Pro';
      membershipMessage.textContent = '当前页单次导出可以免费使用。批量扫描历史对话、批量写入笔记和 AI 总结会作为会员功能开放。';
      membershipLoginButton.textContent = '登录 / 注册';
      membershipUpgradeButton.textContent = '开通会员';
    }

    membershipOverlay.hidden = false;
    setControlsDisabled(true);
    setStatus('需要会员');
  }

  async function handleMembershipAction() {
    const isUpgrade = document.activeElement === membershipUpgradeButton;
    const action = isUpgrade
      ? window.ChatRestoreCloud.openCheckout
      : window.ChatRestoreCloud.openLogin;
    try {
      await action();
      await updatePlanBadge();
      log(isUpgrade ? '已打开付款页面。' : '登录成功。');
      if (await hasProAccess()) membershipOverlay.hidden = true;
    } catch (error) {
      log(error?.message || '会员操作失败。', true);
    }
  }

  function hasChromeStorage() {
    return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local && chrome.storage?.sync);
  }

  function hasChromeRuntime() {
    return typeof chrome !== 'undefined' && Boolean(chrome.tabs?.getCurrent);
  }

  function hasChromeOptions() {
    return typeof chrome !== 'undefined' && Boolean(chrome.runtime?.openOptionsPage);
  }

  async function updatePlanBadge() {
    if (!planBadge || !window.ChatRestoreCloud || !hasChromeStorage()) return;
    const membership = await window.ChatRestoreCloud.getMembership();
    const isPro = Boolean(membership.pro);
    planBadge.textContent = isPro ? '' : 'Free';
    planBadge.className = `plan-badge ${isPro ? 'is-pro' : 'is-free'}`;
    planBadge.title = isPro ? 'Pro 会员' : 'Free 账号';
  }
})();
