import { supabase } from './supabase';
import type { OrderLineRow } from './database.types';

/** Mark an order_line as checked in at the door. */
export async function checkInOrderLine(lineId: string, checkedInBy: string): Promise<void> {
  const { error } = await supabase
    .from('order_lines')
    .update({ checked_in_at: new Date().toISOString(), checked_in_by: checkedInBy })
    .eq('id', lineId);
  if (error) throw error;
}

/** Record (or refresh) a Wix scan check-in. Upserts on ticket_number so re-scans are idempotent. */
export async function recordWixCheckin(p: {
  ticketNumber: string;
  wixEventId: string;
  screeningId: string | null;
  checkedInBy: string;
  guestName: string | null;
  ticketType: string | null;
}): Promise<void> {
  const { error } = await supabase
    .from('wix_checkins')
    .upsert(
      {
        ticket_number: p.ticketNumber,
        wix_event_id:  p.wixEventId,
        screening_id:  p.screeningId,
        checked_in_at: new Date().toISOString(),
        checked_in_by: p.checkedInBy,
        guest_name:    p.guestName,
        ticket_type:   p.ticketType,
      },
      { onConflict: 'ticket_number' }
    );
  if (error) throw error;
}

/** Record a manual +1 check-in tap (no ticket — just head count). */
export async function recordManualCheckin(screeningId: string, checkedInBy: string): Promise<void> {
  const { error } = await supabase
    .from('manual_checkins')
    .insert({ screening_id: screeningId, checked_in_by: checkedInBy, qty: 1 });
  if (error) throw error;
}

/** Combined check-in counts (in-person + Wix + manual taps) per screening_id. */
export async function loadCheckinCounts(): Promise<Map<string, number>> {
  const [ipRes, wixRes, manualRes] = await Promise.all([
    supabase.from('order_lines').select('screening_id, qty').not('checked_in_at', 'is', null),
    supabase.from('wix_checkins').select('screening_id').not('screening_id', 'is', null),
    supabase.from('manual_checkins').select('screening_id, qty'),
  ]);

  const counts = new Map<string, number>();
  for (const r of (ipRes.data ?? []) as { screening_id: string; qty: number }[]) {
    counts.set(r.screening_id, (counts.get(r.screening_id) ?? 0) + r.qty);
  }
  for (const r of (wixRes.data ?? []) as { screening_id: string }[]) {
    counts.set(r.screening_id, (counts.get(r.screening_id) ?? 0) + 1);
  }
  for (const r of (manualRes.data ?? []) as { screening_id: string; qty: number }[]) {
    counts.set(r.screening_id, (counts.get(r.screening_id) ?? 0) + r.qty);
  }
  return counts;
}

/** Upcoming screenings for the check-in page header (90-min lookback so in-progress films show). */
export async function getUpcomingForCheckin(limit = 2) {
  const lookback = new Date(Date.now() - 90 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('screenings')
    .select('id, title, starts_at, capacity, online_sold')
    .eq('is_always_available', false)
    .gte('starts_at', lookback)
    .order('starts_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as Array<{ id: string; title: string; starts_at: string; capacity: number; online_sold: number }>;
}

export interface OrderLineWithScreening extends OrderLineRow {
  screenings: { title: string; starts_at: string } | null;
}

/** Load order_lines for a completed order (for post-checkout check-in), with screening name/time. */
export async function getCheckinLinesForOrder(orderId: string): Promise<OrderLineWithScreening[]> {
  const { data, error } = await supabase
    .from('order_lines')
    .select('*, screenings(title, starts_at)')
    .eq('order_id', orderId)
    .order('id');
  if (error) throw error;
  return (data ?? []) as OrderLineWithScreening[];
}

/** Look up the BO screening that maps to a given Wix event ID. */
export async function lookupScreeningByWixId(wixEventId: string): Promise<{ id: string; title: string; starts_at: string } | null> {
  const { data } = await supabase
    .from('screenings')
    .select('id, title, starts_at')
    .contains('wix_event_ids', [wixEventId])
    .maybeSingle();
  return data as { id: string; title: string; starts_at: string } | null;
}
