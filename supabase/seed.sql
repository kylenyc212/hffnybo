-- Seed the May 1-7 screening schedule + default ticket types per screening.
-- Run AFTER schema.sql. Safe to re-run: uses a delete-then-insert pattern on screenings
-- matching the initial window (2026-05-01 to 2026-05-07).

-- Timezone assumption: America/New_York. Store as timestamptz.
-- All prices in cents.

-- Clear any prior seeded data in the festival window.
delete from public.order_lines
  where screening_id in (
    select id from public.screenings where starts_at::date between '2026-05-01' and '2026-05-07'
  );
delete from public.ticket_types
  where screening_id in (
    select id from public.screenings where starts_at::date between '2026-05-01' and '2026-05-07'
  );
delete from public.screenings
  where starts_at::date between '2026-05-01' and '2026-05-07';

-- Insert screenings
insert into public.screenings (starts_at, title, capacity) values
  ('2026-05-01 18:00-04', 'AUN ES DE NOCHE EN CARACAS', 200),
  ('2026-05-02 13:00-04', 'CIRCE', 200),
  ('2026-05-02 14:45-04', 'LA HIJA CONDOR', 200),
  ('2026-05-02 16:45-04', 'BELEN', 200),
  ('2026-05-02 18:45-04', 'VIDAS EN LA ORILLA', 200),
  ('2026-05-02 20:45-04', 'HAVANA COYOTES', 200),
  ('2026-05-03 13:00-04', 'EL SUEÑO DE TERESITA / NOMMAL / LOS ULTIMOS JUDIOS DE GUANTANAMO / POR FABIANA', 200),
  ('2026-05-03 14:45-04', 'EL PANTERA', 200),
  ('2026-05-03 16:30-04', 'BARACOA', 200),
  ('2026-05-03 18:45-04', 'EL REGRESADO', 200),
  ('2026-05-03 20:45-04', 'LA MISTERIOSA MIRADA DEL FLAMENCO', 200),
  ('2026-05-04 13:00-04', 'EICTV SHORTS SHOWCASE', 200),
  ('2026-05-04 14:45-04', 'LAS DOS MARIETTE', 200),
  ('2026-05-04 16:30-04', 'UM LOBO ENTRE OS CISNES', 200),
  ('2026-05-04 18:00-04', 'FILM INDUSTRY PANEL', 200),
  ('2026-05-04 19:00-04', 'NEUROTICA ANONIMA', 200),
  ('2026-05-04 21:00-04', 'IMPRINTED', 200),
  ('2026-05-05 13:00-04', 'VIRGINIA E ADELAIDE', 200),
  ('2026-05-05 15:00-04', 'HIEDRA', 200),
  ('2026-05-05 17:00-04', 'TORAH TROPICAL', 200),
  ('2026-05-05 19:15-04', 'ADIOS AL AMIGO', 200),
  ('2026-05-05 21:00-04', 'BAJO EL MISMO SOL', 200),
  ('2026-05-06 13:00-04', 'EL EXILIO DE LOS MUSICOS', 200),
  ('2026-05-06 15:00-04', 'UN CABO SUELTO', 200),
  ('2026-05-06 17:00-04', 'PANEL LATINO JEWISH FILMMAKING', 200),
  ('2026-05-06 18:15-04', 'ADIO KERIDA / NANA Y ABUELO', 200),
  ('2026-05-06 20:30-04', 'PARA VIVIR: EL IMPLACABLE TIEMPO DE PABLO MILANES', 200),
  ('2026-05-07 13:00-04', 'FUC SHORT SHOWCASE', 200),
  ('2026-05-07 15:00-04', 'NOVIEMBRE', 200),
  ('2026-05-07 18:00-04', 'MI SUEÑO CUBANO', 200),
  ('2026-05-07 20:45-04', 'MI SUEÑO CUBANO – ENCORE SCREENING', 200);

-- Default ticket types for every non-Opening-Night screening: $16 GA / $12 S/S + comps + other
insert into public.ticket_types (screening_id, label, price_cents, category, comp_category, sort_order)
select s.id, 'General Admission', 1600, 'paid', null, 1 from public.screenings s
  where s.starts_at::date between '2026-05-02' and '2026-05-07';
insert into public.ticket_types (screening_id, label, price_cents, category, comp_category, sort_order)
select s.id, 'Student/Senior', 1200, 'paid', null, 2 from public.screenings s
  where s.starts_at::date between '2026-05-02' and '2026-05-07';
insert into public.ticket_types (screening_id, label, price_cents, category, comp_category, sort_order)
select s.id, 'Comp — Press', 0, 'comp', 'press', 10 from public.screenings s
  where s.starts_at::date between '2026-05-02' and '2026-05-07';
insert into public.ticket_types (screening_id, label, price_cents, category, comp_category, sort_order)
select s.id, 'Comp — Pass Holder', 0, 'comp', 'pass_holder', 11 from public.screenings s
  where s.starts_at::date between '2026-05-02' and '2026-05-07';
insert into public.ticket_types (screening_id, label, price_cents, category, comp_category, sort_order)
select s.id, 'Comp — Industry', 0, 'comp', 'industry', 12 from public.screenings s
  where s.starts_at::date between '2026-05-02' and '2026-05-07';
insert into public.ticket_types (screening_id, label, price_cents, category, comp_category, sort_order)
select s.id, 'Other (custom)', 0, 'other', null, 99 from public.screenings s
  where s.starts_at::date between '2026-05-02' and '2026-05-07';

-- Opening Night (5/1) overrides: GA $20 / S/S $15 / Party + Screening $180 + comps + other
insert into public.ticket_types (screening_id, label, price_cents, category, comp_category, sort_order)
select s.id, 'General Admission', 2000, 'paid', null, 1 from public.screenings s
  where s.starts_at::date = '2026-05-01';
insert into public.ticket_types (screening_id, label, price_cents, category, comp_category, sort_order)
select s.id, 'Student/Senior', 1500, 'paid', null, 2 from public.screenings s
  where s.starts_at::date = '2026-05-01';
insert into public.ticket_types (screening_id, label, price_cents, category, comp_category, sort_order)
select s.id, 'Party + Screening', 18000, 'paid', null, 3 from public.screenings s
  where s.starts_at::date = '2026-05-01';
insert into public.ticket_types (screening_id, label, price_cents, category, comp_category, sort_order)
select s.id, 'Comp — Press', 0, 'comp', 'press', 10 from public.screenings s
  where s.starts_at::date = '2026-05-01';
insert into public.ticket_types (screening_id, label, price_cents, category, comp_category, sort_order)
select s.id, 'Comp — Pass Holder', 0, 'comp', 'pass_holder', 11 from public.screenings s
  where s.starts_at::date = '2026-05-01';
insert into public.ticket_types (screening_id, label, price_cents, category, comp_category, sort_order)
select s.id, 'Comp — Industry', 0, 'comp', 'industry', 12 from public.screenings s
  where s.starts_at::date = '2026-05-01';
insert into public.ticket_types (screening_id, label, price_cents, category, comp_category, sort_order)
select s.id, 'Other (custom)', 0, 'other', null, 99 from public.screenings s
  where s.starts_at::date = '2026-05-01';
