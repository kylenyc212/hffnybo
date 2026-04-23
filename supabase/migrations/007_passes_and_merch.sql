-- Adds festival-wide items: passes + merch. These aren't tied to a specific
-- screening, so we model them as pseudo-screenings with is_always_available=true.
-- Run once in Supabase SQL editor. Safe to re-run (idempotent via short_code + SKU).

alter table public.screenings
  add column if not exists is_always_available boolean not null default false;

-- Seed the two pseudo-screenings (upsert on short_code)
insert into public.screenings (starts_at, title, capacity, short_code, notes, is_always_available)
values
  ('2026-05-01 00:00:00-04', 'Festival Passes', 99999, 'PASSES', 'Festival-wide passes — not tied to a single screening', true),
  ('2026-05-01 00:01:00-04', 'Merchandise',     99999, 'MERCH',  'Festival merch',                                    true)
on conflict (short_code) where short_code is not null do update
  set is_always_available = true,
      capacity = excluded.capacity,
      notes = excluded.notes;

-- Seed ticket types for Passes
do $$
declare passes_id uuid;
begin
  select id into passes_id from public.screenings where short_code = 'PASSES';
  if passes_id is null then raise exception 'PASSES screening missing'; end if;

  insert into public.ticket_types (screening_id, label, price_cents, category, sort_order, active, heartland_sku)
  values
    (passes_id, 'All Access Pass', 50000, 'paid', 1, true, 'PASS-ALLACCESS'),
    (passes_id, 'YP All Access',   35000, 'paid', 2, true, 'PASS-YPACCESS'),
    (passes_id, 'Cinephone Pass',  20000, 'paid', 3, true, 'PASS-CINEPHONE'),
    (passes_id, 'Weekday Pass',     6000, 'paid', 4, true, 'PASS-WEEKDAY')
  on conflict (heartland_sku) where heartland_sku is not null do update
    set label = excluded.label, price_cents = excluded.price_cents,
        active = excluded.active, sort_order = excluded.sort_order;
end $$;

-- Seed ticket types for Merch
do $$
declare merch_id uuid;
begin
  select id into merch_id from public.screenings where short_code = 'MERCH';
  if merch_id is null then raise exception 'MERCH screening missing'; end if;

  insert into public.ticket_types (screening_id, label, price_cents, category, sort_order, active, heartland_sku)
  values
    (merch_id, 'T-shirt', 2500, 'paid', 1, true, 'MERCH-TSHIRT'),
    (merch_id, 'Tote',    2000, 'paid', 2, true, 'MERCH-TOTE')
  on conflict (heartland_sku) where heartland_sku is not null do update
    set label = excluded.label, price_cents = excluded.price_cents,
        active = excluded.active, sort_order = excluded.sort_order;
end $$;
