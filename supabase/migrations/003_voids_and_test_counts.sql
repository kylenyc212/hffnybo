-- Adds: (1) void support on orders (audit trail, not delete),
-- (2) draft/"test" cash counts that save a denomination breakdown
-- without closing the drawer.
-- Run once in Supabase SQL editor. Safe to re-run.

alter table public.orders
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by text,
  add column if not exists void_reason text;

create index if not exists orders_voided_idx on public.orders (voided_at);

create table if not exists public.cash_counts (
  id uuid primary key default gen_random_uuid(),
  drawer_id uuid not null references public.cash_drawers(id) on delete cascade,
  created_at timestamptz not null default now(),
  who text not null,
  denoms jsonb not null,
  counted_cents integer not null,
  expected_cents integer not null,
  variance_cents integer not null,
  notes text
);
create index if not exists cash_counts_drawer_idx on public.cash_counts (drawer_id, created_at);

alter table public.cash_counts enable row level security;
do $$ begin
  create policy anon_all on public.cash_counts for all to anon using (true) with check (true);
exception when duplicate_object then null; end $$;
