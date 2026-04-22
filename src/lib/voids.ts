import { supabase } from './supabase';
import { hashPin } from './auth';
import type { OrderRow } from './database.types';

export async function verifyAdminPin(pin: string): Promise<{ id: string; name: string } | null> {
  const hash = await hashPin(pin);
  const { data, error } = await supabase
    .from('users')
    .select('id, name, role, active')
    .eq('pin_hash', hash)
    .eq('role', 'admin')
    .eq('active', true)
    .maybeSingle();
  if (error) { console.error(error); return null; }
  if (!data) return null;
  const row = data as { id: string; name: string; role: string; active: boolean };
  return { id: row.id, name: row.name };
}

export async function voidOrder(params: {
  orderId: string;
  adminPin: string;
  reason: string;
}): Promise<{ ok: true; adminName: string } | { ok: false; error: string }> {
  const admin = await verifyAdminPin(params.adminPin);
  if (!admin) return { ok: false, error: 'Manager PIN not recognized.' };
  if (!params.reason.trim()) return { ok: false, error: 'Reason required.' };

  // Fetch order first so we know the subtotal + drawer and can't void twice.
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
    .is('voided_at', null); // defensive against concurrent void
  if (updErr) return { ok: false, error: updErr.message };

  // Book a negative cash adjustment so the drawer reconciliation reflects the reversal.
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
