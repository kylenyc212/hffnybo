-- Align BO seed with the actual Wix product:
--   1. Standardize titles (accents + exact wording from Wix)
--   2. Capacity: opening night = 400, all other festival screenings = 90
--   3. Split "ADIO KERIDA / NANA Y ABUELO" into two screenings (per Wix)
--   4. Mark the panels/showcases free + replace paid ticket types with $0 Free Admission
--
-- Run once in Supabase SQL editor. Idempotent — safe to re-run.

-- ============================================================
-- 1) Title cleanups (match Wix exactly so cashier UI matches the
--    name patrons see on their email tickets)
-- ============================================================
update public.screenings set title = 'AÚN ES DE NOCHE EN CARACAS'
  where starts_at::date = '2026-05-01' and title in ('AUN ES DE NOCHE EN CARACAS','AÚN ES DE NOCHE EN CARACAS');
update public.screenings set title = 'BELÉN'
  where starts_at::date = '2026-05-02' and title in ('BELEN','BELÉN');
update public.screenings set title = 'EL SUEÑO DE TERESITA | NOMMAL | LOS ÚLTIMOS JUDIOS | FABIANA'
  where starts_at::date = '2026-05-03'
    and title in (
      'EL SUEÑO DE TERESITA / NOMMAL / LOS ULTIMOS JUDIOS DE GUANTANAMO / POR FABIANA',
      'EL SUEÑO DE TERESITA | NOMMAL | LOS ÚLTIMOS JUDIOS | FABIANA'
    );
update public.screenings set title = 'EICTV SHOWCASE'
  where starts_at::date = '2026-05-04' and title in ('EICTV SHORTS SHOWCASE','EICTV SHOWCASE');
update public.screenings set title = 'PANEL ON CONTEMPORARY FILMMAKING'
  where starts_at::date = '2026-05-04' and title in ('FILM INDUSTRY PANEL','PANEL ON CONTEMPORARY FILMMAKING');
update public.screenings set title = 'EL EXILIO DE LOS MÚSICOS'
  where starts_at::date = '2026-05-06' and title in ('EL EXILIO DE LOS MUSICOS','EL EXILIO DE LOS MÚSICOS');
update public.screenings set title = 'PARA VIVIR: EL IMPLACABLE TIEMPO DE PABLO MILANÉS'
  where starts_at::date = '2026-05-06'
    and title in ('PARA VIVIR: EL IMPLACABLE TIEMPO DE PABLO MILANES','PARA VIVIR: EL IMPLACABLE TIEMPO DE PABLO MILANÉS');
update public.screenings set title = 'FUC SHOWCASE'
  where starts_at::date = '2026-05-07' and title in ('FUC SHORT SHOWCASE','FUC SHOWCASE');
update public.screenings set title = 'MI SUEÑO CUBANO - 6:00 PM'
  where starts_at = '2026-05-07 18:00-04' and title in ('MI SUEÑO CUBANO','MI SUEÑO CUBANO - 6:00 PM');
update public.screenings set title = 'MI SUEÑO CUBANO - 8:45 PM (ENCORE SCREENING)'
  where starts_at = '2026-05-07 20:45-04'
    and title in ('MI SUEÑO CUBANO – ENCORE SCREENING','MI SUEÑO CUBANO - 8:45 PM (ENCORE SCREENING)');

-- ============================================================
-- 2) Capacity: opening night = 400, other festival screenings = 90
--    (PASSES/MERCH pseudo-screenings keep their 99999 capacity)
-- ============================================================
update public.screenings set capacity = 400
  where starts_at::date = '2026-05-01'
    and is_always_available = false;

update public.screenings set capacity = 90
  where starts_at::date between '2026-05-02' and '2026-05-07'
    and is_always_available = false;

-- ============================================================
-- 3) Split ADIO KERIDA / NANA Y ABUELO into two screenings
--    (Wix sells them as separate events with separate ticket counts)
-- ============================================================
-- 3a) Rename the existing combined row to just "ADIO KERIDA"
update public.screenings
  set title = 'ADIO KERIDA'
  where starts_at = '2026-05-06 18:15-04'
    and title = 'ADIO KERIDA / NANA Y ABUELO';

-- 3b) Insert NANA Y ABUELO at 19:30 + copy ticket types from ADIO KERIDA
do $$
declare adio_id uuid;
declare nana_id uuid;
begin
  select id into adio_id
    from public.screenings
    where starts_at = '2026-05-06 18:15-04' and title = 'ADIO KERIDA'
    limit 1;
  if adio_id is null then
    raise notice 'ADIO KERIDA row not found at 2026-05-06 18:15 — skipping NANA split';
    return;
  end if;

  -- Skip if NANA already exists
  select id into nana_id
    from public.screenings
    where starts_at = '2026-05-06 19:30-04' and title = 'NANA Y ABUELO'
    limit 1;
  if nana_id is not null then
    return; -- migration was already applied
  end if;

  insert into public.screenings (starts_at, title, capacity)
  values ('2026-05-06 19:30-04', 'NANA Y ABUELO', 90)
  returning id into nana_id;

  -- Copy the ticket types (GA, S/S, comps, other) from ADIO KERIDA.
  -- We only copy non-Heartland-SKU rows here; SKUs need to be regenerated
  -- via Admin → Heartland → "Generate short codes + SKUs" to be unique.
  insert into public.ticket_types (screening_id, label, price_cents, category, comp_category, sort_order, active)
  select nana_id, label, price_cents, category, comp_category, sort_order, active
  from public.ticket_types
  where screening_id = adio_id;
end $$;

-- ============================================================
-- 4) Free events: panels + showcases that Wix lists at $0
--    Mark is_free=true, deactivate paid ticket types, add Free Admission
-- ============================================================
do $$
declare s_id uuid;
declare t text;
declare titles text[] := array[
  'EICTV SHOWCASE',
  'FUC SHOWCASE',
  'PANEL LATINO JEWISH FILMMAKING',
  'PANEL ON CONTEMPORARY FILMMAKING'
];
begin
  foreach t in array titles loop
    select id into s_id from public.screenings where title = t limit 1;
    if s_id is null then
      raise notice 'Screening "%" not found — skipping free-event setup', t;
      continue;
    end if;

    update public.screenings set is_free = true where id = s_id and is_free = false;

    -- Deactivate (don't delete — order_lines may reference) the paid types.
    update public.ticket_types
      set active = false
      where screening_id = s_id
        and label in ('General Admission', 'Student/Senior')
        and active = true;

    -- Add a single Free Admission $0 type if not already present.
    if not exists (
      select 1 from public.ticket_types
      where screening_id = s_id and label = 'Free Admission'
    ) then
      insert into public.ticket_types
        (screening_id, label, price_cents, category, comp_category, sort_order, active)
      values
        (s_id, 'Free Admission', 0, 'other', null, 1, true);
    end if;
  end loop;
end $$;
