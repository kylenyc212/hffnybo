-- Adds a new cash_events kind 'add' for mid-shift cash additions (e.g. bringing
-- more small bills from the safe to make change).
-- Run once in Supabase SQL editor. Safe to re-run.

alter table public.cash_events drop constraint if exists cash_events_kind_check;
alter table public.cash_events add constraint cash_events_kind_check
  check (kind in ('open','sale','removal','close','adjustment','add'));
