import { useCallback, useEffect, useState } from 'react';
import { useSession } from '../lib/session';
import { money, toCents } from '../lib/money';
import {
  closeDrawer,
  getOpenDrawer,
  loadDrawerEvents,
  openDrawer,
  removeCash
} from '../lib/drawer';
import type { CashDrawerRow, CashEventRow, DenomBreakdown } from '../lib/database.types';
import { DenomCounter, totalFromDenoms } from '../components/DenomCounter';

export function DrawerPage() {
  const { user, deviceLabel } = useSession();
  const [drawer, setDrawer] = useState<CashDrawerRow | null>(null);
  const [events, setEvents] = useState<CashEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setErr(null);
    try {
      const d = await getOpenDrawer();
      setDrawer(d);
      if (d) setEvents(await loadDrawerEvents(d.id));
      else setEvents([]);
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
          busy={busy}
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
  events: CashEventRow[];
  busy: boolean;
  onRemove: (p: { amountCents: number; reason: string }) => void;
  onClose: (p: { countedCents: number; denoms: DenomBreakdown }) => void;
}

function OpenDrawerView({ drawer, events, busy, onRemove, onClose }: OpenViewProps) {
  const [showRemove, setShowRemove] = useState(false);
  const [showClose, setShowClose] = useState(false);
  const [removeAmt, setRemoveAmt] = useState('');
  const [removeReason, setRemoveReason] = useState('');
  const [denoms, setDenoms] = useState<DenomBreakdown>({});

  const salesCents = events.filter((e) => e.kind === 'sale').reduce((s, e) => s + e.amount_cents, 0);
  const salesCount = events.filter((e) => e.kind === 'sale').length;
  const removals = events.filter((e) => e.kind === 'removal');
  const removalsCents = removals.reduce((s, e) => s + e.amount_cents, 0); // already negative
  const expectedCents = drawer.opening_cents + salesCents + removalsCents;

  const countedCents = totalFromDenoms(denoms);
  const varianceCents = countedCents - expectedCents;

  return (
    <>
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 mb-4">
        <div className="grid grid-cols-2 gap-3 mb-4">
          <Stat label="Opening" value={money(drawer.opening_cents)} />
          <Stat label={`Sales (${salesCount})`} value={money(salesCents)} tone="pos" />
          <Stat label={`Removals (${removals.length})`} value={money(removalsCents)} tone={removalsCents < 0 ? 'neg' : undefined} />
          <Stat label="Expected in drawer" value={money(expectedCents)} bold />
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setShowRemove(!showRemove)}
            className="flex-1 bg-slate-700 hover:bg-slate-600 text-white font-semibold py-3 rounded-lg"
          >
            {showRemove ? 'Cancel' : 'Remove cash'}
          </button>
          <button
            onClick={() => setShowClose(!showClose)}
            className="flex-1 bg-red-800 hover:bg-red-700 text-white font-semibold py-3 rounded-lg"
          >
            {showClose ? 'Cancel' : 'Close drawer'}
          </button>
        </div>

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

      <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
        <div className="text-sm font-semibold mb-3">Activity ({events.length})</div>
        {events.length === 0 ? (
          <div className="text-slate-500 text-sm">No events yet.</div>
        ) : (
          <ul className="divide-y divide-slate-700">
            {events.map((e) => (
              <li key={e.id} className="py-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm">
                    <span className={
                      e.kind === 'sale' ? 'text-emerald-400' :
                      e.kind === 'removal' ? 'text-amber-400' :
                      e.kind === 'open' ? 'text-slate-300' :
                      e.kind === 'close' ? 'text-red-400' : 'text-slate-400'
                    }>
                      {e.kind}
                    </span>
                    {e.reason && <span className="text-slate-400"> — {e.reason}</span>}
                  </div>
                  <div className="text-xs text-slate-500">
                    {new Date(e.created_at).toLocaleTimeString('en-US', { timeZone: 'America/New_York' })} · {e.who}
                  </div>
                </div>
                <div className={`tabular-nums font-semibold ${e.amount_cents < 0 ? 'text-red-400' : ''}`}>
                  {e.amount_cents < 0 ? '' : '+'}{money(e.amount_cents)}
                </div>
              </li>
            ))}
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
