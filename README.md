# HFFNY Box Office

Custom box office app for HFFNY festival (May 1–7, 2026). iPad-first PWA. Comps + cash sales only, no CC processing.

See [ROADMAP.md](ROADMAP.md) for scope, decisions, and open items.

## Stack
- Vite + React + TypeScript + TailwindCSS (PWA)
- Supabase (Postgres + auth + backups)
- Vercel (hosting)
- `@zxing/browser` for pass barcode scanning

## Local dev
```bash
cp .env.example .env.local   # then fill in VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

Open http://localhost:5173 (or the LAN URL it prints, to test from iPad on same wifi).

## Database setup
1. Open your Supabase project → SQL editor.
2. Paste and run [supabase/schema.sql](supabase/schema.sql).
3. Paste and run [supabase/seed.sql](supabase/seed.sql) (creates all May 1–7 screenings + default ticket types).
4. Bootstrap your admin PIN: open the app locally, it'll prompt you to create the first admin if `users` table is empty. (TODO — until that exists, use the Admin page once deployed.)

## Deploy
- Push to GitHub → connect repo in Vercel → add env vars `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` → deploy.

## Safety
- The Supabase anon key is safe to embed in the client because Row-Level Security (RLS) is enabled on every table.
- **Never commit `.env.local`**. It's in `.gitignore`.
- **Never paste the Supabase service_role key anywhere in this repo** — it bypasses RLS.
