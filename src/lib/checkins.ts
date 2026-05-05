import { supabase } from './supabase';
import type { OrderLineRow } from './database.types';

/** Check in one ticket on a line (+1). Sets checked_in_at on the first tap.
 *  Pass the current checked_in_qty and total qty from the local state to avoid
 *  an extra round-trip. */
export async function checkInOne(
  lineId: string,
  checkedInBy: string,
  currentCheckedIn: number,
  totalQty: number,
): Promise<void> {
  if (currentCheckedIn >= totalQty) return; // already fully in
  const newQty = currentCheckedIn + 1;
  const patch: Record<string, unknown> = { checked_in_qty: newQty, checked_in_by: checkedInBy };
  if (currentCheckedIn === 0) patch.checked_in_at = new Date().toISOString(); // first tap
  const { error } = await supabase.from('order_lines').update(patch).eq('id', lineId);
  if (error) throw error;
}

/** Undo one check-in (-1). Clears checked_in_at when count reaches 0. */
export async function uncheckInOne(lineId: string, currentCheckedIn: number): Promise<void> {
  if (currentCheckedIn <= 0) return;
  const newQty = currentCheckedIn - 1;
  const patch: Record<string, unknown> = { checked_in_qty: newQty };
  if (newQty === 0) { patch.checked_in_at = null; patch.checked_in_by = null; }
  const { error } = await supabase.from('order_lines').update(patch).eq('id', lineId);
  if (error) throw error;
}

/** @deprecated Use checkInOne — kept for any callers not yet migrated. */
export async function checkInOrderLine(lineId: string, checkedInBy: string): Promise<void> {
  // Reads qty first so we can set checked_in_qty = qty (mark all as in)
  const { data } = await supabase.from('order_lines').select('qty').eq('id', lineId).single();
  const qty = (data as { qty: number } | null)?.qty ?? 1;
  const { error } = await supabase
    .from('order_lines')
    .update({ checked_in_at: new Date().toISOString(), checked_in_by: checkedInBy, checked_in_qty: qty })
    .eq('id', lineId);
  if (error) throw error;
}

/** @deprecated Use uncheckInOne. */
export async function uncheckInOrderLine(lineId: string): Promise<void> {
  const { error } = await supabase
    .from('order_lines')
    .update({ checked_in_at: null, checked_in_by: null, checked_in_qty: 0 })
    .eq('id', lineId);
  if (error) throw error;
}

/** Hard-delete a single order_line (super-admin correction for wrong ticket type etc). */
export async function deleteOrderLine(lineId: string): Promise<void> {
  const { error } = await supabase
    .from('order_lines')
    .delete()
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

export interface CheckinCounts {
  total:  Map<string, number>;
  manual: Map<string, number>;
}

/** Combined check-in counts (in-person + Wix + manual taps) per screening_id.
 *  In-person counts use checked_in_qty (per-ticket granularity).
 *  Returns both the overall total and a separate manual-only map. */
export async function loadCheckinCounts(): Promise<CheckinCounts> {
  const [ipRes, wixRes, manualRes] = await Promise.all([
    supabase.from('order_lines').select('screening_id, checked_in_qty').gt('checked_in_qty', 0),
    supabase.from('wix_checkins').select('screening_id').not('screening_id', 'is', null),
    supabase.from('manual_checkins').select('screening_id, qty'),
  ]);

  const total  = new Map<string, number>();
  const manual = new Map<string, number>();

  for (const r of (ipRes.data ?? []) as { screening_id: string; checked_in_qty: number }[]) {
    total.set(r.screening_id, (total.get(r.screening_id) ?? 0) + r.checked_in_qty);
  }
  for (const r of (wixRes.data ?? []) as { screening_id: string }[]) {
    total.set(r.screening_id, (total.get(r.screening_id) ?? 0) + 1);
  }
  for (const r of (manualRes.data ?? []) as { screening_id: string; qty: number }[]) {
    total.set(r.screening_id,  (total.get(r.screening_id)  ?? 0) + r.qty);
    manual.set(r.screening_id, (manual.get(r.screening_id) ?? 0) + r.qty);
  }
  return { total, manual };
}

/** Upcoming screenings for the check-in page header (90-min lookback so in-progress films show). */
export async function getUpcomingForCheckin(limit = 2) {
  const lookback = new Date(Date.now() - 90 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('screenings')
    .select('id, title, starts_at, capacity, online_sold, wix_event_ids')
    .eq('is_always_available', false)
    .gte('starts_at', lookback)
    .order('starts_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as Array<{ id: string; title: string; starts_at: string; capacity: number; online_sold: number; wix_event_ids: string[] }>;
}

export interface OrderLineWithScreening extends OrderLineRow {
  screenings: { title: string; starts_at: string; is_always_available: boolean } | null;
}

/** Load order_lines for a completed order (for post-checkout check-in), with screening name/time. */
export async function getCheckinLinesForOrder(orderId: string): Promise<OrderLineWithScreening[]> {
  const { data, error } = await supabase
    .from('order_lines')
    .select('*, screenings(title, starts_at, is_always_available)')
    .eq('order_id', orderId)
    .order('id');
  if (error) throw error;
  return (data ?? []) as OrderLineWithScreening[];
}

/** Load order_lines by external_ref (invoice/receipt number) — fallback for when a
 *  duplicate invoice was detected and the lines are under an earlier order's UUID. */
export async function getCheckinLinesForExternalRef(externalRef: string): Promise<OrderLineWithScreening[]> {
  const { data: order } = await supabase
    .from('orders')
    .select('id')
    .eq('external_ref', externalRef)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!order) return [];
  return getCheckinLinesForOrder((order as { id: string }).id);
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

/** A single order_line from a BO order, grouped for the guest list. */
export interface BOGuestLine {
  lineId: string;
  label: string;
  qty: number;
  checkedInQty: number;   // checked_in_qty (0 if column not yet migrated)
  patronName: string | null;
}

export interface BOGuestOrder {
  orderId: string;
  customerName: string | null;
  source: 'boxoffice' | 'external_heartland';
  lines: BOGuestLine[];
}

/** Load all non-voided BO app order lines for a screening (for the guest list). */
export async function loadBOGuestsForScreening(screeningId: string): Promise<BOGuestOrder[]> {
  const { data, error } = await supabase
    .from('order_lines')
    .select('id, label, qty, checked_in_qty, checked_in_at, patron_name, order_id, orders(customer_name, source, voided_at)')
    .eq('screening_id', screeningId)
    .is('voided_at', null);           // skip voided lines
  if (error) throw error;

  // Group by order, skip voided orders
  const byOrder = new Map<string, BOGuestOrder>();
  type RawRow = {
    id: string; label: string; qty: number;
    checked_in_qty: number | null; checked_in_at: string | null;
    patron_name: string | null; order_id: string;
    orders: { customer_name: string | null; source: string; voided_at: string | null } | null;
  };
  for (const r of (data as unknown as RawRow[]) ?? []) {
    if (r.orders?.voided_at) continue; // skip voided orders
    const order = byOrder.get(r.order_id) ?? {
      orderId: r.order_id,
      customerName: r.orders?.customer_name ?? null,
      source: (r.orders?.source ?? 'boxoffice') as 'boxoffice' | 'external_heartland',
      lines: [],
    };
    order.lines.push({
      lineId: r.id,
      label: r.label,
      qty: r.qty,
      // Fall back to checked_in_at for rows pre-dating the checked_in_qty migration
      checkedInQty: r.checked_in_qty ?? (r.checked_in_at ? r.qty : 0),
      patronName: r.patron_name,
    });
    byOrder.set(r.order_id, order);
  }
  return Array.from(byOrder.values());
}
