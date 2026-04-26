create table if not exists public.memberships (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  plan text not null default 'free',
  status text not null default 'inactive',
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists memberships_stripe_customer_id_idx
  on public.memberships(stripe_customer_id);

create index if not exists memberships_stripe_subscription_id_idx
  on public.memberships(stripe_subscription_id);

alter table public.memberships enable row level security;

drop policy if exists "Users can read own membership" on public.memberships;
create policy "Users can read own membership"
  on public.memberships
  for select
  using (auth.uid() = user_id);

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

drop policy if exists "Anyone can read app settings" on public.app_settings;
create policy "Anyone can read app settings"
  on public.app_settings
  for select
  using (true);

drop policy if exists "Service role can manage app settings" on public.app_settings;
create policy "Service role can manage app settings"
  on public.app_settings
  for all
  using (auth.jwt() ->> 'role' = 'service_role')
  with check (auth.jwt() ->> 'role' = 'service_role');

insert into public.app_settings (key, value)
values
  ('free_daily_export_limit', '5'::jsonb),
  ('free_ai_summary_limit', '0'::jsonb),
  ('pro_daily_export_limit', 'null'::jsonb),
  ('pro_ai_summary_limit', 'null'::jsonb),
  ('batch_export_requires_pro', 'true'::jsonb),
  ('ai_summary_requires_pro', 'true'::jsonb)
on conflict (key) do nothing;

create table if not exists public.license_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  label text,
  plan text not null default 'pro',
  status text not null default 'active',
  duration_days integer not null default 30,
  max_redemptions integer not null default 1,
  redeemed_count integer not null default 0,
  expires_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists license_codes_status_idx
  on public.license_codes(status);

create table if not exists public.license_redemptions (
  id uuid primary key default gen_random_uuid(),
  license_code_id uuid not null references public.license_codes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text,
  redeemed_at timestamptz not null default now()
);

create index if not exists license_redemptions_user_id_idx
  on public.license_redemptions(user_id);

alter table public.license_codes enable row level security;
alter table public.license_redemptions enable row level security;

drop policy if exists "Service role can manage license codes" on public.license_codes;
create policy "Service role can manage license codes"
  on public.license_codes
  for all
  using (auth.jwt() ->> 'role' = 'service_role')
  with check (auth.jwt() ->> 'role' = 'service_role');

drop policy if exists "Service role can manage license redemptions" on public.license_redemptions;
create policy "Service role can manage license redemptions"
  on public.license_redemptions
  for all
  using (auth.jwt() ->> 'role' = 'service_role')
  with check (auth.jwt() ->> 'role' = 'service_role');

insert into public.memberships (
  user_id,
  email,
  plan,
  status,
  current_period_end
)
values (
  '5b8bf741-d2c6-47de-8484-87b5f5a115f8',
  'vincentsun1977@gmail.com',
  'pro',
  'trialing',
  now() + interval '30 days'
)
on conflict (user_id)
do update set
  email = excluded.email,
  plan = 'pro',
  status = 'trialing',
  current_period_end = now() + interval '30 days',
  updated_at = now();
