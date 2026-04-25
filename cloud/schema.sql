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

drop policy if exists "Service role can manage memberships" on public.memberships;
create policy "Service role can manage memberships"
  on public.memberships
  for all
  using (auth.jwt() ->> 'role' = 'service_role')
  with check (auth.jwt() ->> 'role' = 'service_role');
