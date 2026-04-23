// Durable outbound queue for any mutation the app needs to eventually land in
// Supabase. Orders, cash events, and cash counts all flow through here so that
// losing wifi mid-shift doesn't lose a single write. Every operation carries a
// client-generated UUID so retries are idempotent — we pre-check existence on
// the server before re-inserting.
//
// Triggers for draining:
//   - every 60s when navigator.onLine
//   - on the browser 'online' event
//   - manually via `syncPending()` from the header Sync button

import { supabase } from './supabase';
import type { CartLine } from './cart';

const QUEUE_KEY = 'hffny-offline-queue-v1';

// ---------- Operation shapes ----------

export interface QueuedOrder {
  type?: 'insert_order'; // legacy entries may omit this
  id: string;
  created_at: string;
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

export interface QueuedCashEvent {
  type: 'insert_cash_event';
  id: string; // id of the cash_events row
  payload: {
    id: string;
    drawer_id: string;
    kind: 'open' | 'sale' | 'removal' | 'close' | 'adjustment' | 'add';
    amount_cents: number;
    reason: string | null;
    who: string;
    order_id: string | null;
    created_at: string;
  };
  attempts?: number;
  last_error?: string;
}

export interface QueuedCashCount {
  type: 'insert_cash_count';
  id: string;
  payload: {
    id: string;
    drawer_id: string;
    who: string;
    denoms: Record<string, number>;
    counted_cents: number;
    expected_cents: number;
    variance_cents: number;
    notes: string | null;
    created_at: string;
  };
  attempts?: number;
  last_error?: string;
}

export type QueuedOp = QueuedOrder | QueuedCashEvent | QueuedCashCount;

// ---------- Queue storage ----------

function readQueue(): QueuedOp[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedOp[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(q: QueuedOp[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
}

function isOrder(op: QueuedOp): op is QueuedOrder {
  return !('type' in op) || op.type === 'insert_order' || (op as QueuedOrder).lines !== undefined;
}

export function enqueue(order: QueuedOrder) {
  const q = readQueue();
  q.push(order);
  writeQueue(q);
  notify();
}

export function enqueueOp(op: QueuedCashEvent | QueuedCashCount) {
  const q = readQueue();
  q.push(op);
  writeQueue(q);
  notify();
}

export function getQueue(): QueuedOp[] {
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

// ---------- Submission ----------

export async function submitOrderToSupabase(o: QueuedOrder): Promise<void> {
  // If already inserted (previous retry succeeded but we didn't remove), skip.
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

async function submitCashEvent(op: QueuedCashEvent): Promise<void> {
  const { data: existing } = await supabase
    .from('cash_events').select('id').eq('id', op.payload.id).maybeSingle();
  if (existing) return;
  const { error } = await supabase.from('cash_events').insert(op.payload);
  if (error) throw error;
}

async function submitCashCount(op: QueuedCashCount): Promise<void> {
  const { data: existing } = await supabase
    .from('cash_counts').select('id').eq('id', op.payload.id).maybeSingle();
  if (existing) return;
  const { error } = await supabase.from('cash_counts').insert(op.payload);
  if (error) throw error;
}

// ---------- Sync ----------

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
  for (const op of q) {
    try {
      if (isOrder(op)) {
        await submitOrderToSupabase(op as QueuedOrder);
      } else if (op.type === 'insert_cash_event') {
        await submitCashEvent(op);
      } else if (op.type === 'insert_cash_count') {
        await submitCashCount(op);
      }
      remove(op.id);
      succeeded++;
    } catch (e: unknown) {
      failed++;
      const msg = e instanceof Error ? e.message : 'unknown error';
      errors.push(`${op.id.slice(0, 8)}: ${msg}`);
      const cur = readQueue();
      const idx = cur.findIndex((x) => x.id === op.id);
      if (idx >= 0) {
        const curOp = cur[idx] as { attempts?: number };
        cur[idx] = { ...cur[idx], attempts: (curOp.attempts ?? 0) + 1, last_error: msg } as QueuedOp;
        writeQueue(cur);
      }
    }
  }
  return { attempted: q.length, succeeded, failed, errors };
}

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
