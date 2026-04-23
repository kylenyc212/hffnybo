-- HFFNY Box Office — schema v1
-- Run in Supabase SQL Editor against an empty "public" schema.
-- Idempotent-ish: uses IF NOT EXISTS where possible. Not safe to re-run after data exists.

create extension if not exists "pgcrypto";

-- ========== USERS (PIN auth) ==========
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  pin_hash text not null unique,
  role text not null check (role in ('cashier','admin')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists users_active_idx on public.users (active);

-- ========== SCREENINGS ==========
create table if not exists public.screenings (
  id uuid primary key default gen_random_uuid(),
  starts_at timestamptz not null,
  title text not null,
  capacity integer not null default 200,
  online_sold integer not null default 0,
  notes text,
  is_free boolean not null default false,
  short_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists screenings_starts_at_idx on public.screenings (starts_at);
create unique index if not exists screenings_short_code_idx
  on public.screenings (short_code) where short_code is not null;

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists screenings_touch on public.screenings;
create trigger screenings_touch before update on public.screenings
for each row execute function public.touch_updated_at();

-- ========== TICKET TYPES ==========
-- screening_id null => default template applied across all screenings
create table if not exists public.ticket_types (
  id uuid primary key default gen_random_uuid(),
  screening_id uuid references public.screenings(id) on delete cascade,
  label text not null,
  price_cents integer not null check (price_cents >= 0),
  category text not null check (category in ('paid','comp','other')),
  comp_category text check (comp_category in ('press','pass_holder','industry')),
  sort_order integer not null default 0,
  active boolean not null default true,
  heartland_sku text
);
create index if not exists ticket_types_screening_idx on public.ticket_types (screening_id);
create unique index if not exists ticket_types_heartland_sku_idx
  on public.ticket_types (heartland_sku) where heartland_sku is not null;

-- ========== PASSHOLDERS ==========
create table if not exists public.passholders (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  barcode text not null unique,
  synced_at timestamptz not null default now()
);
create index if not exists passholders_barcode_idx on public.passholders (barcode);

-- ========== CASH DRAWERS ==========
create table if not exists public.cash_drawers (
  id uuid primary key default gen_random_uuid(),
  device_label text not null,
  shift_date date not null,
  opened_at timestamptz not null default now(),
  opened_by text not null,
  opening_cents integer not null default 0,
  closed_at timestamptz,
  closed_by text,
  counted_cents integer,
  opening_denoms jsonb,
  closing_denoms jsonb
);
create index if not exists cash_drawers_shift_idx on public.cash_drawers (shift_date, device_label);

-- Only one OPEN drawer globally at a time (shared across all iPads).
-- Unique on a constant expression + partial WHERE = only one matching row.
create unique index if not exists cash_drawers_one_open_shift
  on public.cash_drawers ((true)) where closed_at is null;

-- ========== CASH EVENTS ==========
create table if not exists public.cash_events (
  id uuid primary key default gen_random_uuid(),
  drawer_id uuid not null references public.cash_drawers(id) on delete cascade,
  kind text not null check (kind in ('open','sale','removal','close','adjustment','add')),
  amount_cents integer not null,
  reason text,
  who text not null,
  order_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists cash_events_drawer_idx on public.cash_events (drawer_id, created_at);

-- ========== ORDERS ==========
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  cashier_id uuid references public.users(id),
  cashier_name text not null,
  device_label text not null,
  drawer_id uuid references public.cash_drawers(id),
  subtotal_cents integer not null default 0,
  cash_tendered_cents integer not null default 0,
  change_cents integer not null default 0,
  source text not null default 'boxoffice' check (source in ('boxoffice','external_heartland')),
  notes text,
  voided_at timestamptz,
  voided_by text,
  void_reason text,
  customer_name text,
  customer_email text,
  customer_phone text,
  customer_address text,
  external_ref text
);
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
create index if not exists orders_created_at_idx on public.orders (created_at);
create index if not exists orders_drawer_idx on public.orders (drawer_id);
create index if not exists orders_voided_idx on public.orders (voided_at);

-- Draft / mid-shift cash counts (spot checks that don't close the drawer).
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

-- ========== ORDER LINES ==========
create table if not exists public.order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  screening_id uuid not null references public.screenings(id),
  ticket_type_id uuid references public.ticket_types(id),
  label text not null,
  qty integer not null check (qty > 0),
  unit_price_cents integer not null check (unit_price_cents >= 0),
  category text not null check (category in ('paid','comp','other')),
  comp_category text check (comp_category in ('press','pass_holder','industry')),
  passholder_id uuid references public.passholders(id),
  patron_name text
);
create index if not exists order_lines_order_idx on public.order_lines (order_id);
create index if not exists order_lines_screening_idx on public.order_lines (screening_id);

-- ========== ROW LEVEL SECURITY ==========
-- We authenticate via a custom PIN flow using the anon key, so we rely on schema-level
-- permissions. Turn RLS on so nothing leaks if someone hits the API raw without a PIN check.
-- For v1, allow anon read/write to these tables. Harden before public exposure.
alter table public.users enable row level security;
alter table public.screenings enable row level security;
alter table public.ticket_types enable row level security;
alter table public.passholders enable row level security;
alter table public.cash_drawers enable row level security;
alter table public.cash_events enable row level security;
alter table public.orders enable row level security;
alter table public.order_lines enable row level security;

-- Minimal permissive policies — tighten once we confirm access patterns.
do $$ begin
  create policy anon_all on public.screenings for all to anon using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy anon_all on public.ticket_types for all to anon using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy anon_all on public.passholders for all to anon using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy anon_all on public.cash_drawers for all to anon using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy anon_all on public.cash_events for all to anon using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy anon_all on public.orders for all to anon using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy anon_all on public.order_lines for all to anon using (true) with check (true);
exception when duplicate_object then null; end $$;
-- Users table: anon can SELECT (to verify PIN) and admin flow will use service role for writes later.
do $$ begin
  create policy anon_select on public.users for select to anon using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy anon_insert on public.users for insert to anon with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy anon_update on public.users for update to anon using (true) with check (true);
exception when duplicate_object then null; end $$;
