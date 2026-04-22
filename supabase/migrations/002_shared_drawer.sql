-- Switch cash drawer from per-device to one-shared-across-all-devices.
-- Run once in Supabase SQL editor. Safe to re-run.

-- Drop the old per-device partial unique index.
drop index if exists public.cash_drawers_one_open_per_device;

-- Create a global partial unique index. The `((true))` expression means
-- only one row with closed_at IS NULL can exist in the whole table.
create unique index if not exists cash_drawers_one_open_shift
  on public.cash_drawers ((true)) where closed_at is null;
