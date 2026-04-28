-- Combine ADIO KERIDA + NANA Y ABUELO back into one double-feature screening
-- at 5/6 7:30 PM, AND switch Wix mapping from single column to array column
-- so one BO screening can receive sold counts from multiple Wix events.
--
-- Run once in Supabase SQL editor. Idempotent.

-- ============================================================
-- 1) Add the new array column + backfill from the singular one
-- ============================================================
alter table public.screenings
  add column if not exists wix_event_ids text[] not null default '{}';

update public.screenings
  set wix_event_ids = array[wix_event_id]
  where wix_event_id is not null
    and (wix_event_ids = '{}' or wix_event_ids is null);

-- ============================================================
-- 2) Combine ADIO KERIDA + NANA Y ABUELO into ONE screening
--    Title: "ADIO KERIDA / NANA Y ABUELO"
--    Time:  5/6 7:30 PM
--    Wix mapping: union of both rows' wix_event_ids
-- ============================================================
do $$
declare adio_id uuid;
declare nana_id uuid;
declare merged_ids text[];
begin
  select id into adio_id
    from public.screenings
    where starts_at = '2026-05-06 18:15-04' and title = 'ADIO KERIDA';

  select id into nana_id
    from public.screenings
    where starts_at = '2026-05-06 19:30-04' and title = 'NANA Y ABUELO';

  -- Already merged on a previous run? skip.
  if exists (
    select 1 from public.screenings
    where starts_at = '2026-05-06 19:30-04' and title = 'ADIO KERIDA / NANA Y ABUELO'
  ) then
    return;
  end if;

  -- Defensive: bail if either row has real sales attached, so we don't lose data.
  if adio_id is not null and exists (select 1 from public.order_lines where screening_id = adio_id) then
    raise exception 'ADIO KERIDA row has order_lines — void them before re-running this migration';
  end if;
  if nana_id is not null and exists (select 1 from public.order_lines where screening_id = nana_id) then
    raise exception 'NANA Y ABUELO row has order_lines — void them before re-running this migration';
  end if;

  -- Compute merged Wix mapping.
  if adio_id is not null and nana_id is not null then
    select coalesce(a.wix_event_ids,'{}') || coalesce(n.wix_event_ids,'{}')
      into merged_ids
      from public.screenings a, public.screenings n
      where a.id = adio_id and n.id = nana_id;
  elsif adio_id is not null then
    select wix_event_ids into merged_ids from public.screenings where id = adio_id;
  elsif nana_id is not null then
    select wix_event_ids into merged_ids from public.screenings where id = nana_id;
  else
    return; -- nothing to do
  end if;

  -- Promote the ADIO row (or NANA row if ADIO is missing) into the combined screening.
  if adio_id is not null then
    update public.screenings
      set title = 'ADIO KERIDA / NANA Y ABUELO',
          starts_at = '2026-05-06 19:30-04',
          wix_event_ids = coalesce(merged_ids, '{}')
      where id = adio_id;

    -- Delete the standalone NANA row (its ticket types cascade away).
    if nana_id is not null then
      delete from public.ticket_types where screening_id = nana_id;
      delete from public.screenings where id = nana_id;
    end if;
  else
    -- Only NANA exists — rename and retime it.
    update public.screenings
      set title = 'ADIO KERIDA / NANA Y ABUELO',
          starts_at = '2026-05-06 19:30-04',
          wix_event_ids = coalesce(merged_ids, '{}')
      where id = nana_id;
  end if;
end $$;

-- ============================================================
-- 3) Drop the old singular wix_event_id column + its index
-- ============================================================
drop index if exists public.screenings_wix_event_id_idx;
alter table public.screenings drop column if exists wix_event_id;
