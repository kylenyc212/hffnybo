import { useState } from 'react';
import { hardDeleteOrder, hardDeleteCashEvent } from '../lib/voids';
import { money } from '../lib/money';

type Mode = 'order' | 'cash_event';

interface Props {
  mode: Mode;
  targetId: string;
  amountCents: number;
  description?: string;
  onClose: () => void;
  onDone: () => void;
}

export function HardDeleteModal({
  mode,
  targetId,
  amountCents,
  description,
  onClose,
  onDone
}: Props) {
  const [pin, setPin] = useState('');
  const [reason, setReason] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (confirmText.trim().toUpperCase() !== 'DELETE') {
      setErr('Type DELETE to confirm.');
      return;
    }
    setBusy(true);
    const result =
      mode === 'order'
        ? await hardDeleteOrder({ orderId: targetId, superAdminPin: pin, reason })
        : await hardDeleteCashEvent({ eventId: targetId, superAdminPin: pin, reason });
    setBusy(false);
    if (!result.ok) { setErr(result.error); return; }
    onDone();
  }

  const title = mode === 'order' ? 'HARD DELETE transaction' : 'HARD DELETE cash event';

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
      <form
        onSubmit={submit}
        className="bg-slate-900 border-2 border-red-700 rounded-2xl w-full max-w-md p-5 space-y-3"
      >
        <div className="flex items-center justify-between">
          <div className="text-lg font-bold text-red-300">{title}</div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white">✕</button>
        </div>
        <div className="bg-red-950/40 border border-red-800 text-red-100 text-xs p-3 rounded-lg">
          ⚠️ This permanently removes the row from the database. There is no undo.
          Voiding (soft-delete) is the safer choice in almost every case. Use this only when
          a row is wrong and you don't want it appearing in any report.
        </div>
        <div className="text-sm text-slate-300">
          {description && <div className="mb-1">{description}</div>}
          <div>Amount: <span className="font-bold">{money(amountCents)}</span></div>
          <div className="text-xs text-slate-500">ID: {targetId.slice(0, 8)}</div>
        </div>
        <label className="block">
          <div className="text-xs uppercase text-slate-400 mb-1">Super-admin PIN</div>
          <input
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-3 text-2xl tracking-widest text-center tabular-nums"
            type="password"
            inputMode="numeric"
            maxLength={8}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            autoFocus
          />
        </label>
        <label className="block">
          <div className="text-xs uppercase text-slate-400 mb-1">Reason</div>
          <input
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Bad data — never actually happened, etc."
          />
        </label>
        <label className="block">
          <div className="text-xs uppercase text-slate-400 mb-1">
            Type <span className="font-mono text-red-300">DELETE</span> to confirm
          </div>
          <input
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 font-mono"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="DELETE"
          />
        </label>
        {err && <div className="text-red-400 text-sm">{err}</div>}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 bg-slate-700 hover:bg-slate-600 text-white font-semibold py-3 rounded-lg">
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || pin.length < 4 || !reason.trim() || confirmText.trim().toUpperCase() !== 'DELETE'}
            className="flex-1 bg-red-800 hover:bg-red-700 disabled:opacity-50 text-white font-bold py-3 rounded-lg"
          >
            {busy ? 'Deleting…' : 'HARD DELETE'}
          </button>
        </div>
      </form>
    </div>
  );
}
