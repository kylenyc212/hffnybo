-- Adds optional customer-contact fields to orders. All nullable — nothing required.
-- Run once in Supabase SQL editor. Safe to re-run.

alter table public.orders
  add column if not exists customer_name text,
  add column if not exists customer_email text,
  add column if not exists customer_phone text,
  add column if not exists customer_address text;
