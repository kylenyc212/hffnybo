-- Adds denomination breakdown columns to cash_drawers.
-- Run once in Supabase SQL editor. Safe to re-run.

alter table public.cash_drawers
  add column if not exists opening_denoms jsonb,
  add column if not exists closing_denoms jsonb;
