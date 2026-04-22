import { useMemo } from 'react';
import { money } from '../lib/money';
import type { DenomBreakdown } from '../lib/database.types';

export const DENOMS = [
  { cents: 10000, label: '$100' },
  { cents: 5000, label: '$50' },
  { cents: 2000, label: '$20' },
  { cents: 1000, label: '$10' },
  { cents: 500, label: '$5' },
  { cents: 100, label: '$1' },
  { cents: 25, label: '25¢ (quarter)' },
  { cents: 10, label: '10¢ (dime)' },
  { cents: 5, label: '5¢ (nickel)' },
  { cents: 1, label: '1¢ (penny)' }
] as const;

export function totalFromDenoms(denoms: DenomBreakdown): number {
  return DENOMS.reduce((sum, d) => sum + d.cents * (denoms[d.cents] ?? 0), 0);
}

interface Props {
  value: DenomBreakdown;
  onChange: (next: DenomBreakdown) => void;
}

export function DenomCounter({ value, onChange }: Props) {
  const total = useMemo(() => totalFromDenoms(value), [value]);

  const set = (cents: number, qty: number) => {
    const next = { ...value };
    if (qty > 0) next[String(cents)] = qty;
    else delete next[String(cents)];
    onChange(next);
  };

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {DENOMS.map((d) => {
          const qty = value[d.cents] ?? 0;
          const subtotal = d.cents * qty;
          return (
            <div key={d.cents} className="flex items-center gap-2 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2">
              <div className="w-28 font-semibold text-sm whitespace-nowrap">{d.label}</div>
              <div className="text-slate-500 text-sm">×</div>
              <input
                type="number"
                min="0"
                inputMode="numeric"
                value={qty || ''}
                onChange={(e) => set(d.cents, Math.max(0, parseInt(e.target.value || '0', 10)))}
                className="flex-1 w-16 bg-slate-900 border border-slate-700 rounded px-2 py-2 text-lg text-right tabular-nums"
                placeholder="0"
              />
              <div className="w-20 text-right tabular-nums text-slate-300 text-sm">{money(subtotal)}</div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-between bg-slate-900 border border-slate-600 rounded-lg px-3 py-3">
        <div className="text-sm uppercase text-slate-400">Counted total</div>
        <div className="text-2xl font-bold tabular-nums">{money(total)}</div>
      </div>
    </div>
  );
}
