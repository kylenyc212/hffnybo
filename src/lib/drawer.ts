import { supabase } from './supabase';
import type { CashDrawerRow, CashEventRow, DenomBreakdown } from './database.types';
import { nyTodayKey } from './datetime';

/**
 * Returns the single globally-open drawer (the shared cash box for the shift),
 * or null if no shift is currently open. The DB enforces that at most one
 * such row exists via a partial unique index.
 */
export async function getOpenDrawer(): Promise<CashDrawerRow | null> {
  const { data, error } = await supabase
    .from('cash_drawers')
    .select('*')
    .is('closed_at', null)
    .maybeSingle();
  if (error) throw error;
  return (data as CashDrawerRow | null) ?? null;
}

export async function openDrawer(params: {
  deviceLabel: string;
  openedBy: string;
  openingCents: number;
}): Promise<CashDrawerRow> {
  const row = {
    device_label: params.deviceLabel,
    shift_date: nyTodayKey(),
    opened_by: params.openedBy,
    opening_cents: params.openingCents
  };
  const { data, error } = await supabase
    .from('cash_drawers')
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  const drawer = data as CashDrawerRow;
  await supabase.from('cash_events').insert({
    drawer_id: drawer.id,
    kind: 'open',
    amount_cents: params.openingCents,
    reason: 'Opening float',
    who: params.openedBy,
    order_id: null
  });
  return drawer;
}

export async function closeDrawer(params: {
  drawerId: string;
  closedBy: string;
  countedCents: number;
  closingDenoms?: DenomBreakdown | null;
}) {
  const { error } = await supabase
    .from('cash_drawers')
    .update({
      closed_at: new Date().toISOString(),
      closed_by: params.closedBy,
      counted_cents: params.countedCents,
      closing_denoms: params.closingDenoms ?? null
    })
    .eq('id', params.drawerId);
  if (error) throw error;
  await supabase.from('cash_events').insert({
    drawer_id: params.drawerId,
    kind: 'close',
    amount_cents: params.countedCents,
    reason: 'End-of-shift count',
    who: params.closedBy,
    order_id: null
  });
}

export async function removeCash(params: {
  drawerId: string;
  amountCents: number;
  reason: string;
  who: string;
}) {
  const { error } = await supabase.from('cash_events').insert({
    drawer_id: params.drawerId,
    kind: 'removal',
    amount_cents: -Math.abs(params.amountCents),
    reason: params.reason,
    who: params.who,
    order_id: null
  });
  if (error) throw error;
}

export async function loadDrawerEvents(drawerId: string): Promise<CashEventRow[]> {
  const { data, error } = await supabase
    .from('cash_events')
    .select('*')
    .eq('drawer_id', drawerId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data as CashEventRow[]) ?? [];
}

export interface EnrichedEvent extends CashEventRow {
  order_voided?: boolean;
  order_device?: string;
  order_cashier?: string;
}

export async function loadDrawerActivity(drawerId: string): Promise<EnrichedEvent[]> {
  const events = await loadDrawerEvents(drawerId);
  const orderIds = Array.from(new Set(events.map((e) => e.order_id).filter(Boolean))) as string[];
  if (orderIds.length === 0) return events;
  const { data, error } = await supabase
    .from('orders')
    .select('id, voided_at, device_label, cashier_name')
    .in('id', orderIds);
  if (error) return events;
  const map = new Map((data ?? []).map((o) => [o.id as string, o as { id: string; voided_at: string | null; device_label: string; cashier_name: string }]));
  return events.map((e) => {
    if (!e.order_id) return e;
    const o = map.get(e.order_id);
    if (!o) return e;
    return {
      ...e,
      order_voided: !!o.voided_at,
      order_device: o.device_label,
      order_cashier: o.cashier_name
    };
  });
}

// ---------- Test / draft cash counts ----------

import type { CashCountRow, DenomBreakdown as _DB } from './database.types';

export async function saveTestCount(params: {
  drawerId: string;
  who: string;
  denoms: _DB;
  countedCents: number;
  expectedCents: number;
  notes?: string | null;
}) {
  const { error } = await supabase.from('cash_counts').insert({
    drawer_id: params.drawerId,
    who: params.who,
    denoms: params.denoms,
    counted_cents: params.countedCents,
    expected_cents: params.expectedCents,
    variance_cents: params.countedCents - params.expectedCents,
    notes: params.notes ?? null
  });
  if (error) throw error;
}

export async function listTestCounts(drawerId: string): Promise<CashCountRow[]> {
  const { data, error } = await supabase
    .from('cash_counts')
    .select('*')
    .eq('drawer_id', drawerId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as CashCountRow[];
}
