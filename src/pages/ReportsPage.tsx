import { useEffect, useMemo, useState } from 'react';
import { money } from '../lib/money';
import { fmtWhen } from '../lib/datetime';
import { DENOMS } from '../components/DenomCounter';
import { TestCountModal, CloseDrawerModal } from '../components/DrawerActionModals';
import { VoidModal } from '../components/VoidModal';
import { HardDeleteModal } from '../components/HardDeleteModal';
import { useSession } from '../lib/session';
import {
  downloadCSV,
  listDrawers,
  loadDrawerReport,
  loadFestivalReport,
  loadAllCCOrders,
  type DrawerReport,
  type FestivalReport,
  type CCOrderDetail,
} from '../lib/reports';
import type { CashDrawerRow } from '../lib/database.types';

type Tab = 'drawer' | 'festival' | 'cc';

export function ReportsPage() {
  const [tab, setTab] = useState<Tab>('drawer');
  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Reports</h1>
      <div className="flex gap-2 mb-6 flex-wrap">
        <TabBtn active={tab === 'drawer'} onClick={() => setTab('drawer')}>End-of-shift (drawer)</TabBtn>
        <TabBtn active={tab === 'festival'} onClick={() => setTab('festival')}>Festival master</TabBtn>
        <TabBtn active={tab === 'cc'} onClick={() => setTab('cc')}>💳 CC / Heartland</TabBtn>
      </div>
      {tab === 'drawer' ? <DrawerReportView /> : tab === 'festival' ? <FestivalReportView /> : <CCReportView />}
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-lg font-semibold ${
        active ? 'bg-brand text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
      }`}
    >
      {children}
    </button>
  );
}

function DrawerReportView() {
  const { user } = useSession();
  const isSuperAdmin = user?.role === 'super_admin';
  const [drawers, setDrawers] = useState<CashDrawerRow[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [report, setReport] = useState<DrawerReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showTest, setShowTest] = useState(false);
  const [showClose, setShowClose] = useState(false);
  const [bump, setBump] = useState(0);

  useEffect(() => {
    listDrawers()
      .then((list) => {
        setDrawers(list);
        if (list.length && !selected) setSelected(list[0].id);
      })
      .catch((e) => setErr(e.message));
  }, [bump]);

  useEffect(() => {
    if (!selected) return;
    setReport(null);
    setErr(null);
    loadDrawerReport(selected).then(setReport).catch((e) => setErr(e.message));
  }, [selected, bump]);

  if (err) return <div className="text-red-400">{err}</div>;
  if (drawers.length === 0) return <div className="text-slate-400">No drawers opened yet.</div>;

  const isOpen = report && !report.drawer.closed_at;

  return (
    <div>
      <div className="mb-4 flex items-end gap-2 flex-wrap">
        <label className="flex-1 min-w-[200px]">
          <div className="block text-xs uppercase text-slate-400 mb-1">Drawer</div>
          <select
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 w-full"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            {drawers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.shift_date} · {d.device_label} · {d.opened_by} · {d.closed_at ? 'closed' : 'OPEN'}
              </option>
            ))}
          </select>
        </label>
        {isOpen && user && report && (
          <div className="flex gap-2">
            <button
              onClick={() => setShowTest(true)}
              className="bg-slate-700 hover:bg-slate-600 text-white font-semibold px-4 py-2 rounded-lg"
            >Test count</button>
            <button
              onClick={() => setShowClose(true)}
              className="bg-red-800 hover:bg-red-700 text-white font-semibold px-4 py-2 rounded-lg"
            >Close drawer</button>
          </div>
        )}
      </div>
      {report && <DrawerReportBody report={report} isSuperAdmin={isSuperAdmin} onRefresh={() => setBump((n) => n + 1)} />}
      {showTest && report && user && (
        <TestCountModal
          drawer={report.drawer}
          expectedCents={report.expectedCents}
          who={user.name}
          onClose={() => setShowTest(false)}
          onDone={() => { setShowTest(false); setBump((n) => n + 1); }}
        />
      )}
      {showClose && report && user && (
        <CloseDrawerModal
          drawer={report.drawer}
          expectedCents={report.expectedCents}
          who={user.name}
          onClose={() => setShowClose(false)}
          onDone={() => { setShowClose(false); setBump((n) => n + 1); }}
        />
      )}
    </div>
  );
}

function DrawerReportBody({ report, isSuperAdmin, onRefresh }: { report: DrawerReport; isSuperAdmin: boolean; onRefresh: () => void }) {
  const [voidFor, setVoidFor] = useState<{ id: string; amountCents: number; description: string } | null>(null);
  const [deleteFor, setDeleteFor] = useState<{ id: string; amountCents: number; description: string } | null>(null);
  function buildReportText(): string {
    const m = (cents: number) => `$${(cents / 100).toFixed(2)}`;
    const lines: string[] = [
      `HFFNY Box Office — End of Day Report`,
      `Shift date: ${report.drawer.shift_date}`,
      `Device: ${report.drawer.device_label}`,
      `Opened by: ${report.drawer.opened_by}`,
      report.drawer.closed_by ? `Closed by: ${report.drawer.closed_by}` : '',
      ``,
      `── CASH RECONCILIATION ──`,
      `Opening:  ${m(report.openingCents)}`,
      `Sales:    ${m(report.salesCents)} (${report.salesCount} transactions)`,
      report.addsCents ? `Added:    ${m(report.addsCents)}` : '',
      `Removals: ${m(report.removalsCents)}`,
      `Expected: ${m(report.expectedCents)}`,
      report.countedCents !== null ? `Counted:  ${m(report.countedCents)}` : '',
      report.varianceCents !== null ? `Variance: ${report.varianceCents >= 0 ? '+' : ''}${m(report.varianceCents)}` : '',
      ``,
      `── PER-SCREENING ──`,
      ...report.screenings.flatMap((s) => [
        ``,
        `${s.title} (${s.starts_at})`,
        ...s.byLabel.map((l) => `  ${l.label.padEnd(30)} x${l.qty}  ${m(l.totalCents)}`),
        `  ${'TOTAL'.padEnd(30)}     ${m(s.totalCents)}`,
      ]),
    ];
    if (report.ccOrders.length > 0) {
      lines.push('', `── CC / HEARTLAND (${report.ccOrders.length} orders · ${m(report.ccTotalCents)}) ──`);
      for (const o of report.ccOrders) {
        const t = new Date(o.created_at).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
        const name = o.customer_name ? o.customer_name.padEnd(25) : '(no name)'.padEnd(25);
        const ref  = o.external_ref  ? `Ref: ${o.external_ref}` : '';
        lines.push(`  ${t}  ${name}  ${m(o.subtotal_cents)}  ${ref}`);
      }
    }
    if (report.removalsList.length > 0) {
      lines.push('', '── REMOVALS ──');
      for (const r of report.removalsList) {
        const t = new Date(r.created_at).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
        lines.push(`  ${t} ${r.who}: ${m(r.amount_cents)}${r.reason ? ` — ${r.reason}` : ''}`);
      }
    }
    return lines.filter((l) => l !== null).join('\n');
  }

  async function shareReport() {
    const title   = `HFFNY Box Office — ${report.drawer.shift_date} (${report.drawer.device_label})`;
    const text    = buildReportText();
    // iOS share sheet (Mail, Messages, AirDrop, Notes, …)
    if (navigator.share) {
      try { await navigator.share({ title, text }); return; } catch { /* user cancelled */ return; }
    }
    // Desktop: try mailto
    const mailto = `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(text)}`;
    const a = document.createElement('a');
    a.href = mailto;
    a.click();
  }

  function exportCSV() {
    const rows: (string | number)[][] = [
      ['HFFNY Box Office — Drawer report'],
      ['Shift date', report.drawer.shift_date],
      ['Device', report.drawer.device_label],
      ['Opened by', report.drawer.opened_by],
      ['Closed by', report.drawer.closed_by ?? ''],
      [],
      ['Cash reconciliation'],
      ['Opening', (report.openingCents / 100).toFixed(2)],
      ['Sales', (report.salesCents / 100).toFixed(2)],
      ['Removals', (report.removalsCents / 100).toFixed(2)],
      ['Expected', (report.expectedCents / 100).toFixed(2)],
      ['Counted', report.countedCents !== null ? (report.countedCents / 100).toFixed(2) : ''],
      ['Variance', report.varianceCents !== null ? (report.varianceCents / 100).toFixed(2) : ''],
      [],
      ['Per-screening'],
      ['Screening', 'When', 'Ticket label', 'Category', 'Qty', 'Total $']
    ];
    for (const s of report.screenings) {
      for (const l of s.byLabel) {
        rows.push([s.title, s.starts_at, l.label, l.category, l.qty, (l.totalCents / 100).toFixed(2)]);
      }
    }
    if (report.drawer.closing_denoms) {
      rows.push([]);
      rows.push(['Closing denomination count']);
      rows.push(['Denomination', 'Count', 'Subtotal $']);
      for (const d of DENOMS) {
        const q = report.drawer.closing_denoms[d.cents] ?? 0;
        if (q > 0) rows.push([d.label, q, ((q * d.cents) / 100).toFixed(2)]);
      }
    }
    rows.push([]);
    rows.push(['Removals log']);
    rows.push(['Time', 'Who', 'Amount $', 'Reason']);
    for (const r of report.removalsList) {
      rows.push([r.created_at, r.who, (r.amount_cents / 100).toFixed(2), r.reason ?? '']);
    }
    downloadCSV(`drawer-${report.drawer.shift_date}-${report.drawer.device_label}.csv`, rows);
  }

  return (
    <div className="space-y-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="text-lg font-semibold">Cash reconciliation</div>
          <div className="flex gap-2">
            <button onClick={shareReport} className="text-sm bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded-lg">
              Share ↑
            </button>
            <button onClick={exportCSV} className="text-sm bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded-lg">
              Download CSV
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Cell label="Opening" value={money(report.openingCents)} />
          <Cell label={`Sales (${report.salesCount})`} value={money(report.salesCents)} tone="pos" />
          {report.addsCents !== 0 && (
            <Cell label={`Added (${report.addsList.length})`} value={money(report.addsCents)} tone="pos" />
          )}
          {report.adjustmentsCents !== 0 && (
            <Cell label={`Adjustments (${report.adjustmentsList.length})`} value={money(report.adjustmentsCents)} tone={report.adjustmentsCents < 0 ? 'neg' : 'pos'} />
          )}
          <Cell label={`Removals (${report.removalsList.length})`} value={money(report.removalsCents)} tone={report.removalsCents < 0 ? 'neg' : undefined} />
          <Cell label="Expected" value={money(report.expectedCents)} bold />
          <Cell label="Counted" value={report.countedCents !== null ? money(report.countedCents) : '—'} bold />
          <Cell
            label="Variance"
            value={report.varianceCents !== null ? `${report.varianceCents >= 0 ? '+' : ''}${money(report.varianceCents)}` : '—'}
            tone={
              report.varianceCents === null ? undefined :
              report.varianceCents === 0 ? 'pos' :
              report.varianceCents > 0 ? 'warn' : 'neg'
            }
            bold
          />
        </div>
        {report.drawer.closing_denoms && (
          <div className="mt-4">
            <div className="text-xs uppercase text-slate-400 mb-1">Closing denomination count</div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-sm">
              {DENOMS.map((d) => {
                const q = report.drawer.closing_denoms?.[d.cents] ?? 0;
                if (q === 0) return null;
                return (
                  <div key={d.cents} className="bg-slate-900 border border-slate-700 rounded px-2 py-1">
                    <div className="text-xs text-slate-400">{d.label}</div>
                    <div className="tabular-nums"><span className="font-semibold">{q}</span> <span className="text-slate-500 text-xs">= {money(q * d.cents)}</span></div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {report.removalsList.length > 0 && (
          <div className="mt-4">
            <div className="text-xs uppercase text-slate-400 mb-1">Removals</div>
            <ul className="text-sm space-y-1">
              {report.removalsList.map((r) => (
                <li key={r.id} className="flex justify-between gap-3">
                  <span className="text-slate-300 truncate">
                    <span className="text-slate-500">{new Date(r.created_at).toLocaleTimeString('en-US', { timeZone: 'America/New_York' })} · {r.who}</span>
                    {r.reason ? ` — ${r.reason}` : ''}
                  </span>
                  <span className="text-red-400 tabular-nums whitespace-nowrap">{money(r.amount_cents)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {report.ccOrders.length > 0 && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="text-lg font-semibold">💳 CC / Heartland</div>
            <div className="text-emerald-400 font-bold tabular-nums">{money(report.ccTotalCents)}</div>
          </div>
          <ul className="divide-y divide-slate-700">
            {report.ccOrders.map((o) => {
              const timeLabel = new Date(o.created_at).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
              const desc = `CC · ${o.customer_name ?? 'no name'} · Ref ${o.external_ref ?? '—'} · ${timeLabel}`;
              return (
                <li key={o.id} className="py-2 flex items-center gap-2 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold tabular-nums">{money(o.subtotal_cents)}</div>
                    <div className="text-xs text-slate-400">
                      {timeLabel} · {o.cashier_name}
                      {o.customer_name && <> · {o.customer_name}</>}
                      {o.external_ref && <> · <span className="font-mono">{o.external_ref}</span></>}
                    </div>
                  </div>
                  <button
                    onClick={() => setVoidFor({ id: o.id, amountCents: o.subtotal_cents, description: desc })}
                    className="text-xs bg-slate-700 hover:bg-red-800 text-slate-300 hover:text-white px-2 py-1 rounded"
                  >Void</button>
                  {isSuperAdmin && (
                    <button
                      onClick={() => setDeleteFor({ id: o.id, amountCents: o.subtotal_cents, description: desc })}
                      className="text-xs bg-slate-800 hover:bg-red-900 text-red-300 hover:text-white px-2 py-1 rounded border border-red-900/50"
                    >✕ Delete</button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {voidFor && (
        <VoidModal
          mode="order"
          targetId={voidFor.id}
          amountCents={voidFor.amountCents}
          description={voidFor.description}
          onClose={() => setVoidFor(null)}
          onDone={() => { setVoidFor(null); onRefresh(); }}
        />
      )}
      {deleteFor && (
        <HardDeleteModal
          mode="order"
          targetId={deleteFor.id}
          amountCents={deleteFor.amountCents}
          description={deleteFor.description}
          onClose={() => setDeleteFor(null)}
          onDone={() => { setDeleteFor(null); onRefresh(); }}
        />
      )}

      <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
        <div className="text-lg font-semibold mb-3">Per-screening</div>
        {report.screenings.length === 0 ? (
          <div className="text-slate-400">No tickets sold on this drawer.</div>
        ) : (
          <ul className="space-y-4">
            {report.screenings.map((s) => (
              <ScreeningBlock key={s.screeningId} s={s} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function FestivalReportView() {
  const [report, setReport] = useState<FestivalReport | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    loadFestivalReport().then(setReport).catch((e) => setErr(e.message));
  }, []);

  if (err) return <div className="text-red-400">{err}</div>;
  if (!report) return <div className="text-slate-400">Loading…</div>;

  function exportCSV() {
    const rows: (string | number)[][] = [
      ['HFFNY Box Office — Festival master report'],
      [],
      ['Total attendees (box office)', report!.totalAttendees],
      ['Total paid $', (report!.totalPaidCents / 100).toFixed(2)],
      ['Total comp attendees', report!.totalCompAttendees],
      ['Total "other" $', (report!.totalOtherCents / 100).toFixed(2)],
      [],
      ['Screening', 'When', 'Ticket label', 'Category', 'Qty', 'Total $']
    ];
    for (const s of report!.screenings) {
      if (s.byLabel.length === 0) {
        rows.push([s.title, s.starts_at, '—', '—', 0, '0.00']);
      } else {
        for (const l of s.byLabel) {
          rows.push([s.title, s.starts_at, l.label, l.category, l.qty, (l.totalCents / 100).toFixed(2)]);
        }
      }
    }
    downloadCSV(`hffny-festival-master.csv`, rows);
  }

  return (
    <div className="space-y-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="text-lg font-semibold">Totals</div>
          <button onClick={exportCSV} className="text-sm bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded-lg">
            Download CSV
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Cell label="Attendees" value={report.totalAttendees.toString()} bold />
          <Cell label="Paid total" value={money(report.totalPaidCents)} tone="pos" bold />
          <Cell label="Comp attendees" value={report.totalCompAttendees.toString()} />
          <Cell label="Other $" value={money(report.totalOtherCents)} />
        </div>
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
        <div className="text-lg font-semibold mb-3">Per screening</div>
        {report.screenings.length === 0 ? (
          <div className="text-slate-400">No screenings.</div>
        ) : (
          <ul className="space-y-4">
            {report.screenings.map((s) => (
              <ScreeningBlock key={s.screeningId} s={s} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ScreeningBlock({ s }: { s: { title: string; starts_at: string; attendees: number; totalCents: number; byLabel: { label: string; category: string; qty: number; totalCents: number }[] } }) {
  return (
    <li className="bg-slate-900 border border-slate-700 rounded-lg p-3">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <div className="text-xs text-slate-400">{s.starts_at ? fmtWhen(s.starts_at) : ''}</div>
          <div className="font-semibold">{s.title}</div>
        </div>
        <div className="text-right text-sm">
          <div className="text-slate-400">{s.attendees} attendees</div>
          <div className="font-bold">{money(s.totalCents)}</div>
        </div>
      </div>
      {s.byLabel.length > 0 && (
        <table className="w-full text-sm">
          <thead className="text-slate-500">
            <tr>
              <th className="text-left font-normal">Ticket</th>
              <th className="text-right font-normal">Qty</th>
              <th className="text-right font-normal">$</th>
            </tr>
          </thead>
          <tbody>
            {s.byLabel.map((l, i) => (
              <tr key={i} className="border-t border-slate-800">
                <td className="py-1">{l.label}</td>
                <td className="py-1 text-right tabular-nums">{l.qty}</td>
                <td className="py-1 text-right tabular-nums">{money(l.totalCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </li>
  );
}

function CCReportView() {
  const { user } = useSession();
  const isSuperAdmin = user?.role === 'super_admin';
  const [orders, setOrders] = useState<CCOrderDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [voidFor, setVoidFor] = useState<{ id: string; amountCents: number; description: string } | null>(null);
  const [deleteFor, setDeleteFor] = useState<{ id: string; amountCents: number; description: string } | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      setOrders(await loadAllCCOrders());
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((o) =>
      (o.customer_name ?? '').toLowerCase().includes(q) ||
      (o.external_ref ?? '').toLowerCase().includes(q) ||
      o.cashier_name.toLowerCase().includes(q) ||
      o.device_label.toLowerCase().includes(q) ||
      o.screeningTitles.some((t) => t.toLowerCase().includes(q))
    );
  }, [orders, search]);

  const liveOrders = filtered.filter((o: CCOrderDetail) => !o.voided_at);
  const totalCents = liveOrders.reduce((s: number, o: CCOrderDetail) => s + o.subtotal_cents, 0);

  if (loading) return <div className="text-slate-400">Loading…</div>;
  if (err) return <div className="text-red-400">{err}</div>;

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="text-lg font-semibold">💳 All CC / Heartland transactions</div>
            <div className="text-sm text-slate-400 mt-0.5">{liveOrders.length} orders · {money(totalCents)} total</div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={load}
              className="text-sm bg-slate-700 hover:bg-slate-600 px-3 py-1.5 rounded-lg"
            >↺ Refresh</button>
            <button
              onClick={() => {
                const rows: (string | number)[][] = [
                  ['Time (ET)', 'Cashier', 'Device', 'Customer', 'Ref #', 'Screenings', 'Amount', 'Voided'],
                  ...orders.map((o) => [
                    new Date(o.created_at).toLocaleString('en-US', { timeZone: 'America/New_York' }),
                    o.cashier_name,
                    o.device_label,
                    o.customer_name ?? '',
                    o.external_ref ?? '',
                    o.screeningTitles.join('; '),
                    (o.subtotal_cents / 100).toFixed(2),
                    o.voided_at ? 'yes' : 'no',
                  ])
                ];
                downloadCSV('hffny-cc-orders.csv', rows);
              }}
              className="text-sm bg-slate-700 hover:bg-slate-600 px-3 py-1.5 rounded-lg"
            >Download CSV</button>
          </div>
        </div>
      </div>

      {/* Search */}
      <input
        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm"
        placeholder="Search by name, ref #, cashier, device, or screening…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {/* Order list */}
      {filtered.length === 0 ? (
        <div className="text-slate-500 text-sm text-center py-8">No CC orders found.</div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((o: CCOrderDetail) => {
            const voided = !!o.voided_at;
            const timeLabel = new Date(o.created_at).toLocaleString('en-US', {
              timeZone: 'America/New_York',
              month: 'short', day: 'numeric',
              hour: 'numeric', minute: '2-digit'
            });
            const desc = `CC · ${o.customer_name ?? 'no name'} · Ref ${o.external_ref ?? '—'} · ${timeLabel}`;
            return (
              <li
                key={o.id}
                className={`bg-slate-800 border rounded-xl p-4 ${voided ? 'border-slate-700 opacity-50' : 'border-slate-700'}`}
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    {/* Amount + voided badge */}
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-lg font-bold tabular-nums ${voided ? 'line-through text-slate-500' : ''}`}>
                        {money(o.subtotal_cents)}
                      </span>
                      {voided && <span className="text-xs bg-red-900/60 border border-red-700 text-red-300 px-1.5 py-0.5 rounded">voided</span>}
                      {o.external_ref && (
                        <span className="text-xs font-mono text-slate-400">#{o.external_ref}</span>
                      )}
                    </div>
                    {/* Customer + cashier */}
                    <div className="text-sm text-slate-200">
                      {o.customer_name ?? <span className="text-slate-500 italic">no name</span>}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {timeLabel} · {o.cashier_name} · {o.device_label}
                    </div>
                    {/* Screenings */}
                    {o.screeningTitles.length > 0 && (
                      <div className="text-xs text-slate-400 mt-1">
                        {o.screeningTitles.join(' · ')}
                      </div>
                    )}
                  </div>
                  {/* Actions */}
                  {!voided && (
                    <div className="flex gap-1.5 shrink-0">
                      <button
                        onClick={() => setVoidFor({ id: o.id, amountCents: o.subtotal_cents, description: desc })}
                        className="text-xs bg-slate-700 hover:bg-red-800 text-slate-300 hover:text-white px-2 py-1 rounded"
                      >Void</button>
                      {isSuperAdmin && (
                        <button
                          onClick={() => setDeleteFor({ id: o.id, amountCents: o.subtotal_cents, description: desc })}
                          className="text-xs bg-slate-800 hover:bg-red-900 text-red-300 hover:text-white px-2 py-1 rounded border border-red-900/50"
                        >✕ Delete</button>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {voidFor && (
        <VoidModal
          mode="order"
          targetId={voidFor.id}
          amountCents={voidFor.amountCents}
          description={voidFor.description}
          onClose={() => setVoidFor(null)}
          onDone={() => { setVoidFor(null); load(); }}
        />
      )}
      {deleteFor && (
        <HardDeleteModal
          mode="order"
          targetId={deleteFor.id}
          amountCents={deleteFor.amountCents}
          description={deleteFor.description}
          onClose={() => setDeleteFor(null)}
          onDone={() => { setDeleteFor(null); load(); }}
        />
      )}
    </div>
  );
}

function Cell({ label, value, tone, bold }: { label: string; value: string; tone?: 'pos' | 'neg' | 'warn'; bold?: boolean }) {
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-3">
      <div className="text-xs uppercase text-slate-400">{label}</div>
      <div className={`tabular-nums ${bold ? 'text-xl font-bold' : 'text-lg font-semibold'} ${
        tone === 'pos' ? 'text-emerald-400' :
        tone === 'neg' ? 'text-red-400' :
        tone === 'warn' ? 'text-amber-300' : ''
      }`}>
        {value}
      </div>
    </div>
  );
}
