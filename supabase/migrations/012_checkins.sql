-- Door check-in tracking: in-person tickets + Wix QR scans
-- Run once in Supabase SQL editor. Idempotent.

-- ── In-person: add check-in columns to order_lines ──────────────────
alter table public.order_lines
  add column if not exists checked_in_at  timestamptz,
  add column if not exists checked_in_by  text;

create index if not exists order_lines_checkin_idx
  on public.order_lines (screening_id, checked_in_at)
  where checked_in_at is not null;

-- ── Wix door scans: one row per unique ticket_number ────────────────
create table if not exists public.wix_checkins (
  id            uuid        primary key default gen_random_uuid(),
  ticket_number text        not null,
  wix_event_id  text        not null,
  screening_id  uuid        references public.screenings(id),
  checked_in_at timestamptz not null default now(),
  checked_in_by text        not null default '',
  guest_name    text,
  ticket_type   text,
  constraint wix_checkins_ticket_unique unique (ticket_number)
);
