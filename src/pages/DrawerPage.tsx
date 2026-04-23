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

export function DrawerPage() {
  const { user, deviceLabel } = useSession();
  const [drawer, setDrawer] = useState<CashDrawerRow | null>(null);
  const [events, setEvents] = useState<EnrichedEvent[]>([]);
  const [testCounts, setTestCounts] = useState<CashCountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [voidFor, setVoidFor] = useState<{ orderId: string; amountCents: number; description?: string } | null>(null);

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
          onVoidRequest={(o) => setVoidFor(o)}
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
          orderId={voidFor.orderId}
          orderAmountCents={voidFor.amountCents}
          orderDescription={voidFor.description}
          onClose={() => setVoidFor(null)}
          onDone={async () => { setVoidFor(null); await refresh(); }}
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
  onRemove: (p: { amountCents: number; reason: string }) => void;
  onAdd: (p: { amountCents: number; reason: string }) => void;
  onClose: (p: { countedCents: number; denoms: DenomBreakdown }) => void;
  onVoidRequest: (p: { orderId: string; amountCents: number; description?: string }) => void;
  onRefresh: () => void;
}

function OpenDrawerView({ drawer, events, testCounts, cashierName, busy, onRemove, onAdd, onClose, onVoidRequest, onRefresh }: OpenViewProps) {
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

  // Sales events: sum + count, excluding voided (the void inserts an offsetting adjustment,
  // but we still want "Sales" to reflect only non-voided money brought in).
  const salesEvents = events.filter((e) => e.kind === 'sale' && !e.order_voided);
  const salesCents = salesEvents.reduce((s, e) => s + e.amount_cents, 0);
  const adjustments = events.filter((e) => e.kind === 'adjustment');
  const adjustmentsCents = adjustments.reduce((s, e) => s + e.amount_cents, 0);
  const adds = events.filter((e) => e.kind === 'add');
  const addsCents = adds.reduce((s, e) => s + e.amount_cents, 0);
  const salesCount = salesEvents.length;
  const removals = events.filter((e) => e.kind === 'removal');
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
              const voided = e.kind === 'sale' && e.order_voided;
              return (
                <li key={e.id} className="py-2 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm">
                      <span className={
                        e.kind === 'sale' ? (voided ? 'text-slate-500 line-through' : 'text-emerald-400') :
                        e.kind === 'removal' ? 'text-amber-400' :
                        e.kind === 'add' ? 'text-cyan-400' :
                        e.kind === 'open' ? 'text-slate-300' :
                        e.kind === 'close' ? 'text-red-400' :
                        e.kind === 'adjustment' ? 'text-rose-400' : 'text-slate-400'
                      }>
                        {e.kind}{voided ? ' (voided)' : ''}
                      </span>
                      {e.reason && <span className="text-slate-400"> — {e.reason}</span>}
                    </div>
                    <div className="text-xs text-slate-500">
                      {new Date(e.created_at).toLocaleTimeString('en-US', { timeZone: 'America/New_York' })} · {e.who}
                      {e.order_device && <> · {e.order_device}</>}
                    </div>
                  </div>
                  <div className={`tabular-nums font-semibold ${voided ? 'text-slate-500 line-through' : e.amount_cents < 0 ? 'text-red-400' : ''}`}>
                    {e.amount_cents < 0 ? '' : '+'}{money(e.amount_cents)}
                  </div>
                  {e.kind === 'sale' && !voided && e.order_id && (
                    <button
                      onClick={() => onVoidRequest({
                        orderId: e.order_id!,
                        amountCents: e.amount_cents,
                        description: `${e.who} · ${new Date(e.created_at).toLocaleTimeString('en-US', { timeZone: 'America/New_York' })}`
                      })}
                      className="text-xs bg-slate-700 hover:bg-red-800 text-slate-300 hover:text-white px-2 py-1 rounded"
                    >Void</button>
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
