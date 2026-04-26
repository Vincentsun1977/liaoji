(function () {
  'use strict';

  const title = document.getElementById('membership-title');
  const message = document.getElementById('membership-message');
  const planBadge = document.getElementById('plan-badge');
  const loginButton = document.getElementById('login-button');
  const upgradeButton = document.getElementById('upgrade-button');

  loginButton.addEventListener('click', handleLogin);
  upgradeButton.addEventListener('click', handleUpgrade);

  init();

  async function init() {
    applyQueryCopy();
    await updatePlanBadge();
  }

  function applyQueryCopy() {
    const params = new URLSearchParams(location.search);
    const queryTitle = params.get('title');
    const queryMessage = params.get('message');
    if (queryTitle) title.textContent = queryTitle;
    if (queryMessage) message.textContent = queryMessage;
  }

  async function handleLogin(event) {
    await runMembershipAction(event.currentTarget, '正在登录', async () => {
      await window.ChatRestoreCloud.openLogin();
      await updatePlanBadge();
    });
  }

  async function handleUpgrade(event) {
    await runMembershipAction(event.currentTarget, '正在打开', async () => {
      await window.ChatRestoreCloud.openCheckout();
      await updatePlanBadge();
    });
  }

  async function runMembershipAction(button, label, action) {
    setActionBusy(button, true, label);
    try {
      await action();
    } catch (error) {
      message.textContent = error?.message || '会员操作失败，请稍后重试。';
    } finally {
      setActionBusy(button, false);
    }
  }

  function setActionBusy(activeButton, isBusy, busyLabel = '') {
    [loginButton, upgradeButton].forEach((button) => {
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

  async function updatePlanBadge() {
    if (!window.ChatRestoreCloud) return;
    const membership = await window.ChatRestoreCloud.getMembership();
    const isPro = Boolean(membership.pro);
    planBadge.textContent = isPro ? '' : 'Free';
    planBadge.className = `plan-badge ${isPro ? 'is-pro' : 'is-free'}`;
    planBadge.title = isPro ? 'Pro 会员' : 'Free 账号';
    if (membership.authenticated && !isPro) {
      loginButton.textContent = '重新登录';
      loginButton.dataset.idleText = '重新登录';
    }
    if (isPro) {
      upgradeButton.textContent = '已开通 Pro';
      upgradeButton.dataset.idleText = '已开通 Pro';
      upgradeButton.disabled = true;
      title.textContent = 'Pro 会员已生效';
      message.textContent = '您已经可以使用批量导出和 AI 智能总结。';
    }
  }
})();
