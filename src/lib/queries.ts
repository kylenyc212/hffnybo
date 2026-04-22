import { supabase } from './supabase';
import type { ScreeningRow, TicketTypeRow, PassholderRow } from './database.types';

export interface ScreeningWithSold extends ScreeningRow {
  sold_in_person: number;
  ticket_types: TicketTypeRow[];
}

export async function loadScreenings(fromDate: string, toDate: string): Promise<ScreeningWithSold[]> {
  const { data: screenings, error: sErr } = await supabase
    .from('screenings')
    .select('*')
    .gte('starts_at', fromDate)
    .lte('starts_at', toDate + 'T23:59:59-04')
    .order('starts_at', { ascending: true });
  if (sErr) throw sErr;

  const { data: types, error: tErr } = await supabase
    .from('ticket_types')
    .select('*')
    .eq('active', true)
    .order('sort_order', { ascending: true });
  if (tErr) throw tErr;

  const { data: sold, error: cErr } = await supabase
    .from('order_lines')
    .select('screening_id, qty');
  if (cErr) throw cErr;

  const soldRows = (sold ?? []) as Array<{ screening_id: string; qty: number }>;
  const soldByScreening = new Map<string, number>();
  for (const l of soldRows) {
    soldByScreening.set(l.screening_id, (soldByScreening.get(l.screening_id) ?? 0) + (l.qty ?? 0));
  }

  const typeRows = (types ?? []) as TicketTypeRow[];
  const screeningRows = (screenings ?? []) as ScreeningRow[];

  return screeningRows.map((s) => ({
    ...s,
    sold_in_person: soldByScreening.get(s.id) ?? 0,
    ticket_types: typeRows.filter((t) => t.screening_id === s.id)
  }));
}

export async function lookupPassholder(barcode: string): Promise<PassholderRow | null> {
  const { data, error } = await supabase
    .from('passholders')
    .select('id, name, email, barcode, synced_at')
    .eq('barcode', barcode.trim())
    .maybeSingle();
  if (error) throw error;
  return (data as PassholderRow | null) ?? null;
}
