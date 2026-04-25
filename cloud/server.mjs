import http from 'node:http';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT || 8787);
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/g, '');
const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://eadbqbxrdfnzqsggzmlh.supabase.co').replace(/\/+$/g, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVhZGJxYnhyZGZuenFzZ2d6bWxoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMDMwNTQsImV4cCI6MjA5MjY3OTA1NH0.yTM79mlvJVgIBw9K2JXA4bUkulUaEDXqG4FcavsFuO4';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const MINIMAX_BASE_URL = (process.env.MINIMAX_BASE_URL || 'https://api.minimaxi.com/v1').replace(/\/+$/g, '');
const MINIMAX_MODEL = process.env.MINIMAX_MODEL || 'MiniMax-M2.7';
const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY || '';
const DEV_PRO_TOKEN = process.env.DEV_PRO_TOKEN || 'dev-pro-token';

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return send(res, 204, '');
    setCors(res);

    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    if (req.method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, { ok: true, service: 'chat_restore_note_cloud' });
    }

    if (req.method === 'GET' && url.pathname === '/v1/me') {
      return handleMe(req, res);
    }

    if (req.method === 'GET' && url.pathname === '/auth/login') {
      return sendHtml(res, authPlaceholder('登录 / 注册', '后续这里接 Supabase Auth 或 Clerk。'));
    }

    if (req.method === 'GET' && url.pathname === '/auth/checkout') {
      return sendHtml(res, authPlaceholder('开通会员', '后续这里接 Stripe Checkout。'));
    }

    if (req.method === 'POST' && url.pathname === '/v1/billing/checkout') {
      return handleCheckout(req, res);
    }

    if (req.method === 'POST' && url.pathname === '/webhooks/stripe') {
      return handleStripeWebhook(req, res);
    }

    if (req.method === 'POST' && url.pathname === '/v1/ai/summary') {
      return handleSummary(req, res);
    }

    return sendJson(res, 404, { error: 'Not found' });
  } catch (error) {
    return sendJson(res, 500, { error: error?.message || 'Internal server error' });
  }
});

server.listen(PORT, () => {
  console.log(`chat_restore_note cloud MVP listening on http://localhost:${PORT}`);
});

async function handleMe(req, res) {
  const token = getBearerToken(req);
  if (!token) {
    return sendJson(res, 200, {
      id: null,
      email: null,
      plan: 'free',
      status: 'anonymous',
      membership_expires_at: '',
    });
  }

  if (token === DEV_PRO_TOKEN) {
    return sendJson(res, 200, {
      id: 'dev-user',
      email: 'dev@example.com',
      plan: 'pro',
      status: 'active',
      membership_expires_at: '',
    });
  }

  const user = await getSupabaseUser(token);
  if (!user) return sendJson(res, 401, { error: 'Invalid session token' });

  const membership = await getMembershipByUserId(user.id);
  return sendJson(res, 200, {
    id: user.id,
    email: user.email || '',
    plan: membership?.plan || 'free',
    status: membership?.status || 'inactive',
    membership_expires_at: membership?.current_period_end || '',
  });
}

async function handleSummary(req, res) {
  const token = getBearerToken(req);
  const membership = await resolveMembership(token);
  if (!membership.pro) return sendJson(res, 403, { error: 'Pro membership required' });
  if (!MINIMAX_API_KEY) {
    return sendJson(res, 501, {
      error: 'AI 总结服务尚未配置：请在云端环境变量中设置 MINIMAX_API_KEY',
    });
  }

  const body = await readJson(req);
  const markdown = String(body.markdown || '').trim();
  if (!markdown) return sendJson(res, 400, { error: 'markdown is required' });

  const aiMarkdown = await summarizeWithMinimax(body, markdown);
  return sendJson(res, 200, { markdown: aiMarkdown });
}

async function handleCheckout(req, res) {
  if (!STRIPE_SECRET_KEY || !STRIPE_PRICE_ID) {
    return sendJson(res, 501, { error: 'Stripe is not configured on the server' });
  }

  const token = getBearerToken(req);
  const user = await resolveUser(token);
  if (!user) return sendJson(res, 401, { error: 'Please log in first' });

  const body = await readJson(req);
  const session = await createStripeCheckoutSession({
    user,
    successUrl: body.success_url || `${PUBLIC_BASE_URL}/auth/success`,
    cancelUrl: body.cancel_url || `${PUBLIC_BASE_URL}/auth/checkout`,
  });
  return sendJson(res, 200, { url: session.url, id: session.id });
}

async function handleStripeWebhook(req, res) {
  const raw = await readRaw(req);
  const signature = req.headers['stripe-signature'] || '';
  if (STRIPE_WEBHOOK_SECRET && !verifyStripeSignature(raw, signature)) {
    return sendJson(res, 400, { error: 'Invalid Stripe signature' });
  }

  let event;
  try {
    event = JSON.parse(raw || '{}');
  } catch (_error) {
    return sendJson(res, 400, { error: 'Invalid JSON body' });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data?.object || {};
    const userId = session.metadata?.user_id;
    if (userId) {
      await upsertMembership({
        user_id: userId,
        email: session.customer_details?.email || session.customer_email || '',
        plan: 'pro',
        status: 'active',
        stripe_customer_id: session.customer || '',
        stripe_subscription_id: session.subscription || '',
        current_period_end: '',
      });
    }
  }

  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const subscription = event.data?.object || {};
    const userId = subscription.metadata?.user_id || await findUserIdBySubscription(subscription.id);
    if (userId) {
      await upsertMembership({
        user_id: userId,
        plan: subscription.status === 'active' || subscription.status === 'trialing' ? 'pro' : 'free',
        status: subscription.status || 'inactive',
        stripe_customer_id: subscription.customer || '',
        stripe_subscription_id: subscription.id || '',
        current_period_end: subscription.current_period_end
          ? new Date(subscription.current_period_end * 1000).toISOString()
          : '',
      });
    }
  }

  return sendJson(res, 200, { received: true });
}

async function summarizeWithMinimax(body, markdown) {
  const response = await fetch(`${MINIMAX_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${MINIMAX_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MINIMAX_MODEL,
      temperature: 0.2,
      max_completion_tokens: 4096,
      messages: [
        {
          role: 'system',
          content: String(body.prompt || defaultPrompt()),
        },
        {
          role: 'user',
          content: [
            `标题：${body.title || '未命名对话'}`,
            `平台：${body.platform || 'Unknown'}`,
            `总结风格：${body.style || 'knowledge'}`,
            '',
            '请整理下面的聊天记录，输出标准 Markdown 正文：',
            markdown,
          ].join('\n'),
        },
      ],
    }),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error?.message || data?.message || `AI request failed (${response.status})`);
  const content = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || '';
  return cleanAiMarkdown(Array.isArray(content) ? content.map((part) => part?.text || part).join('') : content);
}

async function resolveMembership(token) {
  if (!token) return { pro: false, plan: 'free' };
  if (token === DEV_PRO_TOKEN) return { pro: true, plan: 'pro' };

  const user = await getSupabaseUser(token);
  if (!user) return { pro: false, plan: 'free' };

  const membership = await getMembershipByUserId(user.id);
  const expiresAt = membership?.current_period_end || '';
  const pro = membership?.plan === 'pro'
    && ['active', 'trialing'].includes(membership?.status || '')
    && (!expiresAt || new Date(expiresAt).getTime() > Date.now());
  return { ...membership, user, pro };
}

async function resolveUser(token) {
  if (!token) return null;
  if (token === DEV_PRO_TOKEN) {
    return { id: 'dev-user', email: 'dev@example.com' };
  }
  return getSupabaseUser(token);
}

async function getSupabaseUser(token) {
  const authApiKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !authApiKey) return null;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: authApiKey,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) return null;
  return response.json();
}

async function getMembershipByUserId(userId) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !userId) return null;
  const rows = await supabaseRest(`/rest/v1/memberships?user_id=eq.${encodeURIComponent(userId)}&select=*&limit=1`);
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function findUserIdBySubscription(subscriptionId) {
  if (!subscriptionId) return '';
  const rows = await supabaseRest(`/rest/v1/memberships?stripe_subscription_id=eq.${encodeURIComponent(subscriptionId)}&select=user_id&limit=1`);
  return Array.isArray(rows) ? rows[0]?.user_id || '' : '';
}

async function upsertMembership(payload) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;
  await supabaseRest('/rest/v1/memberships?on_conflict=user_id', {
    method: 'POST',
    headers: {
      Prefer: 'resolution=merge-duplicates',
    },
    body: {
      ...payload,
      updated_at: new Date().toISOString(),
    },
  });
}

async function supabaseRest(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    method: options.method || 'GET',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(data?.message || data?.error || `Supabase request failed (${response.status})`);
  return data;
}

async function createStripeCheckoutSession({ user, successUrl, cancelUrl }) {
  const params = new URLSearchParams({
    mode: 'subscription',
    'line_items[0][price]': STRIPE_PRICE_ID,
    'line_items[0][quantity]': '1',
    success_url: successUrl,
    cancel_url: cancelUrl,
    customer_email: user.email || '',
    'metadata[user_id]': user.id,
    'subscription_data[metadata][user_id]': user.id,
  });

  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error?.message || `Stripe Checkout failed (${response.status})`);
  return data;
}

function verifyStripeSignature(raw, signatureHeader) {
  const timestamp = String(signatureHeader).match(/t=([^,]+)/)?.[1] || '';
  const signatures = String(signatureHeader).match(/v1=([^,]+)/g)?.map((item) => item.slice(3)) || [];
  if (!timestamp || !signatures.length) return false;

  const signedPayload = `${timestamp}.${raw}`;
  const expected = crypto
    .createHmac('sha256', STRIPE_WEBHOOK_SECRET)
    .update(signedPayload, 'utf8')
    .digest('hex');

  return signatures.some((signature) => timingSafeEqual(signature, expected));
}

function timingSafeEqual(a, b) {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) return false;
  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

function defaultPrompt() {
  return [
    '你是一位知识库笔记整理专家。',
    '请把聊天记录整理成适合 Obsidian/Notion 保存的 Markdown 知识笔记。',
    '保留关键事实、步骤、代码、命令、链接和结论。',
    '删除寒暄和重复内容。',
    '从 # 标题开始，不要输出 YAML frontmatter，不要把整篇放入代码块。',
  ].join('\n');
}

function cleanAiMarkdown(markdown) {
  let text = String(markdown || '').trim();
  for (let i = 0; i < 3; i += 1) {
    const fenced = text.match(/^```[\w-]*\s*\n([\s\S]*?)\n?```$/);
    if (!fenced) break;
    text = fenced[1].trim();
  }
  return text.replace(/^---\s*\n[\s\S]*?\n---\s*\n*/, '').trim();
}

function getBearerToken(req) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function readJson(req) {
  return readRaw(req).then((raw) => {
    try {
      return raw ? JSON.parse(raw) : {};
    } catch (_error) {
      throw new Error('Invalid JSON body');
    }
  });
}

function readRaw(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 2_000_000) reject(new Error('Request body too large'));
    });
    req.on('end', () => {
      resolve(raw);
    });
    req.on('error', reject);
  });
}

function authPlaceholder(title, message) {
  return `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} - chat_restore_note</title>
<style>
  body{margin:0;display:grid;min-height:100vh;place-items:center;background:#f6f7f9;color:#1f2937;font:15px/1.5 ui-sans-serif,system-ui}
  main{width:min(440px,calc(100vw - 32px));border:1px solid #e5e7eb;border-radius:18px;padding:28px;background:white;box-shadow:0 20px 60px rgba(17,24,39,.12)}
  h1{margin:0 0 10px;font-size:26px}p{margin:0;color:#6b7280}.token{margin-top:18px;padding:12px;border-radius:10px;background:#f3f4f6;font-family:ui-monospace,monospace;font-size:12px}
</style>
<main>
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(message)}</p>
  <p class="token">本地开发 Pro Token: ${escapeHtml(DEV_PRO_TOKEN)}</p>
</main>`;
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

function sendJson(res, status, data) {
  setCors(res);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  send(res, status, JSON.stringify(data));
}

function sendHtml(res, html) {
  setCors(res);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  send(res, 200, html);
}

function send(res, status, body) {
  res.statusCode = status;
  res.end(body);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
