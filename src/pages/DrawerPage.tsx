import { useCallback, useEffect, useState } from 'react';
import { useSession } from '../lib/session';
import { money, toCents } from '../lib/money';
import {
  addCash,
  closeDrawer,
  getOpenDrawer,
  loadDrawerActivity,
  listTestCounts,
  openDrawer,
  removeCash,
  saveTestCount,
  type EnrichedEvent
} from '../lib/drawer';
import type { CashCountRow, CashDrawerRow, DenomBreakdown } from '../lib/database.types';
import { DenomCounter, totalFromDenoms } from '../components/DenomCounter';
import { VoidModal } from '../components/VoidModal';
import { HardDeleteModal } from '../components/HardDeleteModal';
import { getCheckinLinesForOrder, deleteOrderLine, type OrderLineWithScreening } from '../lib/checkins';
import { fmtTime } from '../lib/datetime';
import { sendReceiptEmail } from '../lib/email';
import { supabase } from '../lib/supabase';

type ActionTarget =
  | { mode: 'order'; id: string; amountCents: number; description?: string }
  | { mode: 'cash_event'; id: string; amountCents: number; description?: string };

export function DrawerPage() {
  const { user, deviceLabel } = useSession();
  const [drawer, setDrawer] = useState<CashDrawerRow | null>(null);
  const [events, setEvents] = useState<EnrichedEvent[]>([]);
  const [testCounts, setTestCounts] = useState<CashCountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [voidFor, setVoidFor] = useState<ActionTarget | null>(null);
  const [deleteFor, setDeleteFor] = useState<ActionTarget | null>(null);
  const isSuperAdmin = user?.role === 'super_admin';

  const refresh = useCallback(async () => {
    setErr(null);
    try {
      const d = await getOpenDrawer();
      setDrawer(d);
      if (d) {
        const [ev, tc] = await Promise.all([loadDrawerActivity(d.id), listTestCounts(d.id)]);
        setEvents(ev);
        setTestCounts(tc);
      } else {
        setEvents([]);
        setTestCounts([]);
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to load drawer');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Poll every 8 seconds so sales rung on another iPad show up here.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, 8000);
    return () => clearInterval(id);
  }, [refresh]);

  if (!user || !deviceLabel) return <div className="p-6 text-slate-400">Sign in first.</div>;
  if (loading) return <div className="p-6 text-slate-400">Loading…</div>;

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-1">Cash Drawer</h1>
      <div className="text-sm text-slate-400 mb-4">
        Shared cash box · this iPad: <span className="text-slate-200 font-semibold">{deviceLabel}</span>
        {drawer && (
          <> · opened by <span className="text-slate-200 font-semibold">{drawer.opened_by}</span> on <span className="text-slate-200">{drawer.device_label}</span></>
        )}
      </div>
      {err && <div className="bg-red-900/40 border border-red-700 text-red-200 text-sm p-3 rounded-lg mb-4">{err}</div>}

      {!drawer ? (
        <OpenDrawerForm
          busy={busy}
          onSubmit={async (opening) => {
            setBusy(true);
            setErr(null);
            try {
              await openDrawer({ deviceLabel, openedBy: user.name, openingCents: opening });
              await refresh();
            } catch (e: unknown) {
              setErr(e instanceof Error ? e.message : 'Failed to open drawer');
            } finally {
              setBusy(false);
            }
          }}
        />
      ) : (
        <OpenDrawerView
          drawer={drawer}
          events={events}
          testCounts={testCounts}
          cashierName={user.name}
          busy={busy}
          isSuperAdmin={isSuperAdmin}
          onVoidRequest={(t) => setVoidFor(t)}
          onDeleteRequest={(t) => setDeleteFor(t)}
          onRefresh={refresh}
          onRemove={async ({ amountCents, reason }) => {
            setBusy(true);
            setErr(null);
            try {
              await removeCash({ drawerId: drawer.id, amountCents, reason, who: user.name });
              await refresh();
            } catch (e: unknown) {
              setErr(e instanceof Error ? e.message : 'Failed to remove cash');
            } finally {
              setBusy(false);
            }
          }}
          onAdd={async ({ amountCents, reason }) => {
            setBusy(true);
            setErr(null);
            try {
              await addCash({ drawerId: drawer.id, amountCents, reason, who: user.name });
              await refresh();
            } catch (e: unknown) {
              setErr(e instanceof Error ? e.message : 'Failed to add cash');
            } finally {
              setBusy(false);
            }
          }}
          onClose={async ({ countedCents, denoms }) => {
            setBusy(true);
            setErr(null);
            try {
              await closeDrawer({
                drawerId: drawer.id,
                closedBy: user.name,
                countedCents,
                closingDenoms: denoms
              });
              await refresh();
            } catch (e: unknown) {
              setErr(e instanceof Error ? e.message : 'Failed to close drawer');
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
      {voidFor && (
        <VoidModal
          mode={voidFor.mode}
          targetId={voidFor.id}
          amountCents={voidFor.amountCents}
          description={voidFor.description}
          onClose={() => setVoidFor(null)}
          onDone={async () => { setVoidFor(null); await refresh(); }}
        />
      )}
      {deleteFor && (
        <HardDeleteModal
          mode={deleteFor.mode}
          targetId={deleteFor.id}
          amountCents={deleteFor.amountCents}
          description={deleteFor.description}
          onClose={() => setDeleteFor(null)}
          onDone={async () => { setDeleteFor(null); await refresh(); }}
        />
      )}
    </div>
  );
}

function OpenDrawerForm({ busy, onSubmit }: { busy: boolean; onSubmit: (openingCents: number) => void }) {
  const [amt, setAmt] = useState('100.00');
  const cents = toCents(parseFloat(amt || '0'));
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
      <div className="text-lg font-semibold mb-2">Open drawer</div>
      <div className="text-sm text-slate-400 mb-4">Count your starting cash float and enter it below.</div>
      <label className="block mb-4">
        <div className="text-xs uppercase text-slate-400 mb-1">Opening float</div>
        <input
          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-3 text-2xl tabular-nums"
          type="number" step="0.01" min="0" inputMode="decimal"
          value={amt}
          onChange={(e) => setAmt(e.target.value)}
        />
      </label>
      <button
        disabled={busy || cents < 0}
        onClick={() => onSubmit(cents)}
        className="w-full bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white font-bold py-3 rounded-xl"
      >
        {busy ? 'Opening…' : `Open with ${money(cents)}`}
      </button>
    </div>
  );
}

interface OpenViewProps {
  drawer: CashDrawerRow;
  events: EnrichedEvent[];
  testCounts: CashCountRow[];
  cashierName: string;
  busy: boolean;
  isSuperAdmin: boolean;
  onRemove: (p: { amountCents: number; reason: string }) => void;
  onAdd: (p: { amountCents: number; reason: string }) => void;
  onClose: (p: { countedCents: number; denoms: DenomBreakdown }) => void;
  onVoidRequest: (
    p:
      | { mode: 'order'; id: string; amountCents: number; description?: string }
      | { mode: 'cash_event'; id: string; amountCents: number; description?: string }
  ) => void;
  onDeleteRequest: (
    p:
      | { mode: 'order'; id: string; amountCents: number; description?: string }
      | { mode: 'cash_event'; id: string; amountCents: number; description?: string }
  ) => void;
  onRefresh: () => void;
}

function OpenDrawerView({
  drawer,
  events,
  testCounts,
  cashierName,
  busy,
  isSuperAdmin,
  onRemove,
  onAdd,
  onClose,
  onVoidRequest,
  onDeleteRequest,
  onRefresh
}: OpenViewProps) {
  const [showRemove, setShowRemove] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showClose, setShowClose] = useState(false);
  const [showTest, setShowTest] = useState(false);
  const [removeAmt, setRemoveAmt] = useState('');
  const [removeReason, setRemoveReason] = useState('');
  const [addAmt, setAddAmt] = useState('');
  const [addReason, setAddReason] = useState('');
  const [denoms, setDenoms] = useState<DenomBreakdown>({});
  const [testDenoms, setTestDenoms] = useState<DenomBreakdown>({});
  const [testNotes, setTestNotes] = useState('');
  const [testBusy, setTestBusy] = useState(false);
  const [testErr, setTestErr] = useState<string | null>(null);

  // Expandable order lines inside each sale row
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [expandedLines, setExpandedLines] = useState<OrderLineWithScreening[]>([]);
  const [linesLoading, setLinesLoading] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Email receipt state: { orderId, emailInput, sending, result }
  const [emailFor, setEmailFor] = useState<string | null>(null); // orderId
  const [emailInput, setEmailInput] = useState('');
  const [emailSending, setEmailSending] = useState(false);
  const [emailResult, setEmailResult] = useState<Record<string, 'sent' | 'error'>>({});

  // Inline customer name/email editing
  const [editingCustomer, setEditingCustomer] = useState<string | null>(null); // orderId
  const [customerNameDraft, setCustomerNameDraft] = useState('');
  const [customerEmailDraft, setCustomerEmailDraft] = useState('');
  const [customerSaving, setCustomerSaving] = useState(false);

  async function saveCustomer(orderId: string) {
    setCustomerSaving(true);
    try {
      const { error } = await supabase
        .from('orders')
        .update({
          customer_name: customerNameDraft.trim() || null,
          customer_email: customerEmailDraft.trim() || null,
        })
        .eq('id', orderId);
      if (error) throw error;
      setEditingCustomer(null);
      onRefresh();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setCustomerSaving(false);
    }
  }

  async function sendReceipt(event: EnrichedEvent, toEmail: string) {
    if (!toEmail.includes('@') || emailSending) return;
    setEmailSending(true);
    try {
      // Fetch order lines to build the receipt
      const { data: lines } = await supabase
        .from('order_lines')
        .select('label, qty, unit_price_cents, screening_id')
        .eq('order_id', event.order_id!);

      // Fetch screening titles
      const scIds = Array.from(new Set((lines ?? []).map((l: { screening_id: string }) => l.screening_id)));
      const { data: screenings } = scIds.length
        ? await supabase.from('screenings').select('id, title').in('id', scIds)
        : { data: [] };
      const scMap = new Map((screenings ?? []).map((s: { id: string; title: string }) => [s.id, s.title]));

      await sendReceiptEmail({
        to: toEmail,
        orderRef: event.order_external_ref ?? null,
        cashierName: event.order_cashier ?? event.who,
        items: (lines ?? []).map((l: { label: string; qty: number; unit_price_cents: number; screening_id: string }) => ({
          label: l.label,
          screeningTitle: scMap.get(l.screening_id) ?? l.label,
          qty: l.qty,
          unitPriceCents: l.unit_price_cents,
        })),
        totalCents: event.amount_cents,
        payMethod: event.order_source === 'external_heartland' ? 'external' : 'cash',
      });
      setEmailResult((prev) => ({ ...prev, [event.order_id!]: 'sent' }));
      setEmailFor(null);
    } catch {
      setEmailResult((prev) => ({ ...prev, [event.order_id!]: 'error' }));
    } finally {
      setEmailSending(false);
    }
  }

  async function toggleOrderExpand(orderId: string) {
    if (expandedOrderId === orderId) {
      setExpandedOrderId(null);
      setExpandedLines([]);
      setDeleteConfirmId(null);
      return;
    }
    setExpandedOrderId(orderId);
    setExpandedLines([]);
    setDeleteConfirmId(null);
    setLinesLoading(true);
    try {
      const lines = await getCheckinLinesForOrder(orderId);
      setExpandedLines(lines);
    } catch { /* ignore */ } finally {
      setLinesLoading(false);
    }
  }

  // Sales events: count + sum, excluding voided (offsetting adjustment handles math).
  const salesEvents = events.filter((e) => e.kind === 'sale' && !e.order_voided);
  const salesCents = salesEvents.reduce((s, e) => s + e.amount_cents, 0);
  const salesCount = salesEvents.length;
  // Add/removal/adjustment events: skip voided rows from totals (their voided_at is
  // set, so reports.ts and this view both treat them as if they didn't happen).
  const isLive = (e: EnrichedEvent) => !e.voided_at;
  const adjustments = events.filter((e) => e.kind === 'adjustment' && isLive(e));
  const adjustmentsCents = adjustments.reduce((s, e) => s + e.amount_cents, 0);
  const adds = events.filter((e) => e.kind === 'add' && isLive(e));
  const addsCents = adds.reduce((s, e) => s + e.amount_cents, 0);
  const removals = events.filter((e) => e.kind === 'removal' && isLive(e));
  const removalsCents = removals.reduce((s, e) => s + e.amount_cents, 0); // already negative
  // Expected uses all sale events (voids get offset by the adjustment row automatically).
  const rawSales = events.filter((e) => e.kind === 'sale').reduce((s, e) => s + e.amount_cents, 0);
  const expectedCents = drawer.opening_cents + rawSales + adjustmentsCents + addsCents + removalsCents;

  const countedCents = totalFromDenoms(denoms);
  const varianceCents = countedCents - expectedCents;

  return (
    <>
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 mb-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
          <Stat label="Opening" value={money(drawer.opening_cents)} />
          <Stat label={`Sales (${salesCount})`} value={money(salesCents)} tone="pos" />
          {addsCents !== 0 && <Stat label={`Added (${adds.length})`} value={money(addsCents)} tone="pos" />}
          {adjustmentsCents !== 0 && <Stat label={`Adjustments (${adjustments.length})`} value={money(adjustmentsCents)} tone={adjustmentsCents < 0 ? 'neg' : 'pos'} />}
          <Stat label={`Removals (${removals.length})`} value={money(removalsCents)} tone={removalsCents < 0 ? 'neg' : undefined} />
          <Stat label="Expected in drawer" value={money(expectedCents)} bold />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <button
            onClick={() => { setShowTest(!showTest); setShowAdd(false); setShowRemove(false); setShowClose(false); }}
            className="bg-slate-700 hover:bg-slate-600 text-white font-semibold py-3 rounded-lg"
          >
            {showTest ? 'Cancel' : 'Test count'}
          </button>
          <button
            onClick={() => { setShowAdd(!showAdd); setShowTest(false); setShowRemove(false); setShowClose(false); }}
            className="bg-emerald-800 hover:bg-emerald-700 text-white font-semibold py-3 rounded-lg"
          >
            {showAdd ? 'Cancel' : 'Add cash'}
          </button>
          <button
            onClick={() => { setShowRemove(!showRemove); setShowAdd(false); setShowTest(false); setShowClose(false); }}
            className="bg-slate-700 hover:bg-slate-600 text-white font-semibold py-3 rounded-lg"
          >
            {showRemove ? 'Cancel' : 'Remove cash'}
          </button>
          <button
            onClick={() => { setShowClose(!showClose); setShowAdd(false); setShowTest(false); setShowRemove(false); }}
            className="bg-red-800 hover:bg-red-700 text-white font-semibold py-3 rounded-lg"
          >
            {showClose ? 'Cancel' : 'Close (end shift)'}
          </button>
        </div>

        {showTest && (
          <div className="mt-4 bg-slate-900 border border-slate-700 rounded-lg p-3">
            <div className="text-sm font-semibold mb-1">Test count (draft — does not close drawer)</div>
            <div className="text-xs text-slate-400 mb-2">
              Count each denomination to spot-check the drawer. Saves a snapshot you can review in reports; drawer stays open.
            </div>
            <DenomCounter value={testDenoms} onChange={setTestDenoms} />
            <input
              className="mt-2 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2"
              placeholder="Notes (optional)"
              value={testNotes}
              onChange={(e) => setTestNotes(e.target.value)}
            />
            {testErr && <div className="text-red-400 text-sm mt-2">{testErr}</div>}
            <button
              disabled={testBusy || totalFromDenoms(testDenoms) === 0}
              onClick={async () => {
                setTestErr(null); setTestBusy(true);
                try {
                  await saveTestCount({
                    drawerId: drawer.id,
                    who: cashierName,
                    denoms: testDenoms,
                    countedCents: totalFromDenoms(testDenoms),
                    expectedCents,
                    notes: testNotes.trim() || null
                  });
                  setTestDenoms({});
                  setTestNotes('');
                  setShowTest(false);
                  onRefresh();
                } catch (e: unknown) {
                  setTestErr(e instanceof Error ? e.message : 'Save failed');
                } finally { setTestBusy(false); }
              }}
              className="mt-3 w-full bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white font-bold py-3 rounded-lg"
            >
              {testBusy ? 'Saving…' : `Save test count · ${money(totalFromDenoms(testDenoms))}`}
            </button>
          </div>
        )}

        {showAdd && (
          <div className="mt-4 bg-slate-900 border border-slate-700 rounded-lg p-3">
            <div className="text-sm font-semibold mb-2">Add cash to drawer</div>
            <div className="text-xs text-slate-400 mb-2">e.g. bringing more small bills or a larger float from the safe.</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <input
                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2"
                type="number" step="0.01" min="0" inputMode="decimal"
                placeholder="Amount $"
                value={addAmt}
                onChange={(e) => setAddAmt(e.target.value)}
              />
              <input
                className="sm:col-span-2 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2"
                placeholder="Reason (where from, etc.)"
                value={addReason}
                onChange={(e) => setAddReason(e.target.value)}
              />
            </div>
            <button
              disabled={busy || !addAmt || !addReason.trim()}
              onClick={() => {
                onAdd({ amountCents: toCents(parseFloat(addAmt)), reason: addReason.trim() });
                setAddAmt('');
                setAddReason('');
                setShowAdd(false);
              }}
              className="mt-2 w-full bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white font-semibold py-2 rounded-lg"
            >
              Record cash added
            </button>
          </div>
        )}

        {showRemove && (
          <div className="mt-4 bg-slate-900 border border-slate-700 rounded-lg p-3">
            <div className="text-sm font-semibold mb-2">Remove cash</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <input
                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2"
                type="number" step="0.01" min="0" inputMode="decimal"
                placeholder="Amount $"
                value={removeAmt}
                onChange={(e) => setRemoveAmt(e.target.value)}
              />
              <input
                className="sm:col-span-2 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2"
                placeholder="Reason (who + why)"
                value={removeReason}
                onChange={(e) => setRemoveReason(e.target.value)}
              />
            </div>
            <button
              disabled={busy || !removeAmt || !removeReason.trim()}
              onClick={() => {
                onRemove({ amountCents: toCents(parseFloat(removeAmt)), reason: removeReason.trim() });
                setRemoveAmt('');
                setRemoveReason('');
                setShowRemove(false);
              }}
              className="mt-2 w-full bg-amber-700 hover:bg-amber-600 disabled:opacity-50 text-white font-semibold py-2 rounded-lg"
            >
              Record removal
            </button>
          </div>
        )}

        {showClose && (
          <div className="mt-4 bg-slate-900 border border-slate-700 rounded-lg p-3">
            <div className="text-sm font-semibold mb-2">Close drawer — count each denomination</div>
            <DenomCounter value={denoms} onChange={setDenoms} />
            {countedCents > 0 && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2">
                  <div className="text-xs uppercase text-slate-400">Expected</div>
                  <div className="text-lg font-bold tabular-nums">{money(expectedCents)}</div>
                </div>
                <div className={`border rounded-lg px-3 py-2 ${
                  varianceCents === 0 ? 'bg-emerald-900/40 border-emerald-700' :
                  varianceCents > 0 ? 'bg-amber-900/40 border-amber-700' : 'bg-red-900/40 border-red-700'
                }`}>
                  <div className="text-xs uppercase text-slate-300">Variance</div>
                  <div className={`text-lg font-bold tabular-nums ${
                    varianceCents === 0 ? 'text-emerald-300' :
                    varianceCents > 0 ? 'text-amber-300' : 'text-red-300'
                  }`}>
                    {varianceCents > 0 ? '+' : ''}{money(varianceCents)}
                  </div>
                </div>
              </div>
            )}
            <button
              disabled={busy || countedCents === 0}
              onClick={() => {
                if (confirm(`Close drawer with counted ${money(countedCents)}? This cannot be reopened.`)) {
                  onClose({ countedCents, denoms });
                  setDenoms({});
                  setShowClose(false);
                }
              }}
              className="mt-3 w-full bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white font-bold py-3 rounded-lg"
            >
              Close drawer · {money(countedCents)}
            </button>
          </div>
        )}
      </div>

      {testCounts.length > 0 && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 mb-4">
          <div className="text-sm font-semibold mb-3">Test counts ({testCounts.length}) — drafts only</div>
          <ul className="divide-y divide-slate-700">
            {testCounts.map((t) => (
              <li key={t.id} className="py-2 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm">
                    <span className="text-slate-300 font-semibold">{money(t.counted_cents)} counted</span>
                    <span className="text-slate-500"> · expected {money(t.expected_cents)}</span>
                    {t.notes && <span className="text-slate-400"> — {t.notes}</span>}
                  </div>
                  <div className="text-xs text-slate-500">
                    {new Date(t.created_at).toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })} · {t.who}
                  </div>
                </div>
                <div className={`tabular-nums font-semibold ${
                  t.variance_cents === 0 ? 'text-emerald-400' :
                  t.variance_cents > 0 ? 'text-amber-300' : 'text-red-400'
                }`}>
                  {t.variance_cents >= 0 ? '+' : ''}{money(t.variance_cents)}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
        <div className="text-sm font-semibold mb-3">Activity ({events.length})</div>
        {events.length === 0 ? (
          <div className="text-slate-500 text-sm">No events yet.</div>
        ) : (
          <ul className="divide-y divide-slate-700">
            {events.map((e) => {
              const saleVoided = e.kind === 'sale' && e.order_voided;
              const cashEventVoided = e.kind !== 'sale' && !!e.voided_at;
              const isVoided = saleVoided || cashEventVoided;
              const canVoidCashEvent =
                e.kind !== 'sale' && e.kind !== 'open' && e.kind !== 'close' && !cashEventVoided;
              const canVoidSale = e.kind === 'sale' && !saleVoided && !!e.order_id;
              const canDelete = isSuperAdmin && e.kind !== 'open' && e.kind !== 'close';
              const canExpand = e.kind === 'sale' && !!e.order_id;
              const isExpanded = expandedOrderId === e.order_id;
              const _d = new Date(e.created_at);
              const timeLabel = `${_d.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'numeric', day: 'numeric' })} @ ${_d.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })}`;
              return (
                <li key={e.id} className="py-2">
                  {/* Main row */}
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm flex items-baseline gap-1.5 flex-wrap">
                        <span
                          className={
                            isVoided
                              ? 'text-slate-500 line-through'
                              : e.kind === 'sale'
                                ? 'text-emerald-400'
                                : e.kind === 'removal'
                                  ? 'text-amber-400'
                                  : e.kind === 'add'
                                    ? 'text-cyan-400'
                                    : e.kind === 'open'
                                      ? 'text-slate-300'
                                      : e.kind === 'close'
                                        ? 'text-red-400'
                                        : e.kind === 'adjustment'
                                          ? 'text-rose-400'
                                          : 'text-slate-400'
                          }
                        >
                          {e.kind}
                          {isVoided ? ' (voided)' : ''}
                        </span>
                        {e.reason && <span className="text-slate-400"> — {e.reason}</span>}
                        {/* Customer name inline on the sale line */}
                        {e.kind === 'sale' && !isVoided && (
                          <button
                            onClick={() => {
                              setEditingCustomer(e.order_id!);
                              setCustomerNameDraft(e.order_customer_name ?? '');
                              setCustomerEmailDraft(e.order_customer_email ?? '');
                              setEmailFor(null);
                            }}
                            className="flex items-center gap-1 group"
                          >
                            {e.order_customer_name || e.order_customer_email ? (
                              <span className="text-indigo-300 group-hover:text-indigo-200 text-sm font-medium">
                                {[e.order_customer_name, e.order_customer_email].filter(Boolean).join(' · ')}
                              </span>
                            ) : (
                              <span className="text-slate-600 italic text-xs group-hover:text-slate-400">+ add name</span>
                            )}
                            <span className="opacity-0 group-hover:opacity-100 text-slate-500 text-[10px]">✎</span>
                          </button>
                        )}
                      </div>
                      <div className="text-xs text-slate-500">
                        {timeLabel} · {e.who}
                        {e.order_device && <> · {e.order_device}</>}
                        {cashEventVoided && e.voided_by && (
                          <> · voided by {e.voided_by}{e.void_reason ? ` (${e.void_reason})` : ''}</>
                        )}
                      </div>
                      {/* Inline item summary for sale events */}
                      {e.kind === 'sale' && e.order_items && e.order_items.length > 0 && (
                        <div className="mt-0.5 space-y-0">
                          {e.order_items.map((item, idx) => (
                            <div key={idx} className={`text-xs ${isVoided ? 'text-slate-600' : 'text-slate-400'}`}>
                              {item.qty > 1 && <span className="tabular-nums">{item.qty}× </span>}
                              {item.label}
                              {item.screeningTitle && item.screeningTitle !== item.label && (
                                <span className="text-slate-500"> · {item.screeningTitle}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div
                      className={`tabular-nums font-semibold ${
                        isVoided ? 'text-slate-500 line-through' : e.amount_cents < 0 ? 'text-red-400' : ''
                      }`}
                    >
                      {e.amount_cents < 0 ? '' : '+'}{money(e.amount_cents)}
                    </div>
                    <div className="flex gap-1 flex-wrap">
                      {canExpand && (
                        <button
                          onClick={() => toggleOrderExpand(e.order_id!)}
                          className={`text-xs px-2 py-1 rounded ${
                            isExpanded
                              ? 'bg-slate-600 text-white'
                              : 'bg-slate-700 hover:bg-slate-600 text-slate-300'
                          }`}
                        >
                          {isExpanded ? '▾ Tickets' : '▸ Tickets'}
                        </button>
                      )}
                      {canExpand && !isVoided && (
                        emailResult[e.order_id!] === 'sent' ? (
                          <span className="text-xs text-emerald-400 px-2 py-1">✓ Sent</span>
                        ) : emailResult[e.order_id!] === 'error' ? (
                          <span className="text-xs text-red-400 px-2 py-1">Failed</span>
                        ) : (
                          <button
                            onClick={() => {
                              setEmailFor(e.order_id!);
                              setEmailInput(e.order_customer_email ?? '');
                            }}
                            className="text-xs bg-indigo-700 hover:bg-indigo-600 text-white px-2 py-1 rounded"
                          >
                            📧
                          </button>
                        )
                      )}
                      {canVoidSale && (
                        <button
                          onClick={() =>
                            onVoidRequest({
                              mode: 'order',
                              id: e.order_id!,
                              amountCents: e.amount_cents,
                              description: `Sale · ${e.who} · ${timeLabel}`
                            })
                          }
                          className="text-xs bg-slate-700 hover:bg-red-800 text-slate-300 hover:text-white px-2 py-1 rounded"
                        >
                          Void
                        </button>
                      )}
                      {canVoidCashEvent && (
                        <button
                          onClick={() =>
                            onVoidRequest({
                              mode: 'cash_event',
                              id: e.id,
                              amountCents: e.amount_cents,
                              description: `${e.kind} · ${e.who} · ${timeLabel}${e.reason ? ` — ${e.reason}` : ''}`
                            })
                          }
                          className="text-xs bg-slate-700 hover:bg-red-800 text-slate-300 hover:text-white px-2 py-1 rounded"
                        >
                          Void
                        </button>
                      )}
                      {canDelete && (
                        <button
                          onClick={() =>
                            onDeleteRequest(
                              e.kind === 'sale' && e.order_id
                                ? {
                                    mode: 'order',
                                    id: e.order_id,
                                    amountCents: e.amount_cents,
                                    description: `Sale · ${e.who} · ${timeLabel}`
                                  }
                                : {
                                    mode: 'cash_event',
                                    id: e.id,
                                    amountCents: e.amount_cents,
                                    description: `${e.kind} · ${e.who} · ${timeLabel}${e.reason ? ` — ${e.reason}` : ''}`
                                  }
                            )
                          }
                          className="text-xs bg-slate-800 hover:bg-red-900 text-red-300 hover:text-white px-2 py-1 rounded border border-red-900/50"
                        >
                          ✕ Delete
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Inline customer name/email editor */}
                  {e.kind === 'sale' && editingCustomer === e.order_id && (
                    <div className="mt-2 space-y-1.5">
                      <div className="flex gap-2 items-center">
                        <input
                          autoFocus
                          className="flex-1 bg-slate-900 border border-indigo-600 rounded-lg px-3 py-1.5 text-sm"
                          placeholder="Customer name"
                          value={customerNameDraft}
                          onChange={(ev) => setCustomerNameDraft(ev.target.value)}
                          onKeyDown={(ev) => { if (ev.key === 'Escape') setEditingCustomer(null); }}
                          autoCapitalize="words"
                        />
                      </div>
                      <div className="flex gap-2 items-center">
                        <input
                          type="email"
                          inputMode="email"
                          autoCapitalize="off"
                          className="flex-1 bg-slate-900 border border-indigo-600 rounded-lg px-3 py-1.5 text-sm"
                          placeholder="email@example.com (optional)"
                          value={customerEmailDraft}
                          onChange={(ev) => setCustomerEmailDraft(ev.target.value)}
                          onKeyDown={(ev) => {
                            if (ev.key === 'Enter') saveCustomer(e.order_id!);
                            if (ev.key === 'Escape') setEditingCustomer(null);
                          }}
                        />
                        <button
                          disabled={customerSaving}
                          onClick={() => saveCustomer(e.order_id!)}
                          className="bg-indigo-700 hover:bg-indigo-600 disabled:opacity-40 text-white text-sm font-semibold px-3 py-1.5 rounded-lg whitespace-nowrap"
                        >{customerSaving ? '…' : 'Save'}</button>
                        <button
                          onClick={() => setEditingCustomer(null)}
                          className="text-slate-500 hover:text-white text-sm px-2"
                        >✕</button>
                      </div>
                    </div>
                  )}

                  {/* Inline email input */}
                  {canExpand && emailFor === e.order_id && (
                    <div className="mt-2 flex gap-2 items-center">
                      <input
                        autoFocus
                        type="email"
                        inputMode="email"
                        autoCapitalize="off"
                        className="flex-1 bg-slate-900 border border-indigo-600 rounded-lg px-3 py-1.5 text-sm"
                        placeholder="customer@email.com"
                        value={emailInput}
                        onChange={(e2) => setEmailInput(e2.target.value)}
                        onKeyDown={(e2) => { if (e2.key === 'Enter') sendReceipt(e, emailInput); }}
                      />
                      <button
                        disabled={emailSending || !emailInput.includes('@')}
                        onClick={() => sendReceipt(e, emailInput)}
                        className="bg-indigo-700 hover:bg-indigo-600 disabled:opacity-40 text-white text-sm font-semibold px-3 py-1.5 rounded-lg whitespace-nowrap"
                      >
                        {emailSending ? '…' : 'Send'}
                      </button>
                      <button
                        onClick={() => setEmailFor(null)}
                        className="text-slate-500 hover:text-white text-sm px-2"
                      >✕</button>
                    </div>
                  )}

                  {/* Expanded ticket lines */}
                  {canExpand && isExpanded && (
                    <div className="mt-2 ml-1 border-l-2 border-slate-700 pl-3 space-y-2">
                      {linesLoading ? (
                        <div className="text-xs text-slate-500 py-1">Loading tickets…</div>
                      ) : expandedLines.length === 0 ? (
                        <div className="text-xs text-slate-500 py-1">No ticket lines found.</div>
                      ) : (
                        expandedLines.map((line) => (
                          <div key={line.id} className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              {line.screenings && (
                                <div className="text-xs text-slate-500">
                                  {line.screenings.title}
                                  {!line.screenings.is_always_available && ` · ${fmtTime(line.screenings.starts_at)}`}
                                </div>
                              )}
                              <div className="text-sm text-slate-200">
                                {line.label}{line.qty > 1 ? ` ×${line.qty}` : ''}
                                {line.checked_in_at && (
                                  <span className="ml-1.5 text-emerald-400 text-xs">✓ checked in</span>
                                )}
                              </div>
                              {line.patron_name && (
                                <div className="text-xs text-slate-400">{line.patron_name}</div>
                              )}
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-xs text-slate-400 tabular-nums">
                                {money(line.qty * line.unit_price_cents)}
                              </span>
                              {isSuperAdmin && (
                                deleteConfirmId === line.id ? (
                                  <div className="flex gap-1">
                                    <button
                                      onClick={async () => {
                                        await deleteOrderLine(line.id);
                                        setExpandedLines((prev) => prev.filter((l) => l.id !== line.id));
                                        setDeleteConfirmId(null);
                                        onRefresh();
                                      }}
                                      className="text-xs bg-red-700 hover:bg-red-600 text-white px-2 py-1 rounded"
                                    >
                                      Confirm
                                    </button>
                                    <button
                                      onClick={() => setDeleteConfirmId(null)}
                                      className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-2 py-1 rounded"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => setDeleteConfirmId(line.id)}
                                    className="text-xs text-red-400 hover:text-white bg-red-900/30 hover:bg-red-800 px-2 py-1 rounded"
                                  >
                                    Delete
                                  </button>
                                )
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}

function Stat({ label, value, tone, bold }: { label: string; value: string; tone?: 'pos' | 'neg'; bold?: boolean }) {
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-3">
      <div className="text-xs uppercase text-slate-400">{label}</div>
      <div className={`tabular-nums ${bold ? 'text-xl font-bold' : 'text-lg font-semibold'} ${
        tone === 'pos' ? 'text-emerald-400' : tone === 'neg' ? 'text-red-400' : ''
      }`}>
        {value}
      </div>
    </div>
  );
}
