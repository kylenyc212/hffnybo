import type { CartLine } from './cart';
import { enqueue, submitOrderToSupabase, type QueuedOrder } from './offlineQueue';

export interface CheckoutParams {
  lines: CartLine[];
  cashierId: string;
  cashierName: string;
  deviceLabel: string;
  drawerId: string | null;
  cashTenderedCents: number;
  notes?: string;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  customerAddress?: string | null;
}

export interface CheckoutResult {
  orderId: string;
  subtotalCents: number;
  changeCents: number;
  /** True if the sale went straight to Supabase. False = saved to offline queue. */
  synced: boolean;
  offlineError?: string;
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  // Fallback (old iPad Safari). Not cryptographically great, acceptable for ids.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export async function checkout(params: CheckoutParams): Promise<CheckoutResult> {
  if (params.lines.length === 0) throw new Error('Cart is empty');

  const subtotal = params.lines.reduce((sum, l) => sum + l.qty * l.unitPriceCents, 0);
  const needsCash = subtotal > 0;
  if (needsCash && !params.drawerId) {
    throw new Error('Open a cash drawer before completing a paid sale.');
  }
  if (needsCash && params.cashTenderedCents < subtotal) {
    throw new Error(
      `Cash tendered is less than subtotal ($${(subtotal / 100).toFixed(2)}).`
    );
  }
  const change = needsCash ? params.cashTenderedCents - subtotal : 0;

  const queued: QueuedOrder = {
    id: uuid(),
    created_at: new Date().toISOString(),
    cashier_id: params.cashierId,
    cashier_name: params.cashierName,
    device_label: params.deviceLabel,
    drawer_id: params.drawerId,
    subtotal_cents: subtotal,
    cash_tendered_cents: needsCash ? params.cashTenderedCents : 0,
    change_cents: change,
    lines: params.lines,
    notes: params.notes ?? null,
    customer_name: params.customerName ?? null,
    customer_email: params.customerEmail ?? null,
    customer_phone: params.customerPhone ?? null,
    customer_address: params.customerAddress ?? null,
    attempts: 0
  };

  // Try the live path first.
  try {
    await submitOrderToSupabase(queued);
    return {
      orderId: queued.id,
      subtotalCents: subtotal,
      changeCents: change,
      synced: true
    };
  } catch (e: unknown) {
    // Any failure (network, RLS, constraint) → queue locally so the sale isn't lost.
    // Reconciliation happens when the device is back online.
    enqueue(queued);
    return {
      orderId: queued.id,
      subtotalCents: subtotal,
      changeCents: change,
      synced: false,
      offlineError: e instanceof Error ? e.message : 'unknown'
    };
  }
}
