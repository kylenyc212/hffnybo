-- 024_encore_heartland_skus.sql
-- Set Heartland SKUs for the MI SUENO CUBANO 8:45 PM encore screening (5/7).
-- Inventory names to create in Heartland: "MI SUENO CUBANO 5/7 8:45PM GA"
-- and "MI SUENO CUBANO 5/7 8:45PM SS", both priced at $15 and $10 respectively.

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
    raise notice 'Encore 8:45PM screening not found — skipping';
    return;
  end if;

  update public.ticket_types
    set heartland_sku = 'MI SUENO CUBANO 5/7 8:45PM GA'
    where screening_id = enc_id
      and label = 'General Admission';

  update public.ticket_types
    set heartland_sku = 'MI SUENO CUBANO 5/7 8:45PM SS'
    where screening_id = enc_id
      and label = 'Student/Senior';
end $$;
