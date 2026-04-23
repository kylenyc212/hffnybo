import { useMemo, useState } from 'react';
import { DenomCounter, totalFromDenoms } from './DenomCounter';
import { money } from '../lib/money';
import { closeDrawer, saveTestCount } from '../lib/drawer';
import type { CashDrawerRow, DenomBreakdown } from '../lib/database.types';

interface Common {
  drawer: CashDrawerRow;
  expectedCents: number;
  who: string;
  onClose: () => void;
  onDone: () => void;
}

export function TestCountModal({ drawer, expectedCents, who, onClose, onDone }: Common) {
  const [denoms, setDenoms] = useState<DenomBreakdown>({});
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const counted = useMemo(() => totalFromDenoms(denoms), [denoms]);
  const variance = counted - expectedCents;

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-start justify-center overflow-auto p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl p-5 space-y-3 my-8">
        <div className="flex items-center justify-between">
          <div className="text-lg font-bold">Test count — draft only</div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white">✕</button>
        </div>
        <div className="text-xs text-slate-400">
          Counts the cash without closing the drawer. Saves a dated snapshot for reference.
        </div>
        <DenomCounter value={denoms} onChange={setDenoms} />
        <input
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2"
          placeholder="Notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        {counted > 0 && (
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Expected" value={money(expectedCents)} />
            <Stat
              label="Variance"
              value={`${variance >= 0 ? '+' : ''}${money(variance)}`}
              tone={variance === 0 ? 'pos' : variance > 0 ? 'warn' : 'neg'}
            />
          </div>
        )}
        {err && <div className="text-red-400 text-sm">{err}</div>}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 bg-slate-700 hover:bg-slate-600 text-white font-semibold py-3 rounded-lg">
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || counted === 0}
            onClick={async () => {
              setErr(null); setBusy(true);
              try {
                await saveTestCount({
                  drawerId: drawer.id,
                  who,
                  denoms,
                  countedCents: counted,
                  expectedCents,
                  notes: notes.trim() || null
                });
                onDone();
              } catch (e: unknown) {
                setErr(e instanceof Error ? e.message : 'Save failed');
              } finally { setBusy(false); }
            }}
            className="flex-1 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white font-bold py-3 rounded-lg"
          >
            {busy ? 'Saving…' : `Save · ${money(counted)}`}
          </button>
        </div>
      </div>
    </div>
  );
}

export function CloseDrawerModal({ drawer, expectedCents, who, onClose, onDone }: Common) {
  const [denoms, setDenoms] = useState<DenomBreakdown>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const counted = useMemo(() => totalFromDenoms(denoms), [denoms]);
  const variance = counted - expectedCents;

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-start justify-center overflow-auto p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl p-5 space-y-3 my-8">
        <div className="flex items-center justify-between">
          <div className="text-lg font-bold text-red-300">Close drawer — end of shift</div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white">✕</button>
        </div>
        <div className="text-xs text-amber-200 bg-amber-900/30 border border-amber-800 rounded p-2">
          This locks the drawer for the shift. Cashiers on all iPads will need to open a new drawer to ring paid sales again.
        </div>
        <DenomCounter value={denoms} onChange={setDenoms} />
        {counted > 0 && (
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Expected" value={money(expectedCents)} />
            <Stat
              label="Variance"
              value={`${variance >= 0 ? '+' : ''}${money(variance)}`}
              tone={variance === 0 ? 'pos' : variance > 0 ? 'warn' : 'neg'}
            />
          </div>
        )}
        {err && <div className="text-red-400 text-sm">{err}</div>}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 bg-slate-700 hover:bg-slate-600 text-white font-semibold py-3 rounded-lg">
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || counted === 0}
            onClick={() => {
              if (!confirm(`Close drawer with counted ${money(counted)}? This cannot be reopened.`)) return;
              setErr(null); setBusy(true);
              closeDrawer({
                drawerId: drawer.id,
                closedBy: who,
                countedCents: counted,
                closingDenoms: denoms
              })
                .then(onDone)
                .catch((e) => setErr(e instanceof Error ? e.message : 'Close failed'))
                .finally(() => setBusy(false));
            }}
            className="flex-1 bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white font-bold py-3 rounded-lg"
          >
            {busy ? 'Closing…' : `Close · ${money(counted)}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'pos' | 'neg' | 'warn' }) {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-3">
      <div className="text-xs uppercase text-slate-400">{label}</div>
      <div className={`text-lg font-bold tabular-nums ${
        tone === 'pos' ? 'text-emerald-400' :
        tone === 'neg' ? 'text-red-400' :
        tone === 'warn' ? 'text-amber-300' : ''
      }`}>{value}</div>
    </div>
  );
}
