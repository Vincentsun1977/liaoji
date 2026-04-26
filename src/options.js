(function () {
  'use strict';

  const defaults = window.ChatRestoreSettings;
  const vaultInput = document.getElementById('vault-input');
  const vaultPickerButton = document.getElementById('vault-picker-button');
  const vaultDirectoryInput = document.getElementById('vault-directory-input');
  const folderInput = document.getElementById('folder-input');
  const folderPickerButton = document.getElementById('folder-picker-button');
  const folderDirectoryInput = document.getElementById('folder-directory-input');
  const overwriteInput = document.getElementById('overwrite-input');
  const targetPreview = document.getElementById('target-preview');
  const statusText = document.getElementById('status-text');
  const accountStatus = document.getElementById('account-status');
  const accountStatusNote = document.getElementById('account-status-note');
  const aiStatusBadge = document.getElementById('ai-status-badge');
  const refreshMembershipButton = document.getElementById('refresh-membership-button');
  const loginButton = document.getElementById('login-button');
  const logoutButton = document.getElementById('logout-button');
  const licenseCodeInput = document.getElementById('license-code-input');
  const redeemLicenseButton = document.getElementById('redeem-license-button');

  vaultPickerButton.addEventListener('click', chooseVault);
  vaultDirectoryInput.addEventListener('change', chooseVaultFromInput);
  folderPickerButton.addEventListener('click', chooseFolder);
  folderDirectoryInput.addEventListener('change', chooseFolderFromInput);
  refreshMembershipButton.addEventListener('click', refreshMembership);
  loginButton.addEventListener('click', login);
  logoutButton.addEventListener('click', logout);
  redeemLicenseButton.addEventListener('click', redeemLicense);

  [
    vaultInput,
    folderInput,
    overwriteInput,
  ].forEach((input) => {
    input.addEventListener('change', saveSettings);
    input.addEventListener('input', saveSettings);
  });

  init();

  async function init() {
    const syncSaved = await chrome.storage.sync.get({
      ...defaults.DEFAULT_SYNC,
      aiPrompt: defaults.DEFAULT_AI_PROMPT,
    });

    vaultInput.value = syncSaved.obsidianVault || '';
    folderInput.value = syncSaved.obsidianFolder || '';
    overwriteInput.checked = Boolean(syncSaved.obsidianOverwrite);
    updateTargetPreview();
    await updateAccountStatus();
  }

  async function login() {
    try {
      setStatus('正在登录');
      await window.ChatRestoreCloud.openLogin();
      await updateAccountStatus();
      setStatus('登录成功');
    } catch (error) {
      setStatus(error?.message || '登录失败', true);
    }
  }

  async function redeemLicense() {
    const code = licenseCodeInput.value.trim();
    if (!code) {
      setStatus('请输入会员码', true);
      licenseCodeInput.focus();
      return;
    }
    try {
      redeemLicenseButton.disabled = true;
      redeemLicenseButton.textContent = '正在激活';
      setStatus('正在激活会员码');
      await window.ChatRestoreCloud.redeemLicenseCode(code);
      licenseCodeInput.value = '';
      await updateAccountStatus();
      setStatus('Pro 已激活');
    } catch (error) {
      setStatus(error?.message || '会员码激活失败', true);
    } finally {
      redeemLicenseButton.disabled = false;
      redeemLicenseButton.textContent = '激活 Pro';
    }
  }

  async function logout() {
    await window.ChatRestoreCloud.signOut();
    await updateAccountStatus();
    setStatus('已退出登录');
  }

  async function refreshMembership() {
    try {
      setStatus('正在刷新');
      await updateAccountStatus();
      setStatus('已刷新');
    } catch (error) {
      setStatus(error?.message || '刷新失败', true);
    }
  }

  async function saveSettings() {
    const settings = getSettings();
    updateTargetPreview();
    await chrome.storage.sync.set({
      obsidianVault: settings.vault,
      obsidianFolder: settings.folder,
      obsidianOverwrite: settings.overwrite,
    });
    setStatus('已保存');
  }

  function getSettings() {
    return {
      vault: normalizeVault(vaultInput.value),
      folder: normalizeFolder(folderInput.value),
      overwrite: overwriteInput.checked,
    };
  }

  async function updateAccountStatus() {
    const membership = await window.ChatRestoreCloud.getMembership();
    const isPro = Boolean(membership.pro);
    const isLoggedIn = Boolean(membership.authenticated || membership.status !== 'anonymous');

    accountStatus.textContent = isPro ? 'Pro' : 'Free';
    accountStatus.className = `account-status-badge ${isPro ? 'is-pro' : 'is-free'}`;
    accountStatusNote.textContent = isLoggedIn
      ? (isPro ? '已激活会员能力' : '当前为免费账号')
      : '未登录，仅可使用免费功能';
    aiStatusBadge.textContent = isPro ? '已激活' : '未激活';
    aiStatusBadge.className = `status-badge ${isPro ? 'is-active' : 'is-inactive'}`;

    loginButton.textContent = isLoggedIn ? '重新登录' : '登录';
    logoutButton.hidden = !isLoggedIn;
  }

  async function chooseVault() {
    const handle = await pickDirectoryHandle();
    if (handle) {
      const hasObsidianConfig = await directoryHasObsidianConfig(handle);
      setVaultValue(handle.name);
      setStatus(hasObsidianConfig ? '已选择 Vault' : '已选择目录，请确认它是 Vault', !hasObsidianConfig);
      return;
    }

    vaultDirectoryInput.click();
  }

  async function chooseFolder() {
    const handle = await pickDirectoryHandle();
    if (handle) {
      const hasObsidianConfig = await directoryHasObsidianConfig(handle);
      if (hasObsidianConfig) {
        setVaultValue(handle.name);
        setFolderValue('');
        setStatus('已选择 Vault，文件夹已清空');
        return;
      }
      setFolderValue(handle.name);
      setStatus('已选择目录');
      return;
    }

    folderDirectoryInput.click();
  }

  async function pickDirectoryHandle() {
    if (!window.showDirectoryPicker) return null;

    try {
      return await window.showDirectoryPicker({ mode: 'read' });
    } catch (error) {
      if (error?.name === 'AbortError') return null;
      setStatus('无法打开目录选择器，已切换备用方式', true);
      return null;
    }
  }

  async function directoryHasObsidianConfig(handle) {
    try {
      await handle.getDirectoryHandle('.obsidian');
      return true;
    } catch (_error) {
      return false;
    }
  }

  function chooseVaultFromInput() {
    const [file] = Array.from(vaultDirectoryInput.files || []);
    const folderName = file?.webkitRelativePath?.split('/')?.[0] || '';
    if (!folderName) {
      setStatus('请选择含有文件的 Vault 目录，空目录无法被浏览器识别', true);
      return;
    }

    setVaultValue(folderName);
    vaultDirectoryInput.value = '';
    setStatus('已选择 Vault');
  }

  function chooseFolderFromInput() {
    const [file] = Array.from(folderDirectoryInput.files || []);
    const folderName = file?.webkitRelativePath?.split('/')?.[0] || '';
    if (!folderName) {
      setStatus('请选择含有文件的目录，空目录无法被浏览器识别', true);
      return;
    }

    setFolderValue(folderName);
    folderDirectoryInput.value = '';
    setStatus('已选择目录');
  }

  function setFolderValue(value) {
    folderInput.value = normalizeFolder(value);
    saveSettings();
  }

  function setVaultValue(value) {
    vaultInput.value = normalizeVault(value);
    saveSettings();
  }

  function updateTargetPreview() {
    const settings = repairSettingsForObsidian(getSettings());
    const target = [settings.vault, settings.folder].filter(Boolean).join('/');
    targetPreview.textContent = target ? `将保存到：${target}` : '将保存到：未设置';
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

  function setStatus(text, isError = false) {
    statusText.textContent = text;
    statusText.className = isError ? 'error' : '';
  }
})();
