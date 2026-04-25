# 聊记 Cloud MVP

This service is the server-side boundary for membership, billing, and AI summary. The Chrome extension should never store AI provider keys or Supabase service role keys.

## Endpoints

- `GET /health`
- `GET /v1/me`
- `GET /auth/login`
- `GET /auth/checkout`
- `POST /v1/billing/checkout`
- `POST /webhooks/stripe`
- `POST /v1/ai/summary`

## Environment

```bash
PUBLIC_BASE_URL=https://api.your-domain.com
SUPABASE_URL=https://eadbqbxrdfnzqsggzmlh.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
MINIMAX_BASE_URL=https://api.minimaxi.com/v1
MINIMAX_MODEL=MiniMax-M2.7
MINIMAX_API_KEY=your_server_side_key
STRIPE_SECRET_KEY=sk_live_or_test_xxx
STRIPE_PRICE_ID=price_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
```

Run `schema.sql` in the Supabase SQL editor before enabling paid membership.

For the current test account, `setup_trial.sql` creates the membership table and grants `vincentsun1977@gmail.com` a 30-day `pro/trialing` membership.

## Local Run

```bash
cd chat_restore_note/cloud
npm install
MINIMAX_API_KEY=your_server_side_key npm start
```

For local extension testing, set Chrome storage manually:

```js
chrome.storage.sync.set({ cloudApiBaseUrl: 'http://localhost:8787' })
chrome.storage.local.set({ cloudSessionToken: 'dev-pro-token' })
```

The public extension UI should not expose AI endpoint or API key fields. Those belong on the server.

## Deploy on Render

1. Push the repository to GitHub.
2. In Render, create a new Web Service from the repo.
3. Set Root Directory to:

```text
chat_restore_note/cloud
```

4. Set commands:

```bash
npm install
npm start
```

5. Add environment variables from `.env.example`.
6. Open `/health` on the deployed URL and verify:

```json
{"ok":true,"service":"chat_restore_note_cloud"}
```

7. In the extension, update:

```js
chrome.storage.sync.set({ cloudApiBaseUrl: 'https://your-render-service.onrender.com' })
```

After that, Pro users can call `POST /v1/ai/summary`.

## Verify AI Summary

With `MINIMAX_API_KEY` configured and a Pro token:

```bash
curl -sS -X POST https://your-cloud-api.example.com/v1/ai/summary \
  -H 'Authorization: Bearer <Supabase access token>' \
  -H 'Content-Type: application/json' \
  -d '{"title":"测试","platform":"ChatGPT","style":"knowledge","markdown":"# 测试\n\n用户：如何保存聊天？\n助手：可以导出 Markdown。"}'
```

Expected response:

```json
{"markdown":"# ..."}
```

## Supabase Google Login

The extension uses `chrome.identity.launchWebAuthFlow` and Supabase OAuth.

In Supabase dashboard, enable Google provider and add the extension redirect URL:

```text
https://<chrome-extension-id>.chromiumapp.org/supabase
```

You can find the extension id on `chrome://extensions` after loading the unpacked extension. The extension stores the returned Supabase access token in `chrome.storage.local.cloudSessionToken` and sends it to the cloud API as a Bearer token.

## Membership Flow

1. Extension calls `GET /v1/me` with `Authorization: Bearer <Supabase JWT>`.
2. Server verifies the JWT with Supabase Auth.
3. Server reads `public.memberships`.
4. If the user starts checkout, extension calls `POST /v1/billing/checkout`.
5. Stripe redirects the user to Checkout.
6. Stripe sends `checkout.session.completed` and subscription events to `/webhooks/stripe`.
7. Server updates `public.memberships`.

The current `/auth/login` page is still a placeholder. In production, replace it with a hosted login page that signs in through Supabase and stores the returned JWT into the extension via a callback or manual activation code flow.
