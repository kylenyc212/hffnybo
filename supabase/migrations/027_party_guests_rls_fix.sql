-- 027_party_guests_rls_fix.sql
-- Fix RLS: the app uses the anon key for all requests (same as every other
-- table in this project). Replace the authenticated-only policies with
-- open anon policies to match the project convention.

drop policy if exists "party_guests_select" on public.party_guests;
drop policy if exists "party_guests_insert" on public.party_guests;
drop policy if exists "party_guests_update" on public.party_guests;

create policy "anon_all" on public.party_guests
  for all to anon using (true) with check (true);
