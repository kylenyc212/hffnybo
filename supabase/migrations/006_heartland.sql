-- Heartland integration foundation: short codes on screenings, SKUs on
-- ticket types, external transaction ref on orders, and a staging table
-- for pulled Heartland transactions. The Edge Function that actually
-- calls the Heartland API comes in a follow-up once API creds are known.
-- Run once in Supabase SQL editor. Safe to re-run.

alter table public.screenings
  add column if not exists short_code text;
create unique index if not exists screenings_short_code_idx
  on public.screenings (short_code) where short_code is not null;

alter table public.ticket_types
  add column if not exists heartland_sku text;
create unique index if not exists ticket_types_heartland_sku_idx
  on public.ticket_types (heartland_sku) where heartland_sku is not null;

alter table public.orders
  add column if not exists external_ref text;
create unique index if not exists orders_external_ref_idx
  on public.orders (external_ref) where external_ref is not null;

create table if not exists public.heartland_transactions (
  id uuid primary key default gen_random_uuid(),
  heartland_txn_id text not null unique,
  amount_cents integer not null,
  charged_at timestamptz not null,
  raw jsonb,
  matched_order_id uuid references public.orders(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','matched','needs_review','ignored')),
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists heartland_txn_status_idx on public.heartland_transactions (status);
create index if not exists heartland_txn_date_idx on public.heartland_transactions (charged_at);
alter table public.heartland_transactions enable row level security;
do $$ begin
  create policy anon_all on public.heartland_transactions for all to anon using (true) with check (true);
exception when duplicate_object then null; end $$;
