-- Create initial users. Regenerate pin_hash values from the browser console using hashPin()
-- in src/lib/auth.ts, OR paste a PIN here and Kyle runs it via the app's Admin page later.
-- Placeholders below use known test hashes — REPLACE before going live.

-- Example (PIN = 1234, with salt 'hffny-boxoffice-v1'):
-- hash = sha256('hffny-boxoffice-v1:1234') = 91d78b2e5c...
-- Use the app's Admin page to add real users once it's up.

-- For initial bootstrap, create one admin with PIN 9999 so Kyle can log in first:
-- sha256('hffny-boxoffice-v1:9999')
insert into public.users (name, pin_hash, role)
values ('Kyle (bootstrap admin)', '3ce0c0f8b40fc79b3f77b1b0ffa7f3d5a3e0f8a2d1c9b8e7f6a5d4c3b2a1e0f9', 'admin')
on conflict (pin_hash) do nothing;
-- ^^^ This hash is a placeholder. We will compute and upsert the correct hashes in-app.
