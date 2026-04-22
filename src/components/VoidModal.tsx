import { useState } from 'react';
import { voidOrder } from '../lib/voids';
import { money } from '../lib/money';

interface Props {
  orderId: string;
  orderAmountCents: number;
  orderDescription?: string;
  onClose: () => void;
  onDone: () => void;
}

export function VoidModal({ orderId, orderAmountCents, orderDescription, onClose, onDone }: Props) {
  const [pin, setPin] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    const result = await voidOrder({ orderId, adminPin: pin, reason });
    setBusy(false);
    if (!result.ok) { setErr(result.error); return; }
    onDone();
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <form
        onSubmit={submit}
        className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md p-5 space-y-3"
      >
        <div className="flex items-center justify-between">
          <div className="text-lg font-bold">Void transaction</div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white">✕</button>
        </div>
        <div className="text-sm text-slate-300">
          {orderDescription && <div className="mb-1">{orderDescription}</div>}
          <div>Amount: <span className="font-bold">{money(orderAmountCents)}</span></div>
          <div className="text-xs text-slate-500">ID: {orderId.slice(0, 8)}</div>
        </div>
        <label className="block">
          <div className="text-xs uppercase text-slate-400 mb-1">Manager PIN</div>
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
            placeholder="Customer asked for refund, rung by mistake, etc."
          />
        </label>
        {err && <div className="text-red-400 text-sm">{err}</div>}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 bg-slate-700 hover:bg-slate-600 text-white font-semibold py-3 rounded-lg">
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || pin.length < 4 || !reason.trim()}
            className="flex-1 bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white font-bold py-3 rounded-lg"
          >
            {busy ? 'Voiding…' : 'Void'}
          </button>
        </div>
      </form>
    </div>
  );
}
