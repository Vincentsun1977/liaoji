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
