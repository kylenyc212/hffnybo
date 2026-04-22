import { supabase } from './supabase';
import type { CashDrawerRow, CashEventRow } from './database.types';
import { nyTodayKey } from './datetime';

export async function getOpenDrawer(deviceLabel: string): Promise<CashDrawerRow | null> {
  const { data, error } = await supabase
    .from('cash_drawers')
    .select('*')
    .eq('device_label', deviceLabel)
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
}) {
  const { error } = await supabase
    .from('cash_drawers')
    .update({
      closed_at: new Date().toISOString(),
      closed_by: params.closedBy,
      counted_cents: params.countedCents
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
