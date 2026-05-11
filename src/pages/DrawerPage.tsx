import { useCallback, useEffect, useState } from 'react';
import { useSession } from '../lib/session';
import { money, toCents } from '../lib/money';
import {
  addCash,
  closeDrawer,
  getOpenDrawer,
  listClosedDrawers,
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
import { InputPromptModal } from '../components/InputPromptModal';
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
  const [showPast, setShowPast] = useState(false);
  const [pastDrawers, setPastDrawers] = useState<CashDrawerRow[]>([]);
  const [pastLoading, setPastLoading] = useState(false);
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

  async function togglePast() {
    // Always re-fetch when opening the panel so newly-closed drawers appear
    if (!showPast) {
      setPastLoading(true);
      try {
        setPastDrawers(await listClosedDrawers());
      } catch (e: unknown) {
        setErr(e instanceof Error ? e.message : 'Failed to load past drawers');
      } finally {
        setPastLoading(false);
      }
    }
    setShowPast(v => !v);
  }

  if (!user || !deviceLabel) return <div className="p-6 text-slate-400">Sign in first.</div>;
  if (loading) return <div className="p-6 text-slate-400">Loading…</div>;

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <h1 className="text-2xl font-bold">Cash Drawer</h1>
        <button
          onClick={togglePast}
          className={`text-sm font-semibold px-3 py-1 rounded-lg transition-colors ${
            showPast
              ? 'bg-indigo-700 text-white'
              : 'bg-slate-700 hover:bg-slate-600 text-slate-300'
          }`}
        >
          Past
        </button>
      </div>
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

      {/* ── Past shifts ── */}
      {showPast && (
        <div className="mt-6 space-y-3">
          <div className="text-sm font-semibold text-slate-400 uppercase tracking-wide">Past shifts</div>
          {pastLoading && <div className="text-slate-500 text-sm">Loading…</div>}
          {!pastLoading && pastDrawers.length === 0 && (
            <div className="text-slate-500 text-sm">No past shifts found.</div>
          )}
          {pastDrawers.map((d) => (
            <PastDrawerSection
              key={d.id}
              drawer={d}
              isSuperAdmin={isSuperAdmin}
              onVoidRequest={(t) => setVoidFor(t)}
              onDeleteRequest={(t) => setDeleteFor(t)}
            />
          ))}
        </div>
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

// ─────────────────────────────────────────────────────────────────────────────
// OpenDrawerForm
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// OpenDrawerView  (current shift)
// ─────────────────────────────────────────────────────────────────────────────

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
  onVoidRequest: (p: ActionTarget) => void;
  onDeleteRequest: (p: ActionTarget) => void;
  onRefresh: () => void;
}

function OpenDrawerView({
  drawer, events, testCounts, cashierName, busy, isSuperAdmin,
  onRemove, onAdd, onClose, onVoidRequest, onDeleteRequest, onRefresh
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

  // Stats
  const salesEvents = events.filter((e) => e.kind === 'sale' && !e.order_voided);
  const salesCents = salesEvents.reduce((s, e) => s + e.amount_cents, 0);
  const salesCount = salesEvents.length;
  const isLive = (e: EnrichedEvent) => !e.voided_at;
  const adjustments = events.filter((e) => e.kind === 'adjustment' && isLive(e));
  const adjustmentsCents = adjustments.reduce((s, e) => s + e.amount_cents, 0);
  const adds = events.filter((e) => e.kind === 'add' && isLive(e));
  const addsCents = adds.reduce((s, e) => s + e.amount_cents, 0);
  const removals = events.filter((e) => e.kind === 'removal' && isLive(e));
  const removalsCents = removals.reduce((s, e) => s + e.amount_cents, 0);
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
                setAddAmt(''); setAddReason(''); setShowAdd(false);
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
                setRemoveAmt(''); setRemoveReason(''); setShowRemove(false);
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
        <DrawerActivityList
          events={events}
          isSuperAdmin={isSuperAdmin}
          onVoidRequest={onVoidRequest}
          onDeleteRequest={onDeleteRequest}
          onRefresh={onRefresh}
        />
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DrawerActivityList — shared activity log with full wiring
// ─────────────────────────────────────────────────────────────────────────────

interface ActivityListProps {
  events: EnrichedEvent[];
  isSuperAdmin: boolean;
  onVoidRequest: (p: ActionTarget) => void;
  onDeleteRequest: (p: ActionTarget) => void;
  onRefresh: () => void | Promise<void>;
}

function DrawerActivityList({ events, isSuperAdmin, onVoidRequest, onDeleteRequest, onRefresh }: ActivityListProps) {
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [expandedLines, setExpandedLines] = useState<OrderLineWithScreening[]>([]);
  const [linesLoading, setLinesLoading] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [emailFor, setEmailFor] = useState<string | null>(null);
  const [emailInput, setEmailInput] = useState('');
  const [emailSending, setEmailSending] = useState(false);
  const [emailResult, setEmailResult] = useState<Record<string, 'sent' | 'error'>>({});
  const [editingCustomer, setEditingCustomer] = useState<string | null>(null);
  const [customerNameDraft, setCustomerNameDraft] = useState('');
  const [customerEmailDraft, setCustomerEmailDraft] = useState('');
  const [customerSaving, setCustomerSaving] = useState(false);
  const [editingCash, setEditingCash] = useState<string | null>(null); // order_id
  const [tenderedDraft, setTenderedDraft] = useState('');
  const [changeDraft, setChangeDraft] = useState('');
  const [cashSaving, setCashSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [editReasonDraft, setEditReasonDraft] = useState('');

  async function saveCustomer(orderId: string) {
    setCustomerSaving(true);
    try {
      const { error } = await supabase.from('orders').update({
        customer_name: customerNameDraft.trim() || null,
        customer_email: customerEmailDraft.trim() || null,
      }).eq('id', orderId);
      if (error) throw error;
      setEditingCustomer(null);
      onRefresh();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setCustomerSaving(false);
    }
  }

  async function saveCash(orderId: string) {
    setCashSaving(true);
    try {
      const tendered = Math.round(parseFloat(tenderedDraft.replace(/[^0-9.]/g, '')) * 100) || 0;
      const change   = Math.round(parseFloat(changeDraft.replace(/[^0-9.]/g, ''))   * 100) || 0;
      const { error } = await supabase.from('orders').update({
        cash_tendered_cents: tendered,
        change_cents: change,
      }).eq('id', orderId);
      if (error) throw error;
      setEditingCash(null);
      onRefresh();
    } catch (e: unknown) {
      setSaveErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setCashSaving(false);
    }
  }

  async function sendReceipt(event: EnrichedEvent, toEmail: string) {
    if (!toEmail.includes('@') || emailSending) return;
    setEmailSending(true);
    try {
      const { data: lines } = await supabase
        .from('order_lines')
        .select('label, qty, unit_price_cents, screening_id')
        .eq('order_id', event.order_id!);
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

  if (events.length === 0) return <div className="text-slate-500 text-sm">No events yet.</div>;

  return (
    <>
      {editingEventId && (
        <InputPromptModal
          title="Edit description"
          label="Description"
          initial={editReasonDraft}
          placeholder="e.g. Change for $100 bill"
          confirmLabel="Save"
          onClose={() => setEditingEventId(null)}
          onConfirm={async (newReason) => {
            try {
              const { error } = await supabase
                .from('cash_events')
                .update({ reason: newReason || null })
                .eq('id', editingEventId);
              if (error) throw error;
              setEditingEventId(null);
              onRefresh();
            } catch (e: unknown) {
              alert(e instanceof Error ? e.message : 'Save failed');
            }
          }}
        />
      )}
      <ul className="divide-y divide-slate-700">
        {events.map((e) => {
          const saleVoided = e.kind === 'sale' && e.order_voided;
          const cashEventVoided = e.kind !== 'sale' && !!e.voided_at;
          const isVoided = saleVoided || cashEventVoided;
          const canVoidCashEvent =
            e.kind !== 'sale' && e.kind !== 'open' && e.kind !== 'close' && !cashEventVoided;
          const canVoidSale = e.kind === 'sale' && !saleVoided && !!e.order_id;
          const canDelete = isSuperAdmin && e.kind !== 'open' && e.kind !== 'close';
          const canEditReason = isSuperAdmin && ['removal', 'add', 'adjustment'].includes(e.kind);
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
                    <span className={
                      isVoided ? 'text-slate-500 line-through' :
                      e.kind === 'sale' ? 'text-emerald-400' :
                      e.kind === 'removal' ? 'text-amber-400' :
                      e.kind === 'add' ? 'text-cyan-400' :
                      e.kind === 'open' ? 'text-slate-300' :
                      e.kind === 'close' ? 'text-red-400' :
                      e.kind === 'adjustment' ? 'text-rose-400' : 'text-slate-400'
                    }>
                      {e.kind}{isVoided ? ' (voided)' : ''}
                    </span>
                    {canEditReason ? (
                      <button
                        onClick={() => { setEditingEventId(e.id); setEditReasonDraft(e.reason ?? ''); }}
                        className="text-slate-400 hover:text-slate-200 group"
                      >
                        {e.reason
                          ? ` — ${e.reason}`
                          : <span className="italic text-slate-600">+ add description</span>}
                        <span className="opacity-0 group-hover:opacity-100 text-slate-500 text-[10px] ml-1">✎</span>
                      </button>
                    ) : (
                      e.reason && <span className="text-slate-400"> — {e.reason}</span>
                    )}
                    {/* Customer name inline on sale line */}
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
                  {/* Inline item summary */}
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
                  {/* Cash tendered / change */}
                  {e.kind === 'sale' && e.order_source !== 'external_heartland' && !isVoided && (
                    isSuperAdmin ? (
                      <button
                        onClick={() => {
                          setEditingCash(e.order_id!);
                          setTenderedDraft(e.order_cash_tendered_cents ? (e.order_cash_tendered_cents / 100).toFixed(2) : '');
                          setChangeDraft(e.order_change_cents ? (e.order_change_cents / 100).toFixed(2) : '');
                          setEditingCustomer(null);
                          setSaveErr(null);
                        }}
                        className="mt-0.5 flex items-center gap-1 group"
                      >
                        {e.order_cash_tendered_cents ? (
                          <span className="text-xs text-slate-500">
                            Tendered {money(e.order_cash_tendered_cents)}
                            {e.order_change_cents ? ` · Change ${money(e.order_change_cents)}` : ''}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-700 italic group-hover:text-slate-500">+ tendered / change</span>
                        )}
                        <span className="opacity-0 group-hover:opacity-100 text-slate-600 text-[10px]">✎</span>
                      </button>
                    ) : (
                      (e.order_cash_tendered_cents ?? 0) > 0 && (
                        <div className="mt-0.5 text-xs text-slate-500">
                          Tendered {money(e.order_cash_tendered_cents!)}
                          {(e.order_change_cents ?? 0) > 0 && ` · Change ${money(e.order_change_cents!)}`}
                        </div>
                      )
                    )
                  )}
                </div>
                <div className={`tabular-nums font-semibold ${
                  isVoided ? 'text-slate-500 line-through' : e.amount_cents < 0 ? 'text-red-400' : ''
                }`}>
                  {e.amount_cents < 0 ? '' : '+'}{money(e.amount_cents)}
                </div>
                <div className="flex gap-1 flex-wrap">
                  {canExpand && (
                    <button
                      onClick={() => toggleOrderExpand(e.order_id!)}
                      className={`text-xs px-2 py-1 rounded ${
                        isExpanded ? 'bg-slate-600 text-white' : 'bg-slate-700 hover:bg-slate-600 text-slate-300'
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
                        onClick={() => { setEmailFor(e.order_id!); setEmailInput(e.order_customer_email ?? ''); }}
                        className="text-xs bg-indigo-700 hover:bg-indigo-600 text-white px-2 py-1 rounded"
                      >📧</button>
                    )
                  )}
                  {canVoidSale && (
                    <button
                      onClick={() => onVoidRequest({
                        mode: 'order', id: e.order_id!,
                        amountCents: e.amount_cents,
                        description: `Sale · ${e.who} · ${timeLabel}`
                      })}
                      className="text-xs bg-slate-700 hover:bg-red-800 text-slate-300 hover:text-white px-2 py-1 rounded"
                    >Void</button>
                  )}
                  {canVoidCashEvent && (
                    <button
                      onClick={() => onVoidRequest({
                        mode: 'cash_event', id: e.id,
                        amountCents: e.amount_cents,
                        description: `${e.kind} · ${e.who} · ${timeLabel}${e.reason ? ` — ${e.reason}` : ''}`
                      })}
                      className="text-xs bg-slate-700 hover:bg-red-800 text-slate-300 hover:text-white px-2 py-1 rounded"
                    >Void</button>
                  )}
                  {canDelete && (
                    <button
                      onClick={() => onDeleteRequest(
                        e.kind === 'sale' && e.order_id
                          ? { mode: 'order', id: e.order_id, amountCents: e.amount_cents, description: `Sale · ${e.who} · ${timeLabel}` }
                          : { mode: 'cash_event', id: e.id, amountCents: e.amount_cents, description: `${e.kind} · ${e.who} · ${timeLabel}${e.reason ? ` — ${e.reason}` : ''}` }
                      )}
                      className="text-xs bg-slate-800 hover:bg-red-900 text-red-300 hover:text-white px-2 py-1 rounded border border-red-900/50"
                    >✕ Delete</button>
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
                      type="email" inputMode="email" autoCapitalize="off"
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

              {/* Inline cash tendered / change editor (super admin only) */}
              {e.kind === 'sale' && isSuperAdmin && editingCash === e.order_id && (
                <div className="mt-2 space-y-1.5">
                  <div className="flex gap-2 items-center">
                    <span className="text-xs text-slate-400 w-20 shrink-0">Tendered</span>
                    <input
                      autoFocus
                      type="text" inputMode="decimal"
                      className="flex-1 bg-slate-900 border border-amber-600 rounded-lg px-3 py-1.5 text-sm tabular-nums"
                      placeholder="0.00"
                      value={tenderedDraft}
                      onChange={(ev) => setTenderedDraft(ev.target.value)}
                      onKeyDown={(ev) => { if (ev.key === 'Escape') setEditingCash(null); }}
                    />
                  </div>
                  <div className="flex gap-2 items-center">
                    <span className="text-xs text-slate-400 w-20 shrink-0">Change</span>
                    <input
                      type="text" inputMode="decimal"
                      className="flex-1 bg-slate-900 border border-amber-600 rounded-lg px-3 py-1.5 text-sm tabular-nums"
                      placeholder="0.00"
                      value={changeDraft}
                      onChange={(ev) => setChangeDraft(ev.target.value)}
                      onKeyDown={(ev) => {
                        if (ev.key === 'Enter') saveCash(e.order_id!);
                        if (ev.key === 'Escape') setEditingCash(null);
                      }}
                    />
                    <button
                      disabled={cashSaving}
                      onClick={() => saveCash(e.order_id!)}
                      className="bg-amber-700 hover:bg-amber-600 disabled:opacity-40 text-white text-sm font-semibold px-3 py-1.5 rounded-lg whitespace-nowrap"
                    >{cashSaving ? '…' : 'Save'}</button>
                    <button
                      onClick={() => { setEditingCash(null); setSaveErr(null); }}
                      className="text-slate-500 hover:text-white text-sm px-2"
                    >✕</button>
                  </div>
                  {saveErr && (
                    <div className="text-red-400 text-xs mt-1">{saveErr}</div>
                  )}
                </div>
              )}

              {/* Inline email input */}
              {canExpand && emailFor === e.order_id && (
                <div className="mt-2 flex gap-2 items-center">
                  <input
                    autoFocus type="email" inputMode="email" autoCapitalize="off"
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
                  >{emailSending ? '…' : 'Send'}</button>
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
                                >Confirm</button>
                                <button
                                  onClick={() => setDeleteConfirmId(null)}
                                  className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-2 py-1 rounded"
                                >Cancel</button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setDeleteConfirmId(line.id)}
                                className="text-xs text-red-400 hover:text-white bg-red-900/30 hover:bg-red-800 px-2 py-1 rounded"
                              >Delete</button>
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
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV export helper
// ─────────────────────────────────────────────────────────────────────────────

function csvCell(v: string | number | null | undefined): string {
  const s = v == null ? '' : String(v);
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}
function csvRow(cells: (string | number | null | undefined)[]) {
  return cells.map(csvCell).join(',');
}
function fmtNY(iso: string | null | undefined) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'numeric', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}
function downloadCSVFile(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function buildDrawerCSV(drawer: CashDrawerRow, events: EnrichedEvent[]): string {
  const isLive = (e: EnrichedEvent) => !e.voided_at;
  const salesCents = events.filter(e => e.kind === 'sale' && !e.order_voided).reduce((s, e) => s + e.amount_cents, 0);
  const addsCents  = events.filter(e => e.kind === 'add' && isLive(e)).reduce((s, e) => s + e.amount_cents, 0);
  const removCents = events.filter(e => e.kind === 'removal' && isLive(e)).reduce((s, e) => s + e.amount_cents, 0);
  const adjCents   = events.filter(e => e.kind === 'adjustment' && isLive(e)).reduce((s, e) => s + e.amount_cents, 0);
  const expectedCents = events.length > 0
    ? drawer.opening_cents + salesCents + adjCents + addsCents + removCents
    : null;
  const varianceCents = drawer.counted_cents != null && expectedCents != null
    ? drawer.counted_cents - expectedCents : null;

  const rows: string[] = [];

  // ── Summary section ──
  rows.push(csvRow(['HFFNY Cash Drawer Report']));
  rows.push(csvRow(['Date', fmtNY(drawer.opened_at)]));
  rows.push(csvRow(['Opened by', drawer.opened_by, 'Device', drawer.device_label]));
  rows.push(csvRow(['Closed by', drawer.closed_by ?? '', 'Closed at', fmtNY(drawer.closed_at)]));
  rows.push('');
  rows.push(csvRow(['Opening float', (drawer.opening_cents / 100).toFixed(2)]));
  rows.push(csvRow(['Cash sales', (salesCents / 100).toFixed(2)]));
  if (addsCents) rows.push(csvRow(['Cash added', (addsCents / 100).toFixed(2)]));
  if (removCents) rows.push(csvRow(['Cash removed', (removCents / 100).toFixed(2)]));
  if (adjCents)  rows.push(csvRow(['Adjustments', (adjCents / 100).toFixed(2)]));
  if (expectedCents != null) rows.push(csvRow(['Expected', (expectedCents / 100).toFixed(2)]));
  if (drawer.counted_cents != null) rows.push(csvRow(['Counted', (drawer.counted_cents / 100).toFixed(2)]));
  if (varianceCents != null) rows.push(csvRow(['Variance', (varianceCents / 100).toFixed(2)]));
  rows.push('');

  // ── Activity section ──
  rows.push(csvRow([
    'Time (NY)', 'Type', 'Amount', 'Reason / Items',
    'Who', 'Customer Name', 'Customer Email',
    'Cash Tendered', 'Change', 'Source', 'Voided',
  ]));

  for (const e of events) {
    const items = e.order_items
      ? e.order_items.map(i => `${i.qty}x ${i.label} (${i.screeningTitle})`).join('; ')
      : '';
    const reasonOrItems = items || e.reason || '';
    rows.push(csvRow([
      fmtNY(e.created_at),
      e.kind,
      (e.amount_cents / 100).toFixed(2),
      reasonOrItems,
      e.who,
      e.order_customer_name ?? '',
      e.order_customer_email ?? '',
      e.order_cash_tendered_cents != null ? (e.order_cash_tendered_cents / 100).toFixed(2) : '',
      e.order_change_cents != null ? (e.order_change_cents / 100).toFixed(2) : '',
      e.order_source ?? '',
      e.order_voided ? 'VOIDED' : e.voided_at ? 'VOIDED' : '',
    ]));
  }

  return rows.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// PastDrawerSection — one closed shift, lazy-loaded, collapsible
// ─────────────────────────────────────────────────────────────────────────────

function PastDrawerSection({
  drawer, isSuperAdmin, onVoidRequest, onDeleteRequest,
}: {
  drawer: CashDrawerRow;
  isSuperAdmin: boolean;
  onVoidRequest: (p: ActionTarget) => void;
  onDeleteRequest: (p: ActionTarget) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [events, setEvents] = useState<EnrichedEvent[]>([]);
  const [testCounts, setTestCounts] = useState<CashCountRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [ev, tc] = await Promise.all([loadDrawerActivity(drawer.id), listTestCounts(drawer.id)]);
      setEvents(ev);
      setTestCounts(tc);
    } catch (ex: unknown) {
      setErr(ex instanceof Error ? ex.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [drawer.id]);

  function toggle() {
    if (!expanded && events.length === 0) loadData();
    setExpanded((v) => !v);
  }

  async function handleDownload(e: React.MouseEvent) {
    e.stopPropagation(); // don't toggle expand
    setDownloading(true);
    try {
      // Load events if not already loaded
      let ev = events;
      if (ev.length === 0) {
        const [fetched] = await Promise.all([loadDrawerActivity(drawer.id)]);
        ev = fetched;
        setEvents(fetched);
      }
      const shiftDate = new Date(drawer.opened_at).toLocaleDateString('en-US', {
        timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
      }).replace(/\//g, '-');
      const csv = buildDrawerCSV(drawer, ev);
      downloadCSVFile(`drawer-${shiftDate}.csv`, csv);
    } catch (ex: unknown) {
      setErr(ex instanceof Error ? ex.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
  }

  // Stats (same formulas as OpenDrawerView)
  const isLive = (e: EnrichedEvent) => !e.voided_at;
  const salesEvents = events.filter((e) => e.kind === 'sale' && !e.order_voided);
  const salesCents = salesEvents.reduce((s, e) => s + e.amount_cents, 0);
  const salesCount = salesEvents.length;
  const adjustments = events.filter((e) => e.kind === 'adjustment' && isLive(e));
  const adjustmentsCents = adjustments.reduce((s, e) => s + e.amount_cents, 0);
  const adds = events.filter((e) => e.kind === 'add' && isLive(e));
  const addsCents = adds.reduce((s, e) => s + e.amount_cents, 0);
  const removals = events.filter((e) => e.kind === 'removal' && isLive(e));
  const removalsCents = removals.reduce((s, e) => s + e.amount_cents, 0);
  const rawSales = events.filter((e) => e.kind === 'sale').reduce((s, e) => s + e.amount_cents, 0);
  const expectedCents = events.length > 0
    ? drawer.opening_cents + rawSales + adjustmentsCents + addsCents + removalsCents
    : null;
  const varianceCents = drawer.counted_cents != null && expectedCents != null
    ? drawer.counted_cents - expectedCents
    : null;

  const shiftLabel = new Date(drawer.opened_at).toLocaleDateString('en-US', {
    timeZone: 'America/New_York', weekday: 'short', month: 'numeric', day: 'numeric',
  });

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
      {/* Collapsible header */}
      <button
        onClick={toggle}
        className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-slate-700/40 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0 flex-1 flex-wrap">
          <span className="text-slate-100 font-semibold">{shiftLabel}</span>
          <span className="text-xs text-slate-500">by {drawer.opened_by} · {drawer.device_label}</span>
          {varianceCents != null && (
            <span className={`text-xs font-semibold tabular-nums ${
              varianceCents === 0 ? 'text-emerald-400' :
              varianceCents > 0 ? 'text-amber-300' : 'text-red-400'
            }`}>
              {varianceCents > 0 ? '+' : ''}{money(varianceCents)} var
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {drawer.counted_cents != null && (
            <span className="text-slate-300 tabular-nums font-semibold text-sm">
              {money(drawer.counted_cents)} counted
            </span>
          )}
          <button
            onClick={handleDownload}
            disabled={downloading}
            title="Download CSV"
            className="text-slate-400 hover:text-white bg-slate-700 hover:bg-slate-600 disabled:opacity-40 rounded px-2 py-1 text-xs font-semibold"
          >
            {downloading ? '…' : '↓ CSV'}
          </button>
          <span className="text-slate-500 text-sm">{expanded ? '▾' : '▸'}</span>
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-slate-700 p-5">
          {err && <div className="text-red-400 text-sm mb-3">{err}</div>}
          {loading && <div className="text-slate-500 text-sm">Loading…</div>}

          {!loading && events.length > 0 && (
            <>
              {/* Stats */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
                <Stat label="Opening" value={money(drawer.opening_cents)} />
                <Stat label={`Sales (${salesCount})`} value={money(salesCents)} tone="pos" />
                {addsCents !== 0 && <Stat label={`Added (${adds.length})`} value={money(addsCents)} tone="pos" />}
                {adjustmentsCents !== 0 && (
                  <Stat label="Adjustments" value={money(adjustmentsCents)} tone={adjustmentsCents < 0 ? 'neg' : 'pos'} />
                )}
                <Stat label={`Removals (${removals.length})`} value={money(removalsCents)} tone={removalsCents < 0 ? 'neg' : undefined} />
                {expectedCents != null && <Stat label="Expected" value={money(expectedCents)} bold />}
                {drawer.counted_cents != null && (
                  <Stat label="Counted" value={money(drawer.counted_cents)} bold />
                )}
                {varianceCents != null && (
                  <div className={`border rounded-lg p-3 ${
                    varianceCents === 0 ? 'bg-emerald-900/40 border-emerald-700' :
                    varianceCents > 0 ? 'bg-amber-900/40 border-amber-700' : 'bg-red-900/40 border-red-700'
                  }`}>
                    <div className="text-xs uppercase text-slate-400">Variance</div>
                    <div className={`tabular-nums text-lg font-bold ${
                      varianceCents === 0 ? 'text-emerald-300' :
                      varianceCents > 0 ? 'text-amber-300' : 'text-red-300'
                    }`}>
                      {varianceCents > 0 ? '+' : ''}{money(varianceCents)}
                    </div>
                  </div>
                )}
              </div>

              {/* Test counts */}
              {testCounts.length > 0 && (
                <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 mb-4">
                  <div className="text-xs font-semibold text-slate-400 mb-2">Test counts ({testCounts.length})</div>
                  <ul className="divide-y divide-slate-700">
                    {testCounts.map((t) => (
                      <li key={t.id} className="py-1.5 flex items-start justify-between gap-3 text-sm">
                        <div>
                          <span className="text-slate-300 font-semibold">{money(t.counted_cents)} counted</span>
                          <span className="text-slate-500"> · expected {money(t.expected_cents)}</span>
                          {t.notes && <span className="text-slate-400"> — {t.notes}</span>}
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

              {/* Activity */}
              <div className="text-sm font-semibold mb-3">Activity ({events.length})</div>
              <DrawerActivityList
                events={events}
                isSuperAdmin={isSuperAdmin}
                onVoidRequest={onVoidRequest}
                onDeleteRequest={onDeleteRequest}
                onRefresh={loadData}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Stat chip
// ─────────────────────────────────────────────────────────────────────────────

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
