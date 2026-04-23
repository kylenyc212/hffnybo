// Helpers for building Heartland catalog items from our screening/ticket-type
// schema. The goal: generate stable SKUs that travel through Heartland's
// transaction records so the Edge Function poll can auto-match them back
// to the right screening + ticket type in our DB.

import { supabase } from './supabase';
import type { ScreeningRow, TicketTypeRow } from './database.types';

const TITLE_STOPWORDS = new Set([
  'A', 'AN', 'THE', 'DE', 'LA', 'EL', 'LOS', 'LAS', 'Y', 'OF', 'AND', 'EN',
  'ES', 'NO', 'DEL'
]);

/**
 * Produce a short alphanumeric token from a screening title for use in SKUs.
 * Pulls the first few significant words, takes up to 5 letters total.
 * e.g. "AUN ES DE NOCHE EN CARACAS" → "AUNNO"
 */
function slugifyTitle(title: string): string {
  const words = title
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !TITLE_STOPWORDS.has(w));
  const candidate = words
    .slice(0, 3)
    .map((w) => w.slice(0, 3))
    .join('')
    .slice(0, 6);
  return candidate || 'SCR';
}

/**
 * Build a short code for a screening: TITLE-MMDD-HHMM (NY local time).
 * Example: "AUN-0501-1800" for AUN ES DE NOCHE at 6pm on May 1.
 */
export function generateShortCode(title: string, startsAtIso: string): string {
  const d = new Date(startsAtIso);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(d).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value])
  );
  const hh = parts.hour === '24' ? '00' : parts.hour;
  return `${slugifyTitle(title)}-${parts.month}${parts.day}-${hh}${parts.minute}`;
}

/**
 * Build a SKU for a ticket type under a given screening short code.
 * Example: "AUN-0501-1800-GA", "AUN-0501-1800-COMP-PRESS"
 */
export function generateSku(shortCode: string, label: string, category: string, compCategory: string | null): string {
  const lower = label.toLowerCase();
  let typeCode: string;
  if (category === 'comp') {
    if (compCategory === 'press') typeCode = 'COMP-PRESS';
    else if (compCategory === 'pass_holder') typeCode = 'COMP-PASS';
    else if (compCategory === 'industry') typeCode = 'COMP-IND';
    else typeCode = 'COMP';
  } else if (category === 'other') {
    typeCode = 'OTHER';
  } else if (lower.includes('general admission')) {
    typeCode = 'GA';
  } else if (lower.includes('student') || lower.includes('senior')) {
    typeCode = 'SS';
  } else if (lower.includes('party')) {
    typeCode = 'PARTY';
  } else {
    // Fallback: initials of the label
    typeCode = label
      .toUpperCase()
      .replace(/[^A-Z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .join('')
      .slice(0, 6) || 'X';
  }
  return `${shortCode}-${typeCode}`;
}

/**
 * Generate short_code for every screening that doesn't have one yet.
 * Idempotent: existing codes are preserved. Conflict-safe: if a generated
 * code is already taken, a numeric suffix is appended.
 */
export async function backfillShortCodes(): Promise<{ updated: number }> {
  const { data, error } = await supabase
    .from('screenings')
    .select('id, title, starts_at, short_code');
  if (error) throw error;
  const screenings = (data ?? []) as Pick<ScreeningRow, 'id' | 'title' | 'starts_at' | 'short_code'>[];

  const usedCodes = new Set(screenings.map((s) => s.short_code).filter(Boolean) as string[]);
  let updated = 0;

  for (const s of screenings) {
    if (s.short_code) continue;
    let candidate = generateShortCode(s.title, s.starts_at);
    let n = 1;
    while (usedCodes.has(candidate)) {
      n++;
      candidate = `${generateShortCode(s.title, s.starts_at)}-${n}`;
    }
    usedCodes.add(candidate);
    const { error: uErr } = await supabase
      .from('screenings')
      .update({ short_code: candidate })
      .eq('id', s.id);
    if (uErr) throw uErr;
    updated++;
  }
  return { updated };
}

/**
 * Generate heartland_sku for every ticket type that has a screening with a
 * short code. Idempotent. Conflict-safe with numeric suffix.
 */
export async function backfillSkus(): Promise<{ updated: number }> {
  await backfillShortCodes();

  const { data: screeningsData, error: sErr } = await supabase
    .from('screenings').select('id, short_code');
  if (sErr) throw sErr;
  const shortByScreening = new Map(
    (screeningsData as { id: string; short_code: string | null }[] | null ?? [])
      .map((s) => [s.id, s.short_code])
  );

  const { data: typesData, error: tErr } = await supabase
    .from('ticket_types').select('*');
  if (tErr) throw tErr;
  const types = (typesData ?? []) as TicketTypeRow[];

  const usedSkus = new Set(types.map((t) => t.heartland_sku).filter(Boolean) as string[]);
  let updated = 0;

  for (const t of types) {
    if (t.heartland_sku) continue;
    if (!t.screening_id) continue;
    const short = shortByScreening.get(t.screening_id);
    if (!short) continue;
    let candidate = generateSku(short, t.label, t.category, t.comp_category);
    let n = 1;
    while (usedSkus.has(candidate)) {
      n++;
      candidate = `${generateSku(short, t.label, t.category, t.comp_category)}-${n}`;
    }
    usedSkus.add(candidate);
    const { error: uErr } = await supabase
      .from('ticket_types')
      .update({ heartland_sku: candidate })
      .eq('id', t.id);
    if (uErr) throw uErr;
    updated++;
  }
  return { updated };
}

/**
 * Build a CSV of all paid ticket types (non-comp) for bulk upload into
 * Heartland's item catalog. One row per (screening, ticket_type) combo.
 */
export async function buildHeartlandCatalogCSV(): Promise<string> {
  const [{ data: screenings }, { data: types }] = await Promise.all([
    supabase.from('screenings').select('id, title, starts_at, short_code').order('starts_at'),
    supabase.from('ticket_types').select('*').eq('active', true)
  ]);
  const screeningMap = new Map(
    ((screenings ?? []) as Array<Pick<ScreeningRow, 'id' | 'title' | 'starts_at' | 'short_code'>>)
      .map((s) => [s.id, s])
  );
  const rows: string[][] = [['Name', 'SKU', 'Price', 'Category', 'Description']];

  const typeRows = ((types ?? []) as TicketTypeRow[])
    .filter((t) => t.category !== 'comp') // Comps don't go through Heartland
    .filter((t) => t.screening_id && t.heartland_sku);

  for (const t of typeRows) {
    const s = screeningMap.get(t.screening_id!);
    if (!s) continue;
    const when = new Date(s.starts_at).toLocaleString('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit'
    });
    const name = `${s.title} — ${when} (${t.label})`;
    rows.push([
      name,
      t.heartland_sku!,
      (t.price_cents / 100).toFixed(2),
      'HFFNY Box Office',
      `${s.short_code ?? ''} · ${t.label}`
    ]);
  }

  const esc = (v: string) => {
    if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
    return v;
  };
  return rows.map((r) => r.map(esc).join(',')).join('\n');
}

export function downloadCatalogCSV(content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `hffny-heartland-catalog.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
