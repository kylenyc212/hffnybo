-- 016_heartland_skus.sql
-- Set heartland_sku to the EXACT item name as it appears in the Heartland catalog.
-- Matched by starts_at timestamp (stable) so title changes / accent fixes don't matter.
-- The OCR matcher checks heartland_sku first (exact string) and bypasses all fuzzy logic.
-- Safe to re-run (overwrites existing values).

-- ── 5/1 OPENING NIGHT (AÚN ES DE NOCHE EN CARACAS) ───────────────────────
update public.ticket_types tt set heartland_sku = 'AUN ES DE NOCHE EN CARACAS 5/1 6PM GA'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-01 18:00-04' and tt.label = 'General Admission';

update public.ticket_types tt set heartland_sku = 'AUN ES DE NOCHE EN CARACAS 5/1 6PM SS'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-01 18:00-04' and tt.label = 'Student/Senior';

update public.ticket_types tt set heartland_sku = 'AUN ES DE NOCHE EN CARACAS 5/1 6PM Party'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-01 18:00-04' and tt.label = 'Party + Screening';

-- ── 5/2 CIRCE 1PM ────────────────────────────────────────────────────────
update public.ticket_types tt set heartland_sku = 'CIRCE 5/2 1PM GA'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-02 13:00-04' and tt.label = 'General Admission';

update public.ticket_types tt set heartland_sku = 'CIRCE 5/2 1PM SS'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-02 13:00-04' and tt.label = 'Student/Senior';

-- ── 5/2 LA HIJA CONDOR 2:45PM ─────────────────────────────────────────────
update public.ticket_types tt set heartland_sku = 'LA HIJA CONDOR 5/2 2:45PM GA'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-02 14:45-04' and tt.label = 'General Admission';

update public.ticket_types tt set heartland_sku = 'LA HIJA CONDOR 5/2 2:45PM SS'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-02 14:45-04' and tt.label = 'Student/Senior';

-- ── 5/2 BELEN 4:45PM ──────────────────────────────────────────────────────
update public.ticket_types tt set heartland_sku = 'BELEN 5/2 4:45PM GA'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-02 16:45-04' and tt.label = 'General Admission';

update public.ticket_types tt set heartland_sku = 'BELEN 5/2 4:45PM SS'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-02 16:45-04' and tt.label = 'Student/Senior';

-- ── 5/2 VIDAS EN LA ORILLA 6:45PM ─────────────────────────────────────────
update public.ticket_types tt set heartland_sku = 'VIDAS EN LA ORILLA 5/2 6:45PM GA'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-02 18:45-04' and tt.label = 'General Admission';

update public.ticket_types tt set heartland_sku = 'VIDAS EN LA ORILLA 5/2 6:45PM SS'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-02 18:45-04' and tt.label = 'Student/Senior';

-- ── 5/2 HAVANA COYOTES 8:45PM ─────────────────────────────────────────────
update public.ticket_types tt set heartland_sku = 'HAVANA COYOTES 5/2 8:45PM GA'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-02 20:45-04' and tt.label = 'General Admission';

update public.ticket_types tt set heartland_sku = 'HAVANA COYOTES 5/2 8:45PM SS'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-02 20:45-04' and tt.label = 'Student/Senior';

-- ── 5/3 EL SUENO DE TERESITA / NOMMAL / … 1PM ────────────────────────────
-- Note: Heartland web UI truncates the GA item name. The SS item name is shorter
-- by design ("EL SUENO DE TERESITA / NOMMAL 5/3 1PM SS"). Both are stored here;
-- if a printed receipt shows a different GA name, update heartland_sku accordingly.
update public.ticket_types tt set heartland_sku = 'EL SUENO DE TERESITA / NOMMAL / LOS ULTIMOS JUDIOS 5/3 1PM GA'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-03 13:00-04' and tt.label = 'General Admission';

update public.ticket_types tt set heartland_sku = 'EL SUENO DE TERESITA / NOMMAL 5/3 1PM SS'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-03 13:00-04' and tt.label = 'Student/Senior';

-- ── 5/3 EL PANTERA 2:45PM ─────────────────────────────────────────────────
update public.ticket_types tt set heartland_sku = 'EL PANTERA 5/3 2:45PM GA'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-03 14:45-04' and tt.label = 'General Admission';

update public.ticket_types tt set heartland_sku = 'EL PANTERA 5/3 2:45PM SS'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-03 14:45-04' and tt.label = 'Student/Senior';

-- ── 5/3 BARACOA 4:30PM ────────────────────────────────────────────────────
update public.ticket_types tt set heartland_sku = 'BARACOA 5/3 4:30PM GA'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-03 16:30-04' and tt.label = 'General Admission';

update public.ticket_types tt set heartland_sku = 'BARACOA 5/3 4:30PM SS'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-03 16:30-04' and tt.label = 'Student/Senior';

-- ── 5/3 EL REGRESADO 6:45PM ───────────────────────────────────────────────
update public.ticket_types tt set heartland_sku = 'EL REGRESADO 5/3 6:45PM GA'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-03 18:45-04' and tt.label = 'General Admission';

update public.ticket_types tt set heartland_sku = 'EL REGRESADO 5/3 6:45PM SS'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-03 18:45-04' and tt.label = 'Student/Senior';

-- ── 5/3 LA MISTERIOSA MIRADA DEL FLAMENCO 8:45PM ─────────────────────────
update public.ticket_types tt set heartland_sku = 'LA MISTERIOSA MIRADA DEL FLAMENCO 5/3 8:45PM GA'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-03 20:45-04' and tt.label = 'General Admission';

update public.ticket_types tt set heartland_sku = 'LA MISTERIOSA MIRADA DEL FLAMENCO 5/3 8:45PM SS'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-03 20:45-04' and tt.label = 'Student/Senior';

-- ── 5/4 EICTV SHORTS SHOWCASE 1PM ─────────────────────────────────────────
update public.ticket_types tt set heartland_sku = 'EICTV SHORTS SHOWCASE 5/4 1PM GA'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-04 13:00-04' and tt.label = 'General Admission';

update public.ticket_types tt set heartland_sku = 'EICTV SHORTS SHOWCASE 5/4 1PM SS'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-04 13:00-04' and tt.label = 'Student/Senior';

-- ── 5/4 LAS DOS MARIETTE 2:45PM ───────────────────────────────────────────
update public.ticket_types tt set heartland_sku = 'LAS DOS MARIETTE 5/4 2:45PM GA'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-04 14:45-04' and tt.label = 'General Admission';

update public.ticket_types tt set heartland_sku = 'LAS DOS MARIETTE 5/4 2:45PM SS'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-04 14:45-04' and tt.label = 'Student/Senior';

-- ── 5/4 UM LOBO ENTRE OS CISNES 4:30PM ───────────────────────────────────
update public.ticket_types tt set heartland_sku = 'UM LOBO ENTRE OS CISNES 5/4 4:30PM GA'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-04 16:30-04' and tt.label = 'General Admission';

update public.ticket_types tt set heartland_sku = 'UM LOBO ENTRE OS CISNES 5/4 4:30PM SS'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-04 16:30-04' and tt.label = 'Student/Senior';

-- ── 5/4 FILM INDUSTRY PANEL 6PM ───────────────────────────────────────────
update public.ticket_types tt set heartland_sku = 'FILM INDUSTRY PANEL 5/4 6PM GA'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-04 18:00-04' and tt.label = 'General Admission';

update public.ticket_types tt set heartland_sku = 'FILM INDUSTRY PANEL 5/4 6PM SS'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-04 18:00-04' and tt.label = 'Student/Senior';

-- ── 5/4 NEUROTICA ANONIMA 7PM ─────────────────────────────────────────────
update public.ticket_types tt set heartland_sku = 'NEUROTICA ANONIMA 5/4 7PM GA'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-04 19:00-04' and tt.label = 'General Admission';

update public.ticket_types tt set heartland_sku = 'NEUROTICA ANONIMA 5/4 7PM SS'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-04 19:00-04' and tt.label = 'Student/Senior';

-- ── 5/4 IMPRINTED 9PM ─────────────────────────────────────────────────────
update public.ticket_types tt set heartland_sku = 'IMPRINTED 5/4 9PM GA'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-04 21:00-04' and tt.label = 'General Admission';

update public.ticket_types tt set heartland_sku = 'IMPRINTED 5/4 9PM SS'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-04 21:00-04' and tt.label = 'Student/Senior';

-- ── 5/5 VIRGINIA E ADELAIDE 1PM ───────────────────────────────────────────
update public.ticket_types tt set heartland_sku = 'VIRGINIA E ADELAIDE 5/5 1PM GA'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-05 13:00-04' and tt.label = 'General Admission';

update public.ticket_types tt set heartland_sku = 'VIRGINIA E ADELAIDE 5/5 1PM SS'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-05 13:00-04' and tt.label = 'Student/Senior';

-- ── 5/5 HIEDRA 3PM ────────────────────────────────────────────────────────
update public.ticket_types tt set heartland_sku = 'HIEDRA 5/5 3PM GA'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-05 15:00-04' and tt.label = 'General Admission';

update public.ticket_types tt set heartland_sku = 'HIEDRA 5/5 3PM SS'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-05 15:00-04' and tt.label = 'Student/Senior';

-- ── 5/5 TORAH TROPICAL 5PM ────────────────────────────────────────────────
update public.ticket_types tt set heartland_sku = 'TORAH TROPICAL 5/5 5PM GA'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-05 17:00-04' and tt.label = 'General Admission';

update public.ticket_types tt set heartland_sku = 'TORAH TROPICAL 5/5 5PM SS'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-05 17:00-04' and tt.label = 'Student/Senior';

-- ── 5/5 ADIOS AL AMIGO 7:15PM ─────────────────────────────────────────────
update public.ticket_types tt set heartland_sku = 'ADIOS AL AMIGO 5/5 7:15PM GA'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-05 19:15-04' and tt.label = 'General Admission';

update public.ticket_types tt set heartland_sku = 'ADIOS AL AMIGO 5/5 7:15PM SS'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-05 19:15-04' and tt.label = 'Student/Senior';

-- ── 5/5 BAJO EL MISMO SOL 9PM ─────────────────────────────────────────────
update public.ticket_types tt set heartland_sku = 'BAJO EL MISMO SOL 5/5 9PM GA'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-05 21:00-04' and tt.label = 'General Admission';

update public.ticket_types tt set heartland_sku = 'BAJO EL MISMO SOL 5/5 9PM SS'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-05 21:00-04' and tt.label = 'Student/Senior';

-- ── 5/6 EL EXILIO DE LOS MUSICOS 1PM ──────────────────────────────────────
update public.ticket_types tt set heartland_sku = 'EL EXILIO DE LOS MUSICOS 5/6 1PM GA'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-06 13:00-04' and tt.label = 'General Admission';

update public.ticket_types tt set heartland_sku = 'EL EXILIO DE LOS MUSICOS 5/6 1PM SS'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-06 13:00-04' and tt.label = 'Student/Senior';

-- ── 5/6 UN CABO SUELTO 3PM ────────────────────────────────────────────────
update public.ticket_types tt set heartland_sku = 'UN CABO SUELTO 5/6 3PM GA'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-06 15:00-04' and tt.label = 'General Admission';

update public.ticket_types tt set heartland_sku = 'UN CABO SUELTO 5/6 3PM SS'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-06 15:00-04' and tt.label = 'Student/Senior';

-- ── 5/6 PANEL LATINO JEWISH FILMMAKING 5PM ────────────────────────────────
update public.ticket_types tt set heartland_sku = 'PANEL LATINO JEWISH FILMMAKING 5/6 5PM GA'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-06 17:00-04' and tt.label = 'General Admission';

update public.ticket_types tt set heartland_sku = 'PANEL LATINO JEWISH FILMMAKING 5/6 5PM SS'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-06 17:00-04' and tt.label = 'Student/Senior';

-- ── 5/6 ADIO KERIDA / NANA Y ABUELO 6:15PM ───────────────────────────────
update public.ticket_types tt set heartland_sku = 'ADIO KERIDA / NANA Y ABUELO 5/6 6:15PM GA'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-06 18:15-04' and tt.label = 'General Admission';

update public.ticket_types tt set heartland_sku = 'ADIO KERIDA / NANA Y ABUELO 5/6 6:15PM SS'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-06 18:15-04' and tt.label = 'Student/Senior';

-- ── 5/6 PARA VIVIR: EL IMPLACABLE TIEMPO 8:30PM ───────────────────────────
update public.ticket_types tt set heartland_sku = 'PARA VIVIR: EL IMPLACABLE TIEMPO 5/6 8:30PM GA'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-06 20:30-04' and tt.label = 'General Admission';

update public.ticket_types tt set heartland_sku = 'PARA VIVIR: EL IMPLACABLE TIEMPO 5/6 8:30PM SS'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-06 20:30-04' and tt.label = 'Student/Senior';

-- ── 5/7 FUC SHORT SHOWCASE 1PM ────────────────────────────────────────────
update public.ticket_types tt set heartland_sku = 'FUC SHORT SHOWCASE 5/7 1PM GA'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-07 13:00-04' and tt.label = 'General Admission';

update public.ticket_types tt set heartland_sku = 'FUC SHORT SHOWCASE 5/7 1PM SS'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-07 13:00-04' and tt.label = 'Student/Senior';

-- ── 5/7 NOVIEMBRE 3PM ─────────────────────────────────────────────────────
update public.ticket_types tt set heartland_sku = 'NOVIEMBRE 5/7 3PM GA'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-07 15:00-04' and tt.label = 'General Admission';

update public.ticket_types tt set heartland_sku = 'NOVIEMBRE 5/7 3PM SS'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-07 15:00-04' and tt.label = 'Student/Senior';

-- ── 5/7 MI SUENO CUBANO 6PM ───────────────────────────────────────────────
update public.ticket_types tt set heartland_sku = 'MI SUENO CUBANO 5/7 6PM GA'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-07 18:00-04' and tt.label = 'General Admission';

update public.ticket_types tt set heartland_sku = 'MI SUENO CUBANO 5/7 6PM SS'
  from public.screenings s
  where tt.screening_id = s.id and s.starts_at = '2026-05-07 18:00-04' and tt.label = 'Student/Senior';

-- ── 5/7 MI SUENO CUBANO ENCORE 8:45PM ────────────────────────────────────
-- No Heartland item exists for the encore screening; leave heartland_sku null.
