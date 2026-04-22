import { supabase } from './supabase';
import type {
  CashDrawerRow,
  CashEventRow,
  OrderRow,
  OrderLineRow,
  ScreeningRow
} from './database.types';

// ---------- Drawer report ----------

export interface DrawerReport {
  drawer: CashDrawerRow;
  events: CashEventRow[];
  openingCents: number;
  salesCents: number;
  salesCount: number;
  removalsCents: number; // negative
  removalsList: CashEventRow[];
  expectedCents: number;
  countedCents: number | null;
  varianceCents: number | null;
  screenings: ScreeningBreakdown[];
  subtotalsByCategory: { paid: number; comp: number; other: number };
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

  return buildReport(drawer, events, lines, screenings);
}

function buildReport(
  drawer: CashDrawerRow,
  events: CashEventRow[],
  lines: OrderLineRow[],
  screenings: ScreeningRow[]
): DrawerReport {
  const salesEvents = events.filter((e) => e.kind === 'sale');
  const removalsList = events.filter((e) => e.kind === 'removal');
  const salesCents = salesEvents.reduce((s, e) => s + e.amount_cents, 0);
  const removalsCents = removalsList.reduce((s, e) => s + e.amount_cents, 0);
  const expectedCents = drawer.opening_cents + salesCents + removalsCents;

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

  return {
    drawer,
    events,
    openingCents: drawer.opening_cents,
    salesCents,
    salesCount: salesEvents.length,
    removalsCents,
    removalsList,
    expectedCents,
    countedCents: drawer.counted_cents,
    varianceCents: drawer.counted_cents !== null ? drawer.counted_cents - expectedCents : null,
    screenings: sortedScreenings,
    subtotalsByCategory: subs
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
      supabase.from('orders').select('id, source, voided_at').eq('source', 'boxoffice').is('voided_at', null),
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
