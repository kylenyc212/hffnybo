-- Add void support for cash drawer events (cash adds + reimbursement removals
-- + adjustments) and a new "super_admin" role that can hard-delete records
-- after they've been voided (or directly).
--
-- Run once in Supabase SQL editor. Idempotent.

-- ============================================================
-- 1) Soft-void columns on cash_events
-- ============================================================
alter table public.cash_events
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by text,
  add column if not exists void_reason text;

create index if not exists cash_events_voided_idx
  on public.cash_events (voided_at);

-- ============================================================
-- 2) Add 'super_admin' to the users.role check constraint
-- ============================================================
do $$
declare cn text;
begin
  -- Drop any existing role-check constraint by inspecting its definition
  for cn in
    select conname
    from pg_constraint
    where conrelid = 'public.users'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%role%'
  loop
    execute format('alter table public.users drop constraint %I', cn);
  end loop;
end $$;

alter table public.users
  add constraint users_role_check
  check (role in ('cashier', 'admin', 'super_admin'));
