import { supabase } from './supabase';
import type {
  CashDrawerRow,
  CashEventRow,
  OrderRow,
  OrderLineRow,
  ScreeningRow
} from './database.types';

// ---------- Drawer report ----------

export interface CCOrder {
  id: string;
  created_at: string;
  cashier_name: string;
  subtotal_cents: number;
  external_ref: string | null;
  customer_name: string | null;
}

export interface DrawerReport {
  drawer: CashDrawerRow;
  events: CashEventRow[];
  openingCents: number;
  salesCents: number;
  salesCount: number;
  removalsCents: number; // negative
  removalsList: CashEventRow[];
  addsCents: number;
  addsList: CashEventRow[];
  adjustmentsCents: number;
  adjustmentsList: CashEventRow[];
  expectedCents: number;
  countedCents: number | null;
  varianceCents: number | null;
  screenings: ScreeningBreakdown[];
  subtotalsByCategory: { paid: number; comp: number; other: number };
  ccOrders: CCOrder[];
  ccTotalCents: number;
}

export interface ScreeningBreakdown {
  screeningId: string;
  title: string;
  starts_at: string;
  attendees: number;
  totalCents: number;
  byLabel: { label: string; category: string; qty: number; totalCents: number }[];
}

export async function loadDrawerReport(drawerId: string): Promise<DrawerReport> {
  const [{ data: drawerData, error: dErr }, { data: eventData, error: eErr }] = await Promise.all([
    supabase.from('cash_drawers').select('*').eq('id', drawerId).maybeSingle(),
    supabase.from('cash_events').select('*').eq('drawer_id', drawerId).order('created_at', { ascending: true })
  ]);
  if (dErr) throw dErr;
  if (!drawerData) throw new Error('Drawer not found');
  if (eErr) throw eErr;
  const drawer = drawerData as CashDrawerRow;
  const events = (eventData ?? []) as CashEventRow[];

  // Pull all non-voided orders + lines linked to this drawer.
  const { data: orderData, error: oErr } = await supabase
    .from('orders').select('*').eq('drawer_id', drawerId).is('voided_at', null);
  if (oErr) throw oErr;
  const orders = (orderData ?? []) as OrderRow[];

  // Pull CC (external_heartland) orders for the same device within the drawer's
  // open window. They bypass the cash drawer so they aren't linked by drawer_id.
  const shiftEnd = drawer.closed_at ?? new Date().toISOString();
  const { data: ccData } = await supabase
    .from('orders')
    .select('id, created_at, cashier_name, subtotal_cents, external_ref, customer_name')
    .eq('source', 'external_heartland')
    .eq('device_label', drawer.device_label)
    .gte('created_at', drawer.opened_at)
    .lte('created_at', shiftEnd)
    .is('voided_at', null)
    .order('created_at', { ascending: true });
  // Ignore errors — CC orders are best-effort; cash report still works without them
  const ccOrders = (ccData ?? []) as CCOrder[];

  const orderIds = orders.map((o) => o.id);
  let lines: OrderLineRow[] = [];
  if (orderIds.length > 0) {
    const { data: lineData, error: lErr } = await supabase
      .from('order_lines').select('*').in('order_id', orderIds);
    if (lErr) throw lErr;
    lines = (lineData ?? []) as OrderLineRow[];
  }

  const screeningIds = Array.from(new Set(lines.map((l) => l.screening_id)));
  let screenings: ScreeningRow[] = [];
  if (screeningIds.length > 0) {
    const { data: sData, error: sErr } = await supabase
      .from('screenings').select('*').in('id', screeningIds);
    if (sErr) throw sErr;
    screenings = (sData ?? []) as ScreeningRow[];
  }

  return buildReport(drawer, events, lines, screenings, ccOrders);
}

function buildReport(
  drawer: CashDrawerRow,
  events: CashEventRow[],
  lines: OrderLineRow[],
  screenings: ScreeningRow[],
  ccOrders: CCOrder[] = []
): DrawerReport {
  // Voided cash events (add / removal / adjustment) are excluded from the
  // expected-cash math but still appear in the activity feed (struck-through).
  // Sales voids are handled via offsetting adjustment events, not voided_at,
  // so we don't filter sales here.
  const isLive = (e: CashEventRow) => !e.voided_at;
  const salesEvents = events.filter((e) => e.kind === 'sale');
  const removalsList = events.filter((e) => e.kind === 'removal' && isLive(e));
  const addsList = events.filter((e) => e.kind === 'add' && isLive(e));
  const adjustmentsList = events.filter((e) => e.kind === 'adjustment' && isLive(e));
  const salesCents = salesEvents.reduce((s, e) => s + e.amount_cents, 0);
  const removalsCents = removalsList.reduce((s, e) => s + e.amount_cents, 0);
  const addsCents = addsList.reduce((s, e) => s + e.amount_cents, 0);
  const adjustmentsCents = adjustmentsList.reduce((s, e) => s + e.amount_cents, 0);
  const expectedCents = drawer.opening_cents + salesCents + addsCents + adjustmentsCents + removalsCents;

  const screeningMap = new Map(screenings.map((s) => [s.id, s]));
  const bySc = new Map<string, ScreeningBreakdown>();
  const subs = { paid: 0, comp: 0, other: 0 };

  for (const l of lines) {
    const sc = screeningMap.get(l.screening_id);
    const key = l.screening_id;
    const group = bySc.get(key) ?? {
      screeningId: key,
      title: sc?.title ?? '(unknown)',
      starts_at: sc?.starts_at ?? '',
      attendees: 0,
      totalCents: 0,
      byLabel: []
    };
    group.attendees += l.qty;
    const lineTotal = l.qty * l.unit_price_cents;
    group.totalCents += lineTotal;
    const existing = group.byLabel.find((x) => x.label === l.label && x.category === l.category);
    if (existing) {
      existing.qty += l.qty;
      existing.totalCents += lineTotal;
    } else {
      group.byLabel.push({ label: l.label, category: l.category, qty: l.qty, totalCents: lineTotal });
    }
    bySc.set(key, group);
    if (l.category === 'paid') subs.paid += lineTotal;
    else if (l.category === 'comp') subs.comp += lineTotal;
    else subs.other += lineTotal;
  }

  const sortedScreenings = Array.from(bySc.values()).sort((a, b) =>
    a.starts_at.localeCompare(b.starts_at)
  );

  const ccTotalCents = ccOrders.reduce((s, o) => s + o.subtotal_cents, 0);

  return {
    drawer,
    events,
    openingCents: drawer.opening_cents,
    salesCents,
    salesCount: salesEvents.length,
    removalsCents,
    removalsList,
    addsCents,
    addsList,
    adjustmentsCents,
    adjustmentsList,
    expectedCents,
    countedCents: drawer.counted_cents,
    varianceCents: drawer.counted_cents !== null ? drawer.counted_cents - expectedCents : null,
    screenings: sortedScreenings,
    subtotalsByCategory: subs,
    ccOrders,
    ccTotalCents,
  };
}

// ---------- Drawer list ----------

export async function listDrawers(): Promise<CashDrawerRow[]> {
  const { data, error } = await supabase
    .from('cash_drawers')
    .select('*')
    .order('opened_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as CashDrawerRow[];
}

// ---------- Festival master report ----------

export interface FestivalReport {
  totalAttendees: number;
  totalPaidCents: number;
  totalCompAttendees: number;
  totalOtherCents: number;
  screenings: ScreeningBreakdown[];
}

export async function loadFestivalReport(): Promise<FestivalReport> {
  const [{ data: orderData, error: oErr }, { data: lineData, error: lErr }, { data: sData, error: sErr }] =
    await Promise.all([
      supabase.from('orders').select('id, source, voided_at').in('source', ['boxoffice', 'external_heartland']).is('voided_at', null),
      supabase.from('order_lines').select('*'),
      supabase.from('screenings').select('*').order('starts_at', { ascending: true })
    ]);
  if (oErr) throw oErr;
  if (lErr) throw lErr;
  if (sErr) throw sErr;
  const orders = (orderData ?? []) as Pick<OrderRow, 'id' | 'source'>[];
  const allLines = (lineData ?? []) as OrderLineRow[];
  const screenings = (sData ?? []) as ScreeningRow[];
  const boxofficeOrderIds = new Set(orders.map((o) => o.id));
  const lines = allLines.filter((l) => boxofficeOrderIds.has(l.order_id));

  const bySc = new Map<string, ScreeningBreakdown>();
  let totalAttendees = 0;
  let totalPaidCents = 0;
  let totalCompAttendees = 0;
  let totalOtherCents = 0;

  for (const s of screenings) {
    bySc.set(s.id, {
      screeningId: s.id,
      title: s.title,
      starts_at: s.starts_at,
      attendees: 0,
      totalCents: 0,
      byLabel: []
    });
  }

  for (const l of lines) {
    const g = bySc.get(l.screening_id);
    if (!g) continue;
    g.attendees += l.qty;
    const lineTotal = l.qty * l.unit_price_cents;
    g.totalCents += lineTotal;
    const existing = g.byLabel.find((x) => x.label === l.label && x.category === l.category);
    if (existing) {
      existing.qty += l.qty;
      existing.totalCents += lineTotal;
    } else {
      g.byLabel.push({ label: l.label, category: l.category, qty: l.qty, totalCents: lineTotal });
    }
    totalAttendees += l.qty;
    if (l.category === 'paid') totalPaidCents += lineTotal;
    else if (l.category === 'comp') totalCompAttendees += l.qty;
    else totalOtherCents += lineTotal;
  }

  return {
    totalAttendees,
    totalPaidCents,
    totalCompAttendees,
    totalOtherCents,
    screenings: Array.from(bySc.values())
  };
}

// ---------- All CC / Heartland orders ----------

export interface CCOrderLine {
  id: string;
  label: string;
  qty: number;
  unit_price_cents: number;
  category: string;
  screening_title: string;
  voided_at: string | null;
}

export interface CCOrderDetail {
  id: string;
  created_at: string;
  cashier_name: string;
  device_label: string;
  customer_name: string | null;
  external_ref: string | null;
  subtotal_cents: number;
  voided_at: string | null;
  lines: CCOrderLine[];
}

export async function loadAllCCOrders(): Promise<CCOrderDetail[]> {
  const { data: orderData, error: oErr } = await supabase
    .from('orders')
    .select('id, created_at, cashier_name, device_label, customer_name, external_ref, subtotal_cents, voided_at')
    .eq('source', 'external_heartland')
    .order('created_at', { ascending: false });
  if (oErr) throw oErr;
  const rawOrders = (orderData ?? []) as Omit<CCOrderDetail, 'lines'>[];
  if (rawOrders.length === 0) return [];

  const orderIds = rawOrders.map((o) => o.id);
  const { data: lineData } = await supabase
    .from('order_lines')
    .select('id, order_id, label, qty, unit_price_cents, category, screening_id, voided_at')
    .in('order_id', orderIds);
  const lines = (lineData ?? []) as {
    id: string; order_id: string; label: string; qty: number;
    unit_price_cents: number; category: string; screening_id: string; voided_at: string | null;
  }[];

  const scIds = Array.from(new Set(lines.map((l) => l.screening_id)));
  const { data: scData } = scIds.length
    ? await supabase.from('screenings').select('id, title').in('id', scIds)
    : { data: [] };
  const scMap = new Map((scData ?? []).map((s: { id: string; title: string }) => [s.id, s.title]));

  const linesByOrder = new Map<string, CCOrderLine[]>();
  for (const l of lines) {
    const arr = linesByOrder.get(l.order_id) ?? [];
    arr.push({
      id: l.id,
      label: l.label,
      qty: l.qty,
      unit_price_cents: l.unit_price_cents,
      category: l.category,
      screening_title: scMap.get(l.screening_id) ?? '—',
      voided_at: l.voided_at,
    });
    linesByOrder.set(l.order_id, arr);
  }

  return rawOrders.map((o) => ({ ...o, lines: linesByOrder.get(o.id) ?? [] }));
}

// Save / clear the external_ref (invoice / ref number) on any order
export async function saveOrderRef(orderId: string, ref: string | null): Promise<void> {
  const { error } = await supabase
    .from('orders')
    .update({ external_ref: ref || null })
    .eq('id', orderId);
  if (error) throw error;
}

// ---------- CSV export ----------

export function downloadCSV(filename: string, rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = rows.map((r) => r.map(esc).join(',')).join('\n');
  const blob = new Blob([body], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
