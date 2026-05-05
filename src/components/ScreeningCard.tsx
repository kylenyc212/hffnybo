import { useState } from 'react';
import { useCart } from '../lib/cart';
import { useSession } from '../lib/session';
import { money, toCents } from '../lib/money';
import { fmtTime } from '../lib/datetime';
import type { ScreeningWithSold } from '../lib/queries';
import type { TicketTypeRow } from '../lib/database.types';
import { recordManualCheckin } from '../lib/checkins';

interface Props {
  screening: ScreeningWithSold;
  onSold: (screeningId: string, qty: number) => void;
  onCheckedIn?: (screeningId: string) => void;
}

/** Shorten or rename labels for display only (DB values are unchanged). */
function displayLabel(label: string): string {
  if (label === 'General Admission') return 'General Admin';
  return label;
}

export function ScreeningCard({ screening, onSold, onCheckedIn }: Props) {
  const addLine = useCart((s) => s.addLine);
  const { user } = useSession();
  const [otherOpen, setOtherOpen] = useState(false);
  const [otherLabel, setOtherLabel] = useState('');
  const [otherAmount, setOtherAmount] = useState('');
  const [otherQty, setOtherQty] = useState(1);

  const alwaysAvailable = screening.is_always_available;
  // manual_count = walk-in +1 taps: no order, but person is in a seat
  const totalSold = screening.sold_in_person + screening.online_sold + screening.manual_count;
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
      category: alwaysAvailable ? 'paid' : 'other',
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

      {/* Title row: title — time  SKU  [capacity] */}
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="min-w-0 flex-1">
          <div className="text-base sm:text-lg font-semibold break-words leading-snug">
            {screening.title}
            {!alwaysAvailable && (
              <>
                <span className="text-slate-400 font-normal"> — {fmtTime(screening.starts_at)}</span>
                {screening.short_code && (
                  <span className="text-[11px] text-slate-500 font-mono font-normal ml-2">
                    {screening.short_code}
                  </span>
                )}
              </>
            )}
            {screening.is_free && (
              <span className="ml-2 text-xs bg-emerald-700 text-white px-2 py-0.5 rounded align-middle">FREE</span>
            )}
          </div>
        </div>
        {!alwaysAvailable && (
          <div className="flex items-center gap-3 shrink-0">
            {/* capacity column */}
            <div className="text-right text-xs">
              <div className={`font-semibold ${nearCapacity ? 'text-amber-400' : 'text-slate-500'}`}>{remaining} left</div>
              <div className={nearCapacity ? 'text-amber-400' : 'text-slate-500'}>{totalSold}/{screening.capacity}</div>
            </div>
            {/* check-in column */}
            <div className="flex items-center gap-1.5">
              <span className="text-orange-400 text-xs">{screening.checkin_count} ✓</span>
              <button
                onClick={async () => {
                  if (!user) return;
                  onCheckedIn?.(screening.id);
                  await recordManualCheckin(screening.id, user.name).catch(() => {});
                }}
                className="text-orange-400 hover:text-orange-300 bg-orange-900/40 hover:bg-orange-900/70 rounded px-5 py-2 text-base font-bold leading-none"
                title="Manual check-in +1"
              >+</button>
            </div>
          </div>
        )}
      </div>

      {/* ── Paid tickets ── 4 across
          Always-available items (passes, merch): just the ticket type buttons.
          Regular screenings: ticket types + "Other" button at the end. */}
      {(paid.length > 0 || !alwaysAvailable) && (
        <div className={`grid gap-2 mb-2 ${alwaysAvailable ? 'grid-cols-4' : 'grid-cols-3 sm:grid-cols-4'}`}>
          {paid.map((t) => (
            <button
              key={t.id}
              disabled={atCapacity}
              onClick={() => addOne(t)}
              className="bg-slate-900 hover:bg-slate-700 border border-slate-700 rounded-lg px-3 py-3 text-left disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <div className="text-xs text-slate-400">{displayLabel(t.label)}</div>
              <div className="font-bold">{money(t.price_cents)}</div>
            </button>
          ))}
          {/* Other button — sits inline with paid types; expands a form below */}
          {/* Also shown for the MERCH pseudo-screening so staff can add custom items */}
          {(!alwaysAvailable || screening.short_code === 'MERCH') && (
            <button
              onClick={() => setOtherOpen(!otherOpen)}
              className={`rounded-lg px-3 py-3 text-left border transition-colors ${
                otherOpen
                  ? 'bg-slate-700 border-slate-500 text-white'
                  : 'bg-slate-900 border-slate-600 hover:bg-slate-700 text-slate-300'
              }`}
            >
              <div className="text-xs text-slate-400">Other</div>
              <div className="font-semibold text-sm">Custom…</div>
            </button>
          )}
        </div>
      )}

      {/* Other / custom ticket inline form */}
      {(!alwaysAvailable || screening.short_code === 'MERCH') && otherOpen && (
        <div className="mb-2 bg-slate-900 border border-slate-600 rounded-lg p-3 grid grid-cols-1 sm:grid-cols-6 gap-2 items-end">
          <input
            className="sm:col-span-3 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm"
            placeholder={alwaysAvailable ? 'Item name (e.g. Poster)' : 'Label (e.g. Sponsor comp)'}
            value={otherLabel}
            onChange={(e) => setOtherLabel(e.target.value)}
          />
          <input
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm"
            type="number" step="0.01" min="0" inputMode="decimal"
            placeholder="$"
            value={otherAmount}
            onChange={(e) => setOtherAmount(e.target.value)}
          />
          <input
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm"
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

      {/* ── Comp tickets ── 4 across
          Scan button appears only for regular screenings (not pass/merch sales). */}
      {comps.length > 0 && (
        <div className="grid grid-cols-4 gap-2 mb-2">
          {comps.map((t) => (
            <button
              key={t.id}
              disabled={atCapacity}
              onClick={() => addOne(t)}
              className="bg-slate-900 hover:bg-slate-700 border border-slate-700 rounded-lg px-3 py-3 text-left disabled:opacity-40"
            >
              <div className="text-xs text-slate-400">Comp</div>
              <div className="font-semibold text-sm">
                {t.label.replace(/^Comp\s*[—-]\s*/, '').replace('Pass Holder', 'Pass')}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
