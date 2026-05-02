-- Allow individual order_lines to be soft-voided (partial refunds)
alter table public.order_lines
  add column if not exists voided_at  timestamptz,
  add column if not exists voided_by  text;
