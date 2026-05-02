-- 020_free_screening_ga.sql
-- Free screenings (is_free = true) had no paid ticket types, so only
-- "Other / Custom…" and comp buttons appeared. This adds a single
-- "General Admission" at $0 to every free screening that lacks one.
-- No Student/Senior — a discount ticket is meaningless on a free event.
-- Safe to re-run (on conflict do nothing).

insert into public.ticket_types
  (screening_id, label, price_cents, category, comp_category, sort_order, active)
select
  s.id,
  'General Admission',
  0,
  'paid',
  null,
  1,
  true
from public.screenings s
where s.is_free            = true
  and s.is_always_available = false
  and not exists (
    select 1 from public.ticket_types tt
    where tt.screening_id = s.id
      and tt.category     = 'paid'
      and tt.label        = 'General Admission'
  )
on conflict do nothing;
