-- Wix Events sync: link box-office screenings to their Wix counterparts so
-- a server-side cron can pull `summaries.tickets.ticketsSold` and write it
-- into `screenings.online_sold` to prevent overselling.
--
-- One-way sync (Wix → BO). Manual mapping is set via the admin UI.
-- Run once in Supabase SQL editor. Safe to re-run.

alter table public.screenings
  add column if not exists wix_event_id text;

create unique index if not exists screenings_wix_event_id_idx
  on public.screenings (wix_event_id) where wix_event_id is not null;

-- Track when each screening was last refreshed from Wix. NULL means never.
alter table public.screenings
  add column if not exists wix_synced_at timestamptz;
