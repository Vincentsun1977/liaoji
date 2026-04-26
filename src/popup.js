(function () {
  'use strict';

  const defaults = window.ChatRestoreSettings;
  const bulkButton = document.getElementById('bulk-button');
  const obsidianButton = document.getElementById('obsidian-button');
  const settingsButton = document.getElementById('settings-button');
  const markdownPreview = document.getElementById('markdown-preview');
  const platformPill = document.getElementById('platform-pill');
  const chatTitle = document.getElementById('chat-title');
  const messageCount = document.getElementById('message-count');
  const wordCount = document.getElementById('word-count');
  const statusText = document.getElementById('status-text');
  const aiSummaryInput = document.getElementById('ai-summary-input');
  const planBadge = document.getElementById('plan-badge');
  const membershipModal = document.getElementById('membership-modal');
  const membershipTitle = document.getElementById('membership-title');
  const membershipMessage = document.getElementById('membership-message');
  const membershipCloseButton = document.getElementById('membership-close-button');
  const membershipLoginButton = document.getElementById('membership-login-button');
  const membershipUpgradeButton = document.getElementById('membership-upgrade-button');

  let currentChat = null;
  let rawMarkdown = '';
  let currentMarkdown = '';
  let optimizedMarkdown = '';
  let optimizedSignature = '';
  let currentPlatform = '';
  let exportBusy = false;
  let currentSettings = null;
  let aiPreviewTimer = 0;
  let aiPreviewRunId = 0;

  bulkButton.addEventListener('click', openBulkExport);
  obsidianButton.addEventListener('click', saveToObsidian);
  settingsButton.addEventListener('click', openSettings);
  aiSummaryInput.addEventListener('change', handleAiSummaryToggle);
  membershipCloseButton.addEventListener('click', hideMembershipModal);
  membershipLoginButton.addEventListener('click', handleMembershipAction);
  membershipUpgradeButton.addEventListener('click', handleMembershipAction);

  init();

  async function init() {
    currentSettings = await loadSettings();
    aiSummaryInput.checked = false;
    currentSettings.ai.enabled = false;
    await chrome.storage.sync.set({ aiSummaryEnabled: false });
    updatePlanBadge();
    await extractCurrentChat();
  }

  async function extractCurrentChat() {
    setStatus('正在提取');
    setBusy(true);

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error('No active tab found.');

      const response = await sendExtractMessage(tab.id);
      if (!response?.ok) throw new Error(response?.error || '当前页面无法提取聊天记录。');

      currentChat = response.chat;
      rawMarkdown = window.ChatRestoreMarkdown.buildMarkdown(currentChat);
      currentMarkdown = rawMarkdown;
      optimizedMarkdown = '';
      optimizedSignature = '';
      renderChat(currentChat, currentMarkdown);

      if (currentChat.messages.length && aiSummaryInput.checked) {
        scheduleAiPreview(0);
      } else {
        setStatus(currentChat.messages.length ? '已生成' : '未找到消息');
      }
    } catch (error) {
      setStatus(error?.message || '提取失败', true);
      markdownPreview.value = '';
      currentChat = null;
      rawMarkdown = '';
      currentMarkdown = '';
      optimizedMarkdown = '';
      optimizedSignature = '';
      clearAiPreviewTimer();
      updateActions();
    } finally {
      setBusy(false);
    }
  }

  async function sendExtractMessage(tabId) {
    try {
      return await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_CHAT_HISTORY' });
    } catch (_error) {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['src/content.js'],
      });
      return chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_CHAT_HISTORY' });
    }
  }

  async function sendPageMessage(tabId, message) {
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

  async function showObsidianSavePrompt(uri, chat) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return false;

    try {
      const response = await sendPageMessage(tab.id, {
        type: 'SHOW_OBSIDIAN_SAVE_DIALOG',
        uri,
        title: chat?.title || '当前聊天',
        platform: chat?.platform || '',
      });

      return Boolean(response?.ok);
    } catch (_error) {
      return false;
    }
  }

  async function openBulkExport() {
    if (!(await hasProAccess())) {
      await showMembershipModal(
        '开通会员订阅',
        '一杯奶茶的价格，让灵感有处安放，让知识持续生长'
      );
      return;
    }
    const platform = currentPlatform || platformPill.textContent || '';
    const url = chrome.runtime.getURL(`bulk.html${platform ? `?platform=${encodeURIComponent(platform)}` : ''}`);
    chrome.tabs.create({ url });
  }

  function openSettings() {
    chrome.runtime.openOptionsPage();
  }

  async function saveToObsidian() {
    if (!rawMarkdown || !currentChat) return;

    if (aiSummaryInput.checked && !(await hasProAccess())) {
      aiSummaryInput.checked = false;
      await showMembershipModal(
        'AI 总结需要 Pro',
        '已为你切回原始 Markdown。当前页原始内容可以继续免费保存到笔记。'
      );
      return;
    }

    currentSettings = await loadSettings();
    currentSettings.ai.enabled = aiSummaryInput.checked;
    const settings = repairSettingsForObsidian(currentSettings);

    if (!settings.vault) {
      setStatus('请先在设置里填写 Vault', true);
      openSettings();
      return;
    }

    try {
      const markdown = await prepareMarkdownForExport({ render: false });
      const duplicateChoice = await resolveDuplicateChoice(currentChat);
      const saveSettings = {
        ...settings,
        overwrite: duplicateChoice.mode === 'update' ? true : settings.overwrite,
      };
      await navigator.clipboard.writeText(markdown);
      renderMarkdown(markdown);
      const uri = buildObsidianUri(saveSettings, currentChat, duplicateChoice.filenameOptions);
      const prompted = await showObsidianSavePrompt(uri, currentChat);
      if (!prompted) await chrome.tabs.create({ url: uri, active: false });
      await rememberExport(currentChat, duplicateChoice.filenameOptions);
      setStatus(prompted ? '已在当前页弹出保存窗口' : '已打开 Obsidian 保存页');
    } catch (error) {
      setStatus(error?.message || '保存失败', true);
    }
  }

  async function handleAiSummaryToggle() {
    const enabled = aiSummaryInput.checked;
    if (enabled && !(await hasProAccess())) {
      aiSummaryInput.checked = false;
      await showMembershipModal(
        'AI 总结需要 Pro',
        '当前页原始 Markdown 导出可以免费使用；AI 会在云端把聊天整理成更像知识库笔记的结构化内容。'
      );
      return;
    }

    optimizedMarkdown = '';
    optimizedSignature = '';
    currentSettings = {
      ...(currentSettings || await loadSettings()),
      ai: {
        ...(currentSettings?.ai || {}),
        enabled,
      },
    };
    if (!rawMarkdown) return;
    renderMarkdown(rawMarkdown);

    if (!enabled) {
      clearAiPreviewTimer();
      setStatus('已切回原始 Markdown');
      return;
    }

    scheduleAiPreview(0);
  }

  async function prepareMarkdownForExport(options = {}) {
    const shouldRender = options.render !== false;
    if (!rawMarkdown) return '';

    currentSettings = await loadSettings();
    currentSettings.ai.enabled = aiSummaryInput.checked;
    const aiSettings = currentSettings.ai;

    if (!aiSettings.enabled) {
      if (shouldRender) renderMarkdown(rawMarkdown);
      return rawMarkdown;
    }

    const signature = buildAiSignature(aiSettings);
    if (optimizedMarkdown && optimizedSignature === signature) {
      if (shouldRender) renderMarkdown(optimizedMarkdown);
      return optimizedMarkdown;
    }

    setExportBusy(true);
    setStatus('正在整理对话内容', false, true);

    try {
      const markdown = await optimizeMarkdownWithAi(aiSettings);
      optimizedMarkdown = window.ChatRestoreMarkdown.buildAiSummaryMarkdown(currentChat, cleanAiMarkdown(markdown));
      optimizedSignature = signature;
      if (shouldRender) renderMarkdown(optimizedMarkdown);
      setStatus('AI总结完成');
      return optimizedMarkdown;
    } finally {
      setExportBusy(false);
    }
  }

  function scheduleAiPreview(delay) {
    clearAiPreviewTimer();
    const runId = ++aiPreviewRunId;
    setStatus('正在整理对话内容', false, true);

    aiPreviewTimer = window.setTimeout(async () => {
      try {
        const markdown = await prepareMarkdownForExport({ render: false });
        if (runId !== aiPreviewRunId || !aiSummaryInput.checked) return;
        renderMarkdown(markdown);
        setStatus('AI总结完成');
      } catch (error) {
        if (runId !== aiPreviewRunId) return;
        setStatus(error?.message || 'AI总结生成失败', true);
      }
    }, delay);
  }

  function clearAiPreviewTimer() {
    aiPreviewRunId += 1;
    if (!aiPreviewTimer) return;
    window.clearTimeout(aiPreviewTimer);
    aiPreviewTimer = 0;
  }

  async function optimizeMarkdownWithAi(settings) {
    const response = await window.ChatRestoreCloud.summarizeMarkdown({
      provider: settings.provider,
      style: settings.summaryStyle,
      prompt: settings.prompt,
      markdown: rawMarkdown,
      title: currentChat?.title || '',
      platform: currentChat?.platform || '',
      source_url: currentChat?.url || '',
    });
    const content = response?.markdown || response?.content || '';
    if (!content.trim()) throw new Error('AI 没有返回可用内容');
    return content;
  }

  function renderChat(chat, markdown) {
    currentPlatform = chat.platform || '';
    renderPlatformPill(chat.platform || 'Unknown');
    chatTitle.textContent = chat.title || 'Untitled conversation';
    messageCount.textContent = String(chat.messages.length);
    renderMarkdown(markdown);
  }

  function renderPlatformPill(platform) {
    platformPill.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 8V6.8A2.8 2.8 0 0 1 9.8 4h4.4A2.8 2.8 0 0 1 17 6.8V8"></path>
        <path d="M5 8h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z"></path>
        <path d="M9 13h6"></path>
      </svg>
      ${escapeHtml(platform)}
    `;
  }

  function renderMarkdown(markdown) {
    currentMarkdown = markdown || '';
    wordCount.textContent = String(currentMarkdown.length);
    markdownPreview.value = currentMarkdown;
    updateActions();
  }

  function updateActions() {
    const ready = Boolean(rawMarkdown.trim());
    obsidianButton.disabled = !ready || exportBusy;
  }

  async function loadSettings() {
    const syncSaved = await chrome.storage.sync.get({
      ...defaults.DEFAULT_SYNC,
      aiPrompt: defaults.DEFAULT_AI_PROMPT,
    });

    return {
      vault: normalizeVault(syncSaved.obsidianVault),
      folder: normalizeFolder(syncSaved.obsidianFolder),
      overwrite: Boolean(syncSaved.obsidianOverwrite),
      ai: {
        enabled: Boolean(syncSaved.aiSummaryEnabled),
        prompt: (syncSaved.aiPrompt || defaults.DEFAULT_AI_PROMPT).trim(),
        provider: (syncSaved.aiProvider || defaults.DEFAULT_SYNC.aiProvider).trim(),
        summaryStyle: (syncSaved.aiSummaryStyle || defaults.DEFAULT_SYNC.aiSummaryStyle).trim(),
      },
    };
  }

  function buildAiSignature(settings) {
    return JSON.stringify({
      provider: settings.provider,
      summaryStyle: settings.summaryStyle,
      prompt: settings.prompt,
      markdown: rawMarkdown,
    });
  }

  function cleanAiMarkdown(markdown) {
    let text = String(markdown || '')
      .trim()
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .trim();

    for (let i = 0; i < 3; i += 1) {
      const fenced = text.match(/^```[\w-]*\s*\n([\s\S]*?)\n?```$/);
      if (!fenced) break;
      text = fenced[1].trim();
    }

    text = text
      .replace(/^```[\w-]*\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    text = text.replace(/^---\s*\n[\s\S]*?\n---\s*\n*/, '').trim();

    return text
      .replace(/\n{4,}/g, '\n\n\n')
      .trim();
  }

  function repairSettingsForObsidian(settings) {
    const vaultParts = splitPath(settings.vault);
    if (vaultParts.length <= 1) return settings;

    const [vault, ...vaultFolderParts] = vaultParts;
    const folderParts = splitPath(settings.folder);
    const folder = folderParts[0] === vault
      ? [...vaultFolderParts, ...folderParts.slice(1)].join('/')
      : [...vaultFolderParts, ...folderParts].join('/');

    return {
      ...settings,
      vault,
      folder: normalizeFolder(folder),
    };
  }

  async function resolveDuplicateChoice(chat) {
    const conversationId = window.ChatRestoreMarkdown.buildConversationId(chat);
    const records = await getExportRecords();
    const existing = records[conversationId];
    if (!existing) return { mode: 'new', filenameOptions: {} };

    const shouldUpdate = window.confirm([
      '这个对话已经导出过。',
      '',
      '确定：更新已有笔记',
      '取消：另存为副本',
    ].join('\n'));

    return shouldUpdate
      ? { mode: 'update', filenameOptions: {} }
      : { mode: 'copy', filenameOptions: { copy: true } };
  }

  async function rememberExport(chat, filenameOptions) {
    const conversationId = window.ChatRestoreMarkdown.buildConversationId(chat);
    const records = await getExportRecords();
    records[conversationId] = {
      conversationId,
      title: chat.title || '',
      platform: chat.platform || '',
      url: chat.url || '',
      filename: window.ChatRestoreMarkdown.buildFilename(chat, filenameOptions),
      exportedAt: new Date().toISOString(),
    };
    await chrome.storage.local.set({ exportedConversations: records });
  }

  async function getExportRecords() {
    const saved = await chrome.storage.local.get({ exportedConversations: {} });
    return saved.exportedConversations && typeof saved.exportedConversations === 'object'
      ? saved.exportedConversations
      : {};
  }

  function buildObsidianUri(settings, chat, filenameOptions = {}) {
    const filename = window.ChatRestoreMarkdown.buildFilename(chat, filenameOptions).replace(/\.md$/i, '');
    const filePath = [settings.folder, filename].filter(Boolean).join('/');
    const params = new URLSearchParams();
    params.set('vault', settings.vault);
    params.set('file', filePath);
    params.set('clipboard', 'true');
    params.set(settings.overwrite ? 'overwrite' : 'append', 'true');
    return `obsidian://new?${params.toString()}`;
  }

  function normalizeFolder(value) {
    return String(value || '')
      .replace(/\\/g, '/')
      .replace(/^\/+|\/+$/g, '')
      .replace(/\/{2,}/g, '/')
      .trim();
  }

  function normalizeVault(value) {
    return String(value || '')
      .replace(/\\/g, '/')
      .replace(/^\/+|\/+$/g, '')
      .trim();
  }

  function splitPath(value) {
    return normalizeFolder(value).split('/').filter(Boolean);
  }

  async function hasProAccess() {
    return window.ChatRestoreCloud.hasProAccess();
  }

  async function showMembershipModal(title, message) {
    openMembershipPage(title, message);
  }

  function hideMembershipModal() {
    membershipModal.hidden = true;
    document.body.classList.remove('has-membership-modal');
  }

  async function handleMembershipAction(event) {
    const button = event?.currentTarget || document.activeElement;
    const isUpgrade = button === membershipUpgradeButton;
    const action = isUpgrade
      ? window.ChatRestoreCloud.openCheckout
      : window.ChatRestoreCloud.openLogin;
    setMembershipActionBusy(button, true, isUpgrade ? '正在打开' : '正在登录');
    try {
      await action();
      await updatePlanBadge();
      setStatus(isUpgrade ? '已打开会员码激活入口' : '登录成功');
      hideMembershipModal();
    } catch (error) {
      setStatus(error?.message || '会员操作失败', true);
    } finally {
      setMembershipActionBusy(button, false);
    }
  }

  function openMembershipPage(title, message) {
    const params = new URLSearchParams();
    if (title) params.set('title', title);
    if (message) params.set('message', message);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    chrome.tabs.create({ url: chrome.runtime.getURL(`membership.html${suffix}`) });
    setStatus('已打开会员页面');
  }

  function setMembershipActionBusy(activeButton, isBusy, busyLabel = '') {
    [membershipLoginButton, membershipUpgradeButton].forEach((button) => {
      if (!button) return;
      if (!button.dataset.idleText) button.dataset.idleText = button.textContent;
      button.disabled = isBusy;
      button.classList.toggle('is-loading', isBusy && button === activeButton);
      button.setAttribute('aria-busy', isBusy && button === activeButton ? 'true' : 'false');
      button.textContent = isBusy && button === activeButton
        ? busyLabel
        : button.dataset.idleText;
    });
  }

  function resetMembershipActionButtons() {
    [membershipLoginButton, membershipUpgradeButton].forEach((button) => {
      if (!button) return;
      button.dataset.idleText = button.textContent;
      button.disabled = false;
      button.classList.remove('is-loading');
      button.setAttribute('aria-busy', 'false');
    });
  }

  async function updatePlanBadge() {
    if (!planBadge || !window.ChatRestoreCloud) return;
    const membership = await window.ChatRestoreCloud.getMembership();
    const isPro = Boolean(membership.pro);
    planBadge.textContent = isPro ? '' : 'Free';
    planBadge.className = `plan-badge ${isPro ? 'is-pro' : 'is-free'}`;
    planBadge.title = isPro ? 'Pro 会员' : 'Free 账号';
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function setBusy(isBusy) {
    obsidianButton.disabled = isBusy || !rawMarkdown;
  }

  function setExportBusy(isBusy) {
    exportBusy = isBusy;
    updateActions();
  }

  function setStatus(text, isError = false, isLoading = false) {
    statusText.textContent = text;
    statusText.className = [
      isError ? 'error' : '',
      isLoading ? 'loading' : '',
    ].filter(Boolean).join(' ');
  }
})();
