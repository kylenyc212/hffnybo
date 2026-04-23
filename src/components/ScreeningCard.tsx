import { useState } from 'react';
import { useCart } from '../lib/cart';
import { money, toCents } from '../lib/money';
import { fmtTime } from '../lib/datetime';
import type { ScreeningWithSold } from '../lib/queries';
import type { TicketTypeRow } from '../lib/database.types';
import { PassScanner } from './PassScanner';

interface Props {
  screening: ScreeningWithSold;
  onSold: (screeningId: string, qty: number) => void;
}

export function ScreeningCard({ screening, onSold }: Props) {
  const addLine = useCart((s) => s.addLine);
  const [scanOpen, setScanOpen] = useState(false);
  const [otherOpen, setOtherOpen] = useState(false);
  const [otherLabel, setOtherLabel] = useState('');
  const [otherAmount, setOtherAmount] = useState('');
  const [otherQty, setOtherQty] = useState(1);

  const alwaysAvailable = screening.is_always_available;
  const totalSold = screening.sold_in_person + screening.online_sold;
  const remaining = Math.max(0, screening.capacity - totalSold);
  const nearCapacity = !alwaysAvailable && remaining <= 10;
  const atCapacity = !alwaysAvailable && remaining <= 0;

  const paid = screening.ticket_types.filter((t) => t.category === 'paid');
  const comps = screening.ticket_types.filter((t) => t.category === 'comp');

  function addOne(t: TicketTypeRow, overrides?: Partial<{ patronName: string; passholderId: string }>) {
    addLine({
      screeningId: screening.id,
      screeningTitle: screening.title,
      screeningStartsAt: screening.starts_at,
      ticketTypeId: t.id,
      label: t.label,
      qty: 1,
      unitPriceCents: t.price_cents,
      category: t.category,
      compCategory: t.comp_category,
      passholderId: overrides?.passholderId ?? null,
      patronName: overrides?.patronName ?? null
    });
    onSold(screening.id, 1);
  }

  function addOther() {
    const amt = toCents(parseFloat(otherAmount || '0'));
    if (!otherLabel.trim() || otherQty < 1) return;
    addLine({
      screeningId: screening.id,
      screeningTitle: screening.title,
      screeningStartsAt: screening.starts_at,
      ticketTypeId: null,
      label: otherLabel.trim(),
      qty: otherQty,
      unitPriceCents: amt,
      category: 'other',
      compCategory: null,
      passholderId: null,
      patronName: null
    });
    onSold(screening.id, otherQty);
    setOtherLabel('');
    setOtherAmount('');
    setOtherQty(1);
    setOtherOpen(false);
  }

  return (
    <div className={`bg-slate-800 border rounded-xl p-3 ${alwaysAvailable ? 'border-amber-700' : 'border-slate-700'}`}>
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="min-w-0 flex-1">
          <div className="text-base sm:text-lg font-semibold break-words leading-snug">
            {screening.title}
            {!alwaysAvailable && (
              <span className="text-slate-400 font-normal"> — {fmtTime(screening.starts_at)}</span>
            )}
            {screening.is_free && (
              <span className="ml-2 text-xs bg-emerald-700 text-white px-2 py-0.5 rounded align-middle">FREE</span>
            )}
          </div>
          {screening.short_code && !alwaysAvailable && (
            <div className="text-[10px] text-slate-500 font-mono mt-0.5">Heartland: {screening.short_code}</div>
          )}
        </div>
        {!alwaysAvailable && (
          <div className={`text-right text-xs shrink-0 ${nearCapacity ? 'text-amber-400' : 'text-slate-500'}`}>
            <div className="font-semibold">{remaining} left</div>
            <div>{totalSold}/{screening.capacity}</div>
          </div>
        )}
      </div>

      {paid.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-2">
          {paid.map((t) => (
            <button
              key={t.id}
              disabled={atCapacity}
              onClick={() => addOne(t)}
              className="bg-slate-900 hover:bg-slate-700 border border-slate-700 rounded-lg px-3 py-3 text-left disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <div className="text-xs text-slate-400">{t.label}</div>
              <div className="font-bold">{money(t.price_cents)}</div>
            </button>
          ))}
        </div>
      )}

      {comps.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
          {comps.map((t) => (
            <button
              key={t.id}
              disabled={atCapacity}
              onClick={() => addOne(t)}
              className="bg-slate-900 hover:bg-slate-700 border border-slate-700 rounded-lg px-3 py-3 text-left disabled:opacity-40"
            >
              <div className="text-xs text-slate-400">Comp</div>
              <div className="font-semibold text-sm">
                {t.label.replace(/^Comp\s*[—-]\s*/, '')}
              </div>
            </button>
          ))}
          <button
            onClick={() => setScanOpen(true)}
            className="bg-emerald-800 hover:bg-emerald-700 border border-emerald-700 rounded-lg px-3 py-3 text-left"
          >
            <div className="text-xs text-emerald-200">Pass</div>
            <div className="font-semibold text-sm">Scan ▸</div>
          </button>
        </div>
      )}

      <button
        onClick={() => setOtherOpen(!otherOpen)}
        className="text-xs text-slate-400 hover:text-slate-200 mt-1"
      >
        {otherOpen ? '− Hide Other' : '+ Other (custom ticket)'}
      </button>
      {otherOpen && (
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-6 gap-2 items-end">
          <input
            className="sm:col-span-3 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2"
            placeholder="Label (e.g. Sponsor comp)"
            value={otherLabel}
            onChange={(e) => setOtherLabel(e.target.value)}
          />
          <input
            className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2"
            type="number" step="0.01" min="0" inputMode="decimal"
            placeholder="$"
            value={otherAmount}
            onChange={(e) => setOtherAmount(e.target.value)}
          />
          <input
            className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2"
            type="number" min="1" inputMode="numeric"
            placeholder="Qty"
            value={otherQty}
            onChange={(e) => setOtherQty(Math.max(1, parseInt(e.target.value || '1', 10)))}
          />
          <button
            onClick={addOther}
            className="bg-brand hover:bg-brand-dark text-white font-semibold rounded-lg py-2"
          >
            Add
          </button>
        </div>
      )}

      {scanOpen && (
        <PassScanner
          onClose={() => setScanOpen(false)}
          onFound={(ph) => {
            const passType = comps.find((t) => t.comp_category === 'pass_holder') ?? comps[0];
            if (passType) addOne(passType, { patronName: ph.name, passholderId: ph.id });
            setScanOpen(false);
          }}
        />
      )}
    </div>
  );
}
