(function () {
  'use strict';

  const defaults = window.ChatRestoreSettings || {};

  window.ChatRestoreCloud = {
    getMembership,
    hasProAccess,
    openLogin,
    openCheckout,
    redeemLicenseCode,
    signOut,
    summarizeMarkdown,
  };

  async function getMembership() {
    const token = await getFreshSessionToken();
    if (!token) return { plan: 'free', status: 'anonymous', pro: false };

    try {
      const data = await cloudRequest('/v1/me', { token });
      const plan = data?.plan || 'free';
      const expiresAt = data?.membership_expires_at || data?.membershipExpiresAt || '';
      const pro = plan === 'pro' && (!expiresAt || new Date(expiresAt).getTime() > Date.now());
      if (!pro) {
        const supabaseMembership = await getSupabaseMembership(token);
        if (supabaseMembership?.pro) return supabaseMembership;
      }
      const authenticated = Boolean(data?.id || data?.email || data?.status !== 'anonymous');
      await chrome.storage.local.set({
        membershipPlan: pro ? 'pro' : plan,
        membershipExpiresAt: expiresAt,
      });
      return { ...data, plan, pro, authenticated };
    } catch (_error) {
      const supabaseMembership = await getSupabaseMembership(token);
      if (supabaseMembership) return supabaseMembership;
      return readCachedMembership();
    }
  }

  async function hasProAccess() {
    const membership = await getMembership();
    return Boolean(membership.pro);
  }

  async function openLogin() {
    const authUrl = await buildSupabaseGoogleAuthUrl();
    let redirectUrl = '';
    try {
      redirectUrl = await launchWebAuthFlow(authUrl);
    } catch (error) {
      await chrome.storage.local.set({
        lastAuthUrl: authUrl,
        lastAuthError: error?.message || 'Google 登录失败',
      });
      chrome.tabs.create({ url: authUrl });
      throw new Error('已在新标签页打开登录链接，请完成 Google 登录后回到插件刷新状态。');
    }

    const session = parseSupabaseSession(redirectUrl);
    if (!session.access_token) throw new Error('没有从 Supabase 登录结果中获取到 access token');

    await chrome.storage.local.set({
      cloudSessionToken: session.access_token,
      cloudRefreshToken: session.refresh_token || '',
      cloudTokenExpiresAt: session.expires_at || computeExpiresAt(session.expires_in),
      membershipPlan: 'free',
      membershipExpiresAt: '',
    });
    await getMembership();
  }

  async function openCheckout() {
    const token = await getFreshSessionToken();
    if (!token) {
      await openLogin();
      return;
    }

    const data = await cloudRequest('/v1/billing/checkout', {
      token,
      method: 'POST',
      body: {
        success_url: chrome.runtime.getURL('popup.html'),
        cancel_url: chrome.runtime.getURL('popup.html'),
      },
    });
    if (!data?.url) throw new Error('云端没有返回付款链接');
    chrome.tabs.create({ url: data.url });
  }

  async function redeemLicenseCode(code) {
    const token = await getFreshSessionToken();
    if (!token) throw new Error('请先登录账号');
    const data = await cloudRequest('/v1/license/redeem', {
      token,
      method: 'POST',
      body: { code },
    });
    await chrome.storage.local.set({
      membershipPlan: data.plan || 'pro',
      membershipExpiresAt: data.membership_expires_at || '',
    });
    return data;
  }

  async function summarizeMarkdown(payload) {
    const token = await getFreshSessionToken();
    if (!token) throw new Error('请先登录会员账号');
    return cloudRequest('/v1/ai/summary', {
      token,
      method: 'POST',
      body: payload,
    });
  }

  async function signOut() {
    await chrome.storage.local.remove([
      'cloudSessionToken',
      'cloudRefreshToken',
      'cloudTokenExpiresAt',
      'membershipPlan',
      'membershipExpiresAt',
    ]);
  }

  async function cloudRequest(path, options = {}) {
    const baseUrl = await getCloudBaseUrl();
    let response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method: options.method || 'GET',
        headers: {
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
    } catch (_error) {
      throw new Error(`云端会员服务不可访问：${baseUrl}`);
    }
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || `云端服务请求失败（${response.status}）`);
    return data || {};
  }

  async function getCloudBaseUrl() {
    const saved = await chrome.storage.sync.get({
      cloudApiBaseUrl: defaults.DEFAULT_CLOUD_API_BASE_URL || '',
    });
    return String(saved.cloudApiBaseUrl || defaults.DEFAULT_CLOUD_API_BASE_URL || '')
      .replace(/\/+$/g, '');
  }

  async function getSupabaseConfig() {
    const saved = await chrome.storage.sync.get({
      supabaseUrl: defaults.DEFAULT_SUPABASE_URL || '',
      supabaseAnonKey: defaults.DEFAULT_SUPABASE_ANON_KEY || '',
    });
    return {
      url: String(saved.supabaseUrl || defaults.DEFAULT_SUPABASE_URL || '').replace(/\/+$/g, ''),
      anonKey: String(saved.supabaseAnonKey || defaults.DEFAULT_SUPABASE_ANON_KEY || '').trim(),
    };
  }

  async function getFreshSessionToken() {
    const saved = await chrome.storage.local.get({
      cloudSessionToken: '',
      cloudRefreshToken: '',
      cloudTokenExpiresAt: 0,
    });
    const token = String(saved.cloudSessionToken || '').trim();
    const refreshToken = String(saved.cloudRefreshToken || '').trim();
    const expiresAt = Number(saved.cloudTokenExpiresAt || 0);
    if (!token || !refreshToken || !expiresAt) return token;
    if (Date.now() < expiresAt - 60_000) return token;
    return refreshSupabaseSession(refreshToken);
  }

  async function refreshSupabaseSession(refreshToken) {
    const config = await getSupabaseConfig();
    if (!config.url || !config.anonKey) return '';

    const response = await fetch(`${config.url}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        apikey: config.anonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.access_token) {
      await signOut();
      return '';
    }

    await chrome.storage.local.set({
      cloudSessionToken: data.access_token,
      cloudRefreshToken: data.refresh_token || refreshToken,
      cloudTokenExpiresAt: computeExpiresAt(data.expires_in),
    });
    return data.access_token;
  }

  async function readCachedMembership() {
    const saved = await chrome.storage.local.get({
      membershipPlan: 'free',
      membershipExpiresAt: '',
    });
    const pro = saved.membershipPlan === 'pro'
      && (!saved.membershipExpiresAt || new Date(saved.membershipExpiresAt).getTime() > Date.now());
    return {
      plan: saved.membershipPlan || 'free',
      membership_expires_at: saved.membershipExpiresAt || '',
      status: 'cached',
      pro,
    };
  }

  async function getSupabaseMembership(token) {
    const config = await getSupabaseConfig();
    if (!config.url || !config.anonKey || !token) return null;

    try {
      const response = await fetch(`${config.url}/rest/v1/memberships?select=plan,status,current_period_end&limit=1`, {
        headers: {
          apikey: config.anonKey,
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) return null;
      const rows = await response.json().catch(() => []);
      const membership = Array.isArray(rows) ? rows[0] : null;
      if (!membership) {
        return { plan: 'free', status: 'authenticated', pro: false, authenticated: true };
      }

      const expiresAt = membership.current_period_end || '';
      const pro = membership.plan === 'pro'
        && ['active', 'trialing'].includes(membership.status || '')
        && (!expiresAt || new Date(expiresAt).getTime() > Date.now());
      await chrome.storage.local.set({
        membershipPlan: pro ? 'pro' : membership.plan || 'free',
        membershipExpiresAt: expiresAt,
      });
      return {
        plan: membership.plan || 'free',
        status: membership.status || 'inactive',
        membership_expires_at: expiresAt,
        pro,
        authenticated: true,
      };
    } catch (_error) {
      return null;
    }
  }

  async function openCloudPage(path) {
    const baseUrl = await getCloudBaseUrl();
    const params = new URLSearchParams({
      source: 'chrome_extension',
      extension_id: chrome.runtime.id,
    });
    chrome.tabs.create({ url: `${baseUrl}${path}?${params.toString()}` });
  }

  async function buildSupabaseGoogleAuthUrl() {
    const config = await getSupabaseConfig();
    if (!config.url) throw new Error('Supabase URL 未配置');
    const redirectTo = chrome.identity.getRedirectURL('supabase');
    const params = new URLSearchParams({
      provider: 'google',
      redirect_to: redirectTo,
      scopes: 'email profile',
      query_params: JSON.stringify({
        access_type: 'offline',
        prompt: 'consent',
      }),
    });
    return `${config.url}/auth/v1/authorize?${params.toString()}`;
  }

  function launchWebAuthFlow(url) {
    return new Promise((resolve, reject) => {
      chrome.identity.launchWebAuthFlow({ url, interactive: true }, (redirectUrl) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message || 'Google 登录失败'));
          return;
        }
        if (!redirectUrl) {
          reject(new Error('Google 登录被取消'));
          return;
        }
        resolve(redirectUrl);
      });
    });
  }

  function parseSupabaseSession(redirectUrl) {
    const url = new URL(redirectUrl);
    const params = new URLSearchParams([
      ...new URLSearchParams(url.search).entries(),
      ...new URLSearchParams(url.hash.replace(/^#/, '')).entries(),
    ]);
    return {
      access_token: params.get('access_token') || '',
      refresh_token: params.get('refresh_token') || '',
      expires_in: Number(params.get('expires_in') || 0),
      expires_at: Number(params.get('expires_at') || 0) * 1000 || 0,
      token_type: params.get('token_type') || 'bearer',
    };
  }

  function computeExpiresAt(expiresIn) {
    const seconds = Number(expiresIn || 0);
    return seconds ? Date.now() + seconds * 1000 : 0;
  }
})();
