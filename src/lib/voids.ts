import { supabase } from './supabase';
import { hashPin } from './auth';
import type { OrderRow, CashEventRow } from './database.types';

// ====================================================================
// PIN verification
// Admin actions (void) accept either 'admin' or 'super_admin'.
// Hard-delete actions require 'super_admin' specifically.
// ====================================================================

export async function verifyAdminPin(
  pin: string
): Promise<{ id: string; name: string; role: 'admin' | 'super_admin' } | null> {
  const hash = await hashPin(pin);
  const { data, error } = await supabase
    .from('users')
    .select('id, name, role, active')
    .eq('pin_hash', hash)
    .in('role', ['admin', 'super_admin'])
    .eq('active', true)
    .maybeSingle();
  if (error) { console.error(error); return null; }
  if (!data) return null;
  const row = data as { id: string; name: string; role: 'admin' | 'super_admin'; active: boolean };
  return { id: row.id, name: row.name, role: row.role };
}

export async function verifySuperAdminPin(
  pin: string
): Promise<{ id: string; name: string } | null> {
  const hash = await hashPin(pin);
  const { data, error } = await supabase
    .from('users')
    .select('id, name, role, active')
    .eq('pin_hash', hash)
    .eq('role', 'super_admin')
    .eq('active', true)
    .maybeSingle();
  if (error) { console.error(error); return null; }
  if (!data) return null;
  const row = data as { id: string; name: string; role: string; active: boolean };
  return { id: row.id, name: row.name };
}

// ====================================================================
// Void an ORDER (sale)
// ====================================================================

export async function voidOrder(params: {
  orderId: string;
  adminPin: string;
  reason: string;
}): Promise<{ ok: true; adminName: string } | { ok: false; error: string }> {
  const admin = await verifyAdminPin(params.adminPin);
  if (!admin) return { ok: false, error: 'Manager PIN not recognized.' };
  if (!params.reason.trim()) return { ok: false, error: 'Reason required.' };

  const { data: orderData, error: oErr } = await supabase
    .from('orders').select('*').eq('id', params.orderId).maybeSingle();
  if (oErr || !orderData) return { ok: false, error: oErr?.message ?? 'Order not found' };
  const order = orderData as OrderRow;
  if (order.voided_at) return { ok: false, error: 'Order is already voided.' };

  const { error: updErr } = await supabase
    .from('orders')
    .update({
      voided_at: new Date().toISOString(),
      voided_by: admin.name,
      void_reason: params.reason.trim()
    })
    .eq('id', order.id)
    .is('voided_at', null);
  if (updErr) return { ok: false, error: updErr.message };

  // Offsetting adjustment so the drawer reconciliation reflects the reversal.
  if (order.drawer_id && order.subtotal_cents > 0) {
    const { error: evErr } = await supabase.from('cash_events').insert({
      drawer_id: order.drawer_id,
      kind: 'adjustment',
      amount_cents: -order.subtotal_cents,
      reason: `Void of order ${order.id.slice(0, 8)} — ${params.reason.trim()}`,
      who: admin.name,
      order_id: order.id
    });
    if (evErr) return { ok: false, error: evErr.message };
  }

  return { ok: true, adminName: admin.name };
}

// ====================================================================
// Void a CASH EVENT (cash add, reimbursement removal, or adjustment).
// Soft-void: the row is preserved with voided_at set; reports skip
// voided rows when summing totals so expectedCents auto-corrects.
// Sales must be voided through voidOrder() — this rejects kind='sale'.
// ====================================================================

export async function voidCashEvent(params: {
  eventId: string;
  adminPin: string;
  reason: string;
}): Promise<{ ok: true; adminName: string } | { ok: false; error: string }> {
  const admin = await verifyAdminPin(params.adminPin);
  if (!admin) return { ok: false, error: 'Manager PIN not recognized.' };
  if (!params.reason.trim()) return { ok: false, error: 'Reason required.' };

  const { data: evData, error: evErr } = await supabase
    .from('cash_events').select('*').eq('id', params.eventId).maybeSingle();
  if (evErr || !evData) return { ok: false, error: evErr?.message ?? 'Cash event not found' };
  const ev = evData as CashEventRow;
  if (ev.voided_at) return { ok: false, error: 'Already voided.' };
  if (ev.kind === 'sale') {
    return { ok: false, error: 'Sales must be voided via the order’s Void button, not the cash event.' };
  }
  if (ev.kind === 'open' || ev.kind === 'close') {
    return { ok: false, error: `Cannot void a "${ev.kind}" event.` };
  }

  const { error: updErr } = await supabase
    .from('cash_events')
    .update({
      voided_at: new Date().toISOString(),
      voided_by: admin.name,
      void_reason: params.reason.trim()
    })
    .eq('id', ev.id)
    .is('voided_at', null);
  if (updErr) return { ok: false, error: updErr.message };

  return { ok: true, adminName: admin.name };
}

// ====================================================================
// HARD DELETE — super-admin only. Removes the row(s) entirely.
// For orders: deletes order_lines (cascade) + the order + any cash_events
// referencing the order_id (sale + offsetting adjustment).
// For cash events: just the row.
// ====================================================================

export async function hardDeleteOrder(params: {
  orderId: string;
  superAdminPin: string;
  reason: string;
}): Promise<{ ok: true; adminName: string } | { ok: false; error: string }> {
  const sa = await verifySuperAdminPin(params.superAdminPin);
  if (!sa) return { ok: false, error: 'Super-admin PIN required for hard delete.' };
  if (!params.reason.trim()) return { ok: false, error: 'Reason required.' };

  // Audit trail: stamp the order with the deleter + reason BEFORE we delete,
  // so it shows up in the supabase logs/replicas.
  await supabase.from('orders').update({
    void_reason: `[HARD DELETE by ${sa.name}] ${params.reason.trim()}`
  }).eq('id', params.orderId);

  // Delete cash_events that reference this order (sale + any adjustment).
  const { error: ceErr } = await supabase
    .from('cash_events').delete().eq('order_id', params.orderId);
  if (ceErr) return { ok: false, error: `Cash events: ${ceErr.message}` };

  // order_lines have ON DELETE CASCADE → wiped automatically.
  const { error: oErr } = await supabase
    .from('orders').delete().eq('id', params.orderId);
  if (oErr) return { ok: false, error: `Order: ${oErr.message}` };

  return { ok: true, adminName: sa.name };
}

export async function hardDeleteCashEvent(params: {
  eventId: string;
  superAdminPin: string;
  reason: string;
}): Promise<{ ok: true; adminName: string } | { ok: false; error: string }> {
  const sa = await verifySuperAdminPin(params.superAdminPin);
  if (!sa) return { ok: false, error: 'Super-admin PIN required for hard delete.' };
  if (!params.reason.trim()) return { ok: false, error: 'Reason required.' };

  const { data: evData, error: evErr } = await supabase
    .from('cash_events').select('*').eq('id', params.eventId).maybeSingle();
  if (evErr || !evData) return { ok: false, error: evErr?.message ?? 'Cash event not found' };
  const ev = evData as CashEventRow;
  if (ev.kind === 'sale' && ev.order_id) {
    return {
      ok: false,
      error: 'This event is tied to an order. Hard-delete the order itself instead.'
    };
  }
  if (ev.kind === 'open' || ev.kind === 'close') {
    return { ok: false, error: `Cannot delete a "${ev.kind}" event — it anchors the drawer.` };
  }

  const { error: delErr } = await supabase
    .from('cash_events').delete().eq('id', ev.id);
  if (delErr) return { ok: false, error: delErr.message };

  return { ok: true, adminName: sa.name };
}
