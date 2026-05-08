-- 025_party_guests.sql
-- Closing-night party guest list.

create table if not exists public.party_guests (
  id             uuid        primary key default gen_random_uuid(),
  first_name     text        not null default '',
  last_name      text        not null default '',
  notes          text        not null default '',
  has_screening  boolean     not null default false,
  has_party      boolean     not null default false,
  checked_in     boolean     not null default false,
  checked_in_at  timestamptz,
  checked_in_by  text,
  added_at_door  boolean     not null default false,
  created_at     timestamptz not null default now()
);

-- Any authenticated user can read / update check-in state
alter table public.party_guests enable row level security;

create policy "party_guests_select" on public.party_guests
  for select using (auth.role() = 'authenticated');

create policy "party_guests_insert" on public.party_guests
  for insert with check (auth.role() = 'authenticated');

create policy "party_guests_update" on public.party_guests
  for update using (auth.role() = 'authenticated');

-- Index for fast sorted queries
create index if not exists party_guests_name_idx
  on public.party_guests (last_name, first_name);
