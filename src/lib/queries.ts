import { supabase } from './supabase';
import type { ScreeningRow, TicketTypeRow, PassholderRow } from './database.types';
import { cachedFetch, CacheKeys } from './cache';

export interface ScreeningWithSold extends ScreeningRow {
  sold_in_person: number;
  ticket_types: TicketTypeRow[];
}

export async function loadScreenings(fromDate: string, toDate: string): Promise<ScreeningWithSold[]> {
  return cachedFetch(`${CacheKeys.screenings}:${fromDate}:${toDate}`, async () => {
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

  // Exclude voided orders from inventory counts.
  const { data: activeOrders, error: aErr } = await supabase
    .from('orders')
    .select('id')
    .is('voided_at', null);
  if (aErr) throw aErr;
  const activeIds = new Set(((activeOrders ?? []) as { id: string }[]).map((o) => o.id));

  const { data: sold, error: cErr } = await supabase
    .from('order_lines')
    .select('screening_id, qty, order_id');
  if (cErr) throw cErr;

  const soldRows = ((sold ?? []) as Array<{ screening_id: string; qty: number; order_id: string }>)
    .filter((r) => activeIds.has(r.order_id));
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
  });
}

// Refresh the passholders cache every time we touch it for scanning. Returns
// the full list from cache or network.
async function loadAllPassholdersCached(): Promise<PassholderRow[]> {
  return cachedFetch(CacheKeys.passholders, async () => {
    const { data, error } = await supabase
      .from('passholders')
      .select('id, name, email, barcode, synced_at');
    if (error) throw error;
    return (data ?? []) as PassholderRow[];
  });
}

export async function lookupPassholder(barcode: string): Promise<PassholderRow | null> {
  // Hit the local cache first — pass scans need to work offline. We pre-warm the
  // cache at login and opportunistically refresh in the background. If the scan
  // misses the cache, only then hit the network.
  const trimmed = barcode.trim();
  const list = await loadAllPassholdersCached().catch(() => [] as PassholderRow[]);
  const cached = list.find((p) => p.barcode === trimmed);
  if (cached) return cached;
  // Fallback: still attempt a direct lookup (in case cache is empty/stale)
  try {
    const { data, error } = await supabase
      .from('passholders')
      .select('id, name, email, barcode, synced_at')
      .eq('barcode', trimmed)
      .maybeSingle();
    if (error) throw error;
    return (data as PassholderRow | null) ?? null;
  } catch {
    return null;
  }
}
