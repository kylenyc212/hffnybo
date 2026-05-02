-- 019_encore_ticket_types.sql
-- The MI SUEÑO CUBANO 8:45 PM encore screening has no ticket types because
-- its starts_at (2026-05-07 20:45-04 = 2026-05-08 00:45 UTC) falls outside
-- the seed's `::date between '2026-05-02' and '2026-05-07'` UTC window.
-- This migration adds the standard paid + comp + other types manually.
-- Safe to re-run (on conflict do nothing).

do $$
declare
  enc_id uuid;
begin
  select id into enc_id
    from public.screenings
    where starts_at = '2026-05-07 20:45-04'
      and is_always_available = false
    limit 1;

  if enc_id is null then
    raise notice 'Encore screening not found — skipping';
    return;
  end if;

  insert into public.ticket_types
    (screening_id, label, price_cents, category, comp_category, sort_order, active)
  values
    (enc_id, 'General Admission', 1500, 'paid',  null,          1,  true),
    (enc_id, 'Student/Senior',    1000, 'paid',  null,          2,  true),
    (enc_id, 'Comp — Press',         0, 'comp',  'press',       10, true),
    (enc_id, 'Comp — Pass Holder',   0, 'comp',  'pass_holder', 11, true),
    (enc_id, 'Comp — Industry',      0, 'comp',  'industry',    12, true),
    (enc_id, 'Other (custom)',        0, 'other', null,          99, true)
  on conflict do nothing;
end $$;
