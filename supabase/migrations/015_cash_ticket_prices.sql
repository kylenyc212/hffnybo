-- 015_cash_ticket_prices.sql
-- Lower festival (non-Opening-Night) paid ticket prices to cash amounts:
--   General Admission  $16 → $15  (1600 → 1500 cents)
--   Student/Senior     $12 → $10  (1200 → 1000 cents)
-- Opening Night (2026-05-01) prices are left unchanged.
-- Safe to re-run.

update public.ticket_types tt
set price_cents = 1500
from public.screenings s
where tt.screening_id = s.id
  and tt.label = 'General Admission'
  and tt.price_cents = 1600
  and s.starts_at::date between '2026-05-02' and '2026-05-07';

update public.ticket_types tt
set price_cents = 1000
from public.screenings s
where tt.screening_id = s.id
  and tt.label = 'Student/Senior'
  and tt.price_cents = 1200
  and s.starts_at::date between '2026-05-02' and '2026-05-07';
