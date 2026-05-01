-- 017_fix_teresita_sku.sql
-- Correct the EL SUENO DE TERESITA GA heartland_sku to exactly match
-- the item name as it appears in the Heartland catalog (including the
-- literal "..." abbreviation and trailing "G" instead of "GA").

update public.ticket_types tt
set heartland_sku = 'EL SUENO DE TERESITA / NOMMAL / LOS U... 5/3 1PM G'
from public.screenings s
where tt.screening_id = s.id
  and s.starts_at = '2026-05-03 13:00-04'
  and tt.label = 'General Admission';
