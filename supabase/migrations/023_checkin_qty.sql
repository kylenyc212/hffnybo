-- Per-ticket check-in granularity.
-- Adds checked_in_qty so cashiers can tap +1 per person instead of
-- marking the whole line (qty N) as checked in at once.
-- checked_in_at / checked_in_by are kept: they record the first check-in time.
-- Run once in Supabase SQL editor.

alter table public.order_lines
  add column if not exists checked_in_qty integer not null default 0;

-- Back-fill: lines already marked as fully checked in get qty.
update public.order_lines
  set checked_in_qty = qty
  where checked_in_at is not null and checked_in_qty = 0;
