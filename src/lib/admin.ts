import { supabase } from './supabase';
import type {
  ScreeningRow,
  TicketTypeRow,
  PassholderRow,
  UserRow,
  UserRole
} from './database.types';
import { hashPin } from './auth';

// ========== Screenings ==========

export async function listScreenings(): Promise<ScreeningRow[]> {
  const { data, error } = await supabase
    .from('screenings').select('*').order('starts_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as ScreeningRow[];
}

export async function upsertScreening(row: Partial<ScreeningRow> & { starts_at: string; title: string }) {
  if (row.id) {
    const { id, ...patch } = row;
    const { error } = await supabase.from('screenings').update(patch).eq('id', id);
    if (error) throw error;
    return id;
  }
  const { data, error } = await supabase.from('screenings').insert(row).select('id').single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export async function deleteScreening(id: string) {
  // Order lines reference screening_id → this will fail if any tickets are sold.
  // Expected: admin must void/refund first. We surface the error to the UI.
  const { error } = await supabase.from('screenings').delete().eq('id', id);
  if (error) throw error;
}

// ========== Ticket types ==========

export async function listTicketTypes(screeningId: string): Promise<TicketTypeRow[]> {
  const { data, error } = await supabase
    .from('ticket_types').select('*').eq('screening_id', screeningId)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data ?? []) as TicketTypeRow[];
}

export async function upsertTicketType(row: Partial<TicketTypeRow> & { label: string; price_cents: number; category: TicketTypeRow['category'] }) {
  if (row.id) {
    const { id, ...patch } = row;
    const { error } = await supabase.from('ticket_types').update(patch).eq('id', id);
    if (error) throw error;
    return id;
  }
  const { data, error } = await supabase.from('ticket_types').insert(row).select('id').single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export async function deleteTicketType(id: string) {
  const { error } = await supabase.from('ticket_types').delete().eq('id', id);
  if (error) throw error;
}

// ========== Passholders ==========

export async function listPassholders(): Promise<PassholderRow[]> {
  const { data, error } = await supabase
    .from('passholders').select('*').order('name', { ascending: true });
  if (error) throw error;
  return (data ?? []) as PassholderRow[];
}

export interface ParsedPass { name: string; email: string | null; barcode: string }

/** Parse CSV / TSV / comma-separated lines. Accepts header row or raw rows. */
export function parsePassholderCSV(text: string): { rows: ParsedPass[]; errors: string[] } {
  const rows: ParsedPass[] = [];
  const errors: string[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let startIdx = 0;
  if (lines.length && /name|email|barcode/i.test(lines[0])) startIdx = 1;
  for (let i = startIdx; i < lines.length; i++) {
    const cols = splitCSVRow(lines[i]);
    if (cols.length < 2) { errors.push(`Line ${i + 1}: needs at least name + barcode`); continue; }
    const [name, second, third] = cols;
    // Tolerant column ordering: (name, barcode) or (name, email, barcode)
    let email: string | null = null;
    let barcode: string;
    if (cols.length === 2) {
      barcode = second.trim();
    } else {
      email = (second ?? '').trim() || null;
      barcode = (third ?? '').trim();
    }
    if (!name.trim() || !barcode) {
      errors.push(`Line ${i + 1}: missing name or barcode`);
      continue;
    }
    rows.push({ name: name.trim(), email, barcode });
  }
  return { rows, errors };
}

function splitCSVRow(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQ = false; }
      } else cur += c;
    } else {
      if (c === ',' || c === '\t') { out.push(cur); cur = ''; }
      else if (c === '"') inQ = true;
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

export async function importPassholders(rows: ParsedPass[], replace: boolean) {
  if (replace) {
    // Delete everything first.
    const { error: delErr } = await supabase.from('passholders').delete().not('id', 'is', null);
    if (delErr) throw delErr;
  }
  if (rows.length === 0) return { inserted: 0 };
  // Upsert by barcode so re-imports just update the name/email.
  const chunk = 200;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk).map((r) => ({
      name: r.name,
      email: r.email,
      barcode: r.barcode,
      synced_at: new Date().toISOString()
    }));
    const { error } = await supabase.from('passholders').upsert(slice, { onConflict: 'barcode' });
    if (error) throw error;
    inserted += slice.length;
  }
  return { inserted };
}

// ========== Users ==========

export async function listUsers(): Promise<UserRow[]> {
  const { data, error } = await supabase
    .from('users').select('*').order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as UserRow[];
}

export async function addUser(name: string, pin: string, role: UserRole) {
  const pin_hash = await hashPin(pin);
  const { error } = await supabase.from('users').insert({ name, pin_hash, role });
  if (error) throw error;
}

export async function setUserActive(id: string, active: boolean) {
  const { error } = await supabase.from('users').update({ active }).eq('id', id);
  if (error) throw error;
}

export async function resetUserPin(id: string, newPin: string) {
  const pin_hash = await hashPin(newPin);
  const { error } = await supabase.from('users').update({ pin_hash }).eq('id', id);
  if (error) throw error;
}
