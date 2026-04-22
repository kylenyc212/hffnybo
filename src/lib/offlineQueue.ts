// Offline sale queue. Failed checkouts are written to localStorage and retried
// on a manual "Sync" click, on a periodic interval, and on the browser's
// 'online' event. Client-generated UUIDs make retries idempotent at the order
// level — inserting the same order id twice would violate the PK, so we
// pre-check existence before retrying.

import { supabase } from './supabase';
import type { CartLine } from './cart';

const QUEUE_KEY = 'hffny-offline-queue-v1';

export interface QueuedOrder {
  id: string; // client-generated UUID, also becomes orders.id
  created_at: string; // client-side timestamp
  cashier_id: string;
  cashier_name: string;
  device_label: string;
  drawer_id: string | null;
  subtotal_cents: number;
  cash_tendered_cents: number;
  change_cents: number;
  lines: CartLine[];
  notes?: string | null;
  customer_name?: string | null;
  customer_email?: string | null;
  customer_phone?: string | null;
  customer_address?: string | null;
  attempts: number;
  last_error?: string;
}

function readQueue(): QueuedOrder[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedOrder[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(q: QueuedOrder[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
}

export function enqueue(order: QueuedOrder) {
  const q = readQueue();
  q.push(order);
  writeQueue(q);
  notify();
}

export function getQueue(): QueuedOrder[] {
  return readQueue();
}

export function queueCount(): number {
  return readQueue().length;
}

function remove(id: string) {
  writeQueue(readQueue().filter((o) => o.id !== id));
  notify();
}

// Subscribers (UI badge)
const listeners = new Set<() => void>();
export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notify() { listeners.forEach((fn) => fn()); }

export async function submitOrderToSupabase(o: QueuedOrder): Promise<void> {
  // If already inserted (retry succeeded previously but we didn't remove),
  // just skip.
  const { data: existing } = await supabase
    .from('orders').select('id').eq('id', o.id).maybeSingle();
  if (existing) return;

  const { error: orderErr } = await supabase.from('orders').insert({
    id: o.id,
    created_at: o.created_at,
    cashier_id: o.cashier_id,
    cashier_name: o.cashier_name,
    device_label: o.device_label,
    drawer_id: o.drawer_id,
    subtotal_cents: o.subtotal_cents,
    cash_tendered_cents: o.cash_tendered_cents,
    change_cents: o.change_cents,
    source: 'boxoffice',
    notes: o.notes ?? null,
    customer_name: o.customer_name ?? null,
    customer_email: o.customer_email ?? null,
    customer_phone: o.customer_phone ?? null,
    customer_address: o.customer_address ?? null
  });
  if (orderErr) throw orderErr;

  const lineRows = o.lines.map((l) => ({
    order_id: o.id,
    screening_id: l.screeningId,
    ticket_type_id: l.ticketTypeId,
    label: l.label,
    qty: l.qty,
    unit_price_cents: l.unitPriceCents,
    category: l.category,
    comp_category: l.compCategory,
    passholder_id: l.passholderId,
    patron_name: l.patronName
  }));
  const { error: linesErr } = await supabase.from('order_lines').insert(lineRows);
  if (linesErr) {
    // Roll back the header if lines failed.
    await supabase.from('orders').delete().eq('id', o.id);
    throw linesErr;
  }

  if (o.subtotal_cents > 0 && o.drawer_id) {
    await supabase.from('cash_events').insert({
      drawer_id: o.drawer_id,
      kind: 'sale',
      amount_cents: o.subtotal_cents,
      reason: null,
      who: o.cashier_name,
      order_id: o.id
    });
  }
}

export interface SyncResult {
  attempted: number;
  succeeded: number;
  failed: number;
  errors: string[];
}

export async function syncPending(): Promise<SyncResult> {
  const q = readQueue();
  let succeeded = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const o of q) {
    try {
      await submitOrderToSupabase(o);
      remove(o.id);
      succeeded++;
    } catch (e: unknown) {
      failed++;
      const msg = e instanceof Error ? e.message : 'unknown error';
      errors.push(`${o.id.slice(0, 8)}: ${msg}`);
      // Increment attempts + persist error
      const cur = readQueue();
      const idx = cur.findIndex((x) => x.id === o.id);
      if (idx >= 0) {
        cur[idx] = { ...cur[idx], attempts: (cur[idx].attempts ?? 0) + 1, last_error: msg };
        writeQueue(cur);
      }
    }
  }
  return { attempted: q.length, succeeded, failed, errors };
}

// Wire up global triggers: online event + 60s interval
let wired = false;
export function wireAutoSync() {
  if (wired || typeof window === 'undefined') return;
  wired = true;
  window.addEventListener('online', () => {
    syncPending().catch(console.error);
  });
  setInterval(() => {
    if (navigator.onLine && queueCount() > 0) {
      syncPending().catch(console.error);
    }
  }, 60_000);
}
