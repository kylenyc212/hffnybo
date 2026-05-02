-- 018_merch_comps.sql
-- Add comp ticket types for T-shirt and Tote to the Merchandise screening.
-- Safe to re-run (on conflict do nothing).

do $$
declare
  merch_id uuid;
begin
  select id into merch_id from public.screenings where short_code = 'MERCH';
  if merch_id is null then raise exception 'MERCH screening not found'; end if;

  insert into public.ticket_types
    (screening_id, label, price_cents, category, comp_category, sort_order, active)
  values
    (merch_id, 'Comp — T-shirt', 0, 'comp', null, 10, true),
    (merch_id, 'Comp — Tote',    0, 'comp', null, 11, true)
  on conflict do nothing;
end $$;
