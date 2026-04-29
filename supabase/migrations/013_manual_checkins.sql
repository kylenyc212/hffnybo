-- Anonymous door check-in taps: one row per +1 press.
-- Used when staff checks someone in without scanning a Wix ticket
-- (e.g., cash sale, CC on Heartland, or walk-in not in the system).
-- Run once in Supabase SQL editor. Idempotent.

create table if not exists public.manual_checkins (
  id            uuid        primary key default gen_random_uuid(),
  screening_id  uuid        not null references public.screenings(id),
  checked_in_at timestamptz not null default now(),
  checked_in_by text        not null default '',
  qty           integer     not null default 1
);

create index if not exists manual_checkins_screening_idx
  on public.manual_checkins (screening_id);
