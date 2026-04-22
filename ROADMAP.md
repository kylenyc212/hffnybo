# HFFNY Box Office — Roadmap

Living doc. Updated as decisions land.

## Timeline
- **Today:** 2026-04-22
- **Festival opens:** 2026-05-01 (9 days out)
- **Target soft-launch for staff testing:** 2026-04-29
- **Go-live:** 2026-05-01 6:00 PM (Opening Night)

## Locked decisions
- **Stack:** Vite + React + TypeScript + TailwindCSS (PWA, add-to-home-screen on iPad)
- **Backend:** Supabase (Postgres + auth + row-level security + daily backups; free tier)
- **Hosting:** Vercel (free tier, custom subdomain)
- **Barcode scanner:** `@zxing/browser` via iPad camera
- **Auth:** Shared PIN per device; "admin PIN" gates cash removal + schedule edits
- **Schedule editing:** In-app admin page (Kyle can edit screenings/prices live from any device)
- **Passholder sync:** Pull from a Google Sheet (Name, Email, Barcode) on a "Sync passes" button — no two-way write-back
- **Receipts:** none
- **Devices:** 2 iPads + 1 staff iPhone at venue, 1 remote iPhone (Kyle)

## Deferred / nice-to-have (post-festival unless time permits)
- **Heartland integration:** skip for v1. Option: add a "Log external sale" button that records a ticket against inventory but flags it as `source=heartland` so it's excluded from cash reports.
- **Wix Events integration:** skip for v1. Option: manual "Set online-sold count" per screening so staff can keep inventory honest without API work.

## Ticket types (per screening unless overridden)
- General Admission — $16 default
- Student/Senior — $12 default
- **Comps** (no charge, tracked by category): Press, Pass Holder, Industry
- **Other** — custom label + qty + amount, on the fly (for ad-hoc tickets)

### Opening Night override (2026-05-01 AUN ES DE NOCHE EN CARACAS)
- GA $20, Student/Senior $15, Party + Screening $180

## Schedule (v1 — Kyle to revise in-app; free events TBD)
| Date | Time | Title | GA | S/S | Notes |
|------|------|-------|----|----|-------|
| 5/1 | 6:00 PM | AUN ES DE NOCHE EN CARACAS | 20 | 15 | Party+Screening $180 |
| 5/2 | 1:00 PM | CIRCE | 16 | 12 | |
| 5/2 | 2:45 PM | LA HIJA CONDOR | 16 | 12 | |
| 5/2 | 4:45 PM | BELEN | 16 | 12 | |
| 5/2 | 6:45 PM | VIDAS EN LA ORILLA | 16 | 12 | |
| 5/2 | 8:45 PM | HAVANA COYOTES | 16 | 12 | |
| 5/3 | 1:00 PM | EL SUEÑO DE TERESITA / NOMMAL / LOS ULTIMOS JUDIOS DE GUANTANAMO / POR FABIANA | 16 | 12 | shorts block |
| 5/3 | 2:45 PM | EL PANTERA | 16 | 12 | |
| 5/3 | 4:30 PM | BARACOA | 16 | 12 | |
| 5/3 | 6:45 PM | EL REGRESADO | 16 | 12 | |
| 5/3 | 8:45 PM | LA MISTERIOSA MIRADA DEL FLAMENCO | 16 | 12 | |
| 5/4 | 1:00 PM | EICTV SHORTS SHOWCASE | 16 | 12 | |
| 5/4 | 2:45 PM | LAS DOS MARIETTE | 16 | 12 | |
| 5/4 | 4:30 PM | UM LOBO ENTRE OS CISNES | 16 | 12 | |
| 5/4 | 6:00 PM | FILM INDUSTRY PANEL | 16 | 12 | likely free — confirm |
| 5/4 | 7:00 PM | NEUROTICA ANONIMA | 16 | 12 | |
| 5/4 | 9:00 PM | IMPRINTED | 16 | 12 | |
| 5/5 | 1:00 PM | VIRGINIA E ADELAIDE | 16 | 12 | |
| 5/5 | 3:00 PM | HIEDRA | 16 | 12 | |
| 5/5 | 5:00 PM | TORAH TROPICAL | 16 | 12 | |
| 5/5 | 7:15 PM | ADIOS AL AMIGO | 16 | 12 | |
| 5/5 | 9:00 PM | BAJO EL MISMO SOL | 16 | 12 | |
| 5/6 | 1:00 PM | EL EXILIO DE LOS MUSICOS | 16 | 12 | |
| 5/6 | 3:00 PM | UN CABO SUELTO | 16 | 12 | |
| 5/6 | 5:00 PM | PANEL LATINO JEWISH FILMMAKING | 16 | 12 | likely free — confirm |
| 5/6 | 6:15 PM | ADIO KERIDA / NANA Y ABUELO | 16 | 12 | |
| 5/6 | 8:30 PM | PARA VIVIR: EL IMPLACABLE TIEMPO DE PABLO MILANES | 16 | 12 | |
| 5/7 | 1:00 PM | FUC SHORT SHOWCASE | 16 | 12 | |
| 5/7 | 3:00 PM | NOVIEMBRE | 16 | 12 | |
| 5/7 | 6:00 PM | MI SUEÑO CUBANO | 16 | 12 | |
| 5/7 | 8:45 PM | MI SUEÑO CUBANO – ENCORE | 16 | 12 | |

## MVP feature punch list
- [ ] Screening catalog: browse by date, search, sold + capacity shown
- [ ] Cart: multi-screening, ticket type per line, "Other" custom line
- [ ] Comp categories: Press / Pass Holder / Industry (tracked but $0)
- [ ] Pass barcode scan → look up name in synced passholder table, attach to comp line
- [ ] Cash drawer: start-of-shift balance, running income, removals with who+why+timestamp
- [ ] End-of-day report: cash reconciliation + per-screening breakdown
- [ ] End-of-festival master report: per screening — # tickets by type, # attendees, $ total; Google Sheets export
- [ ] Admin page: edit screenings, ticket types, prices, capacity; import passholder sheet; manage PINs
- [ ] PIN auth (cashier / admin roles)

## Data model (Postgres / Supabase)
- `screenings` (id, date, time, title, capacity, notes)
- `ticket_types` (id, screening_id, label, price, category: paid|comp|other)
- `orders` (id, created_at, cashier_name, device, subtotal, cash_tendered, change_given, pin_used)
- `order_lines` (id, order_id, screening_id, ticket_type_id, qty, unit_price, comp_category, pass_barcode, custom_label, custom_amount)
- `passholders` (id, name, email, barcode, synced_at)
- `cash_drawers` (id, device, shift_date, opening_balance, closed_at, closing_balance_counted)
- `cash_events` (id, drawer_id, type: open|sale|removal|close, amount, reason, who, created_at)
- `users` (id, name, pin_hash, role: cashier|admin)

## What I need from Kyle (blockers)
1. **Create a free Supabase account** at supabase.com → new project "hffny-boxoffice" → send me the project URL and anon key (I'll guide if needed)
2. **Create a free Vercel account** at vercel.com (or give me the go-ahead to create one under your email)
3. **Passholder Google Sheet**: share a view-only link to the sheet with columns `Name | Email | Barcode`
4. **Confirm free events**: which screenings in the list above are free?
5. **Venue wifi**: is it reliable? (affects whether we need offline mode)
6. **Admin PIN + initial cashier PIN**: pick any 4-digit codes
