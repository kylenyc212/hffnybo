import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCart, type CartLine } from '../lib/cart';
import { useSession } from '../lib/session';
import { money, toCents } from '../lib/money';
import { fmtWhen } from '../lib/datetime';
import { getOpenDrawer } from '../lib/drawer';
import { checkout } from '../lib/checkout';
import type { CashDrawerRow } from '../lib/database.types';
import { InputPromptModal } from '../components/InputPromptModal';

export function CartPage() {
  const nav = useNavigate();
  const { user, deviceLabel } = useSession();
  const lines = useCart((s) => s.lines);
  const updateQty = useCart((s) => s.updateQty);
  const updateLine = useCart((s) => s.updateLine);
  const removeLine = useCart((s) => s.removeLine);
  const clear = useCart((s) => s.clear);
  const subtotalCents = useCart((s) => s.subtotalCents());

  const [drawer, setDrawer] = useState<CashDrawerRow | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(true);
  const [tenderStr, setTenderStr] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [lastSale, setLastSale] = useState<{ changeCents: number; subtotalCents: number; synced: boolean } | null>(null);

  // Optional customer contact info (visible by default so cashier sees the option)
  const [contactOpen, setContactOpen] = useState(true);
  const [cName, setCName] = useState('');
  const [cEmail, setCEmail] = useState('');
  const [cPhone, setCPhone] = useState('');
  const [cAddress, setCAddress] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const d = await getOpenDrawer();
        setDrawer(d);
      } catch (e: unknown) {
        setErr(e instanceof Error ? e.message : 'Failed to load drawer');
      } finally {
        setDrawerLoading(false);
      }
    })();
  }, []);

  const needsCash = subtotalCents > 0;
  const tenderCents = tenderStr ? toCents(parseFloat(tenderStr)) : 0;
  const changeCents = tenderCents - subtotalCents;
  const canCheckout =
    lines.length > 0 &&
    (!needsCash || (drawer && tenderCents >= subtotalCents));

  async function submit() {
    if (!user || !deviceLabel) return;
    setErr(null);
    setSubmitting(true);
    try {
      const result = await checkout({
        lines,
        cashierId: user.id,
        cashierName: user.name,
        deviceLabel,
        drawerId: drawer?.id ?? null,
        cashTenderedCents: needsCash ? tenderCents : 0,
        customerName: cName.trim() || null,
        customerEmail: cEmail.trim() || null,
        customerPhone: cPhone.trim() || null,
        customerAddress: cAddress.trim() || null
      });
      setLastSale({
        changeCents: result.changeCents,
        subtotalCents: result.subtotalCents,
        synced: result.synced
      });
      clear();
      setTenderStr('');
      setCName(''); setCEmail(''); setCPhone(''); setCAddress('');
      setContactOpen(false);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Checkout failed');
    } finally {
      setSubmitting(false);
    }
  }

  if (lastSale) {
    return (
      <div className="p-6 max-w-xl mx-auto">
        <div className={`${lastSale.synced ? 'bg-emerald-900/40 border-emerald-700' : 'bg-amber-900/40 border-amber-600'} border rounded-2xl p-6 text-center`}>
          <div className={`text-2xl font-bold ${lastSale.synced ? 'text-emerald-200' : 'text-amber-200'}`}>
            {lastSale.synced ? 'Sale complete' : 'Saved offline'}
          </div>
          {!lastSale.synced && (
            <div className="mt-2 text-sm text-amber-200">
              No network — order queued locally. Will sync automatically when back online.
            </div>
          )}
          <div className="mt-3 text-slate-300">Total: {money(lastSale.subtotalCents)}</div>
          {lastSale.changeCents > 0 && (
            <div className="mt-2 text-3xl font-bold text-amber-300">
              Give change: {money(lastSale.changeCents)}
            </div>
          )}
        </div>
        <div className="mt-6 flex gap-3">
          <button
            onClick={() => { setLastSale(null); nav('/catalog'); }}
            className="flex-1 bg-brand hover:bg-brand-dark text-white font-bold py-3 rounded-xl"
          >
            New sale
          </button>
          <Link
            to="/drawer"
            className="flex-1 text-center bg-slate-800 hover:bg-slate-700 text-white font-bold py-3 rounded-xl"
          >
            Cash drawer
          </Link>
        </div>
      </div>
    );
  }

  // Group lines by screening for display
  const byScreening = new Map<string, { title: string; starts_at: string; lines: CartLine[] }>();
  for (const l of lines) {
    const existing = byScreening.get(l.screeningId);
    if (existing) existing.lines.push(l);
    else byScreening.set(l.screeningId, {
      title: l.screeningTitle,
      starts_at: l.screeningStartsAt,
      lines: [l]
    });
  }

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4 gap-4">
        <h1 className="text-2xl font-bold">Cart</h1>
        <Link to="/catalog" className="text-slate-400 hover:text-white">← Screenings</Link>
      </div>

      {!drawerLoading && !drawer && needsCash && (
        <div className="bg-amber-900/40 border border-amber-700 rounded-xl p-4 mb-4 flex items-start justify-between gap-4">
          <div className="text-sm text-amber-100">
            <div className="font-bold">No cash drawer open on this device.</div>
            <div className="mt-1">Open one before completing a paid sale.</div>
          </div>
          <Link
            to="/drawer"
            className="bg-amber-600 hover:bg-amber-500 text-white font-semibold px-4 py-2 rounded-lg whitespace-nowrap"
          >
            Open drawer
          </Link>
        </div>
      )}

      {lines.length === 0 ? (
        <div className="text-slate-400">Cart is empty. <Link to="/catalog" className="text-brand underline">Pick a screening</Link>.</div>
      ) : (
        <>
          <div className="space-y-5">
            {Array.from(byScreening.entries()).map(([sid, grp]) => (
              <section key={sid} className="bg-slate-800 border border-slate-700 rounded-xl p-4">
                <div className="text-sm text-slate-400 mb-2">{fmtWhen(grp.starts_at)}</div>
                <div className="text-lg font-semibold mb-3">{grp.title}</div>
                <ul className="space-y-2">
                  {grp.lines.map((l) => (
                    <li key={l.key} className="flex items-center gap-2 bg-slate-900 border border-slate-700 rounded-lg p-2">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm">{l.label}</div>
                        {l.category === 'comp' && (
                          <PatronEditor line={l} onChange={(patron) => updateLine(l.key, { patronName: patron })} />
                        )}
                      </div>
                      <QtyStepper
                        qty={l.qty}
                        locked={l.category === 'comp' && !!l.patronName}
                        onChange={(qty) => updateQty(l.key, qty)}
                      />
                      <div className="w-20 text-right font-semibold tabular-nums">
                        {money(l.qty * l.unitPriceCents)}
                      </div>
                      <button
                        onClick={() => removeLine(l.key)}
                        className="text-slate-500 hover:text-red-400 px-2"
                        aria-label="Remove"
                      >✕</button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          <div className="mt-4 bg-slate-800 border border-slate-700 rounded-xl p-4">
            <button
              onClick={() => setContactOpen(!contactOpen)}
              className="w-full flex justify-between items-center text-left"
            >
              <span className="text-sm font-semibold">Customer info <span className="text-slate-500 font-normal">(optional)</span></span>
              <span className="text-slate-400 text-xs">
                {hasContact(cName, cEmail, cPhone, cAddress) ? 'filled in' : ''} {contactOpen ? '▾' : '▸'}
              </span>
            </button>
            {contactOpen && (
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2"
                  placeholder="Name"
                  value={cName}
                  onChange={(e) => setCName(e.target.value)}
                />
                <input
                  className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2"
                  placeholder="Email"
                  type="email"
                  inputMode="email"
                  autoCapitalize="off"
                  value={cEmail}
                  onChange={(e) => setCEmail(e.target.value)}
                />
                <input
                  className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2"
                  placeholder="Phone"
                  type="tel"
                  inputMode="tel"
                  value={cPhone}
                  onChange={(e) => setCPhone(e.target.value)}
                />
                <input
                  className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 sm:col-span-1"
                  placeholder="Address"
                  value={cAddress}
                  onChange={(e) => setCAddress(e.target.value)}
                />
                {hasContact(cName, cEmail, cPhone, cAddress) && (
                  <button
                    onClick={() => { setCName(''); setCEmail(''); setCPhone(''); setCAddress(''); }}
                    className="sm:col-span-2 text-xs text-slate-400 hover:text-red-400"
                  >Clear customer info</button>
                )}
              </div>
            )}
          </div>

          <div className="mt-4 bg-slate-800 border border-slate-700 rounded-xl p-4">
            <div className="flex justify-between text-xl font-bold mb-3">
              <span>Subtotal</span>
              <span className="tabular-nums">{money(subtotalCents)}</span>
            </div>

            {needsCash ? (
              <>
                <div className="text-xs uppercase text-slate-400 mb-2">Cash tendered — tap bills as you take them</div>
                <div className="grid grid-cols-5 gap-2 mb-2">
                  {[500, 1000, 2000, 5000, 10000].map((cents) => (
                    <button
                      key={cents}
                      type="button"
                      onClick={() => setTenderStr(((tenderCents + cents) / 100).toFixed(2))}
                      className="bg-emerald-800 hover:bg-emerald-700 text-white font-bold py-4 rounded-lg text-base sm:text-lg"
                    >
                      +${cents / 100}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2 mb-3">
                  <button
                    type="button"
                    onClick={() => setTenderStr((subtotalCents / 100).toFixed(2))}
                    className="bg-slate-700 hover:bg-slate-600 text-sm font-semibold px-3 py-2 rounded-lg"
                  >
                    Exact ({money(subtotalCents)})
                  </button>
                  <button
                    type="button"
                    onClick={() => setTenderStr('')}
                    className="bg-slate-700 hover:bg-slate-600 text-sm font-semibold px-3 py-2 rounded-lg"
                  >
                    Clear
                  </button>
                </div>
                <label className="block mb-3">
                  <div className="text-xs uppercase text-slate-400 mb-1">Or type cash tendered</div>
                  <input
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-3 text-2xl tabular-nums"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={tenderStr}
                    onChange={(e) => setTenderStr(e.target.value)}
                  />
                </label>
                {tenderStr && (
                  <div className={`text-lg font-bold flex justify-between ${changeCents < 0 ? 'text-red-400' : 'text-amber-300'}`}>
                    <span>{changeCents < 0 ? 'Short by' : 'Change due'}</span>
                    <span className="tabular-nums">{money(Math.abs(changeCents))}</span>
                  </div>
                )}
              </>
            ) : (
              <div className="text-sm text-slate-400 mb-3">Comp-only order — no cash collected.</div>
            )}

            {err && <div className="text-red-400 text-sm mt-2">{err}</div>}

            <button
              disabled={!canCheckout || submitting}
              onClick={submit}
              className="mt-3 w-full bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-4 rounded-xl text-lg"
            >
              {submitting ? 'Saving…' : needsCash ? 'Complete sale' : 'Record comps'}
            </button>
            <button
              onClick={() => { if (confirm('Empty the cart?')) clear(); }}
              className="mt-2 w-full text-slate-400 hover:text-red-400 text-sm py-2"
            >
              Clear cart
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function hasContact(n: string, e: string, p: string, a: string): boolean {
  return !!(n.trim() || e.trim() || p.trim() || a.trim());
}

function QtyStepper({ qty, locked, onChange }: { qty: number; locked: boolean; onChange: (q: number) => void }) {
  if (locked) return <div className="w-24 text-center text-sm text-slate-400">qty 1</div>;
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => onChange(qty - 1)}
        className="w-9 h-9 bg-slate-700 hover:bg-slate-600 rounded-lg font-bold"
      >−</button>
      <div className="w-8 text-center font-semibold tabular-nums">{qty}</div>
      <button
        onClick={() => onChange(qty + 1)}
        className="w-9 h-9 bg-slate-700 hover:bg-slate-600 rounded-lg font-bold"
      >+</button>
    </div>
  );
}

function PatronEditor({ line, onChange }: { line: CartLine; onChange: (name: string) => void }) {
  // In-page modal (iOS PWA standalone blocks window.prompt, so we use a custom modal).
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-slate-400 hover:text-slate-200 mt-0.5 underline-offset-2 hover:underline"
      >
        {line.patronName ? `Patron: ${line.patronName} ✎` : '+ Add patron name'}
      </button>
      {open && (
        <InputPromptModal
          title="Patron name"
          label="Attach a name to this comp ticket"
          initial={line.patronName ?? ''}
          placeholder="e.g. Jane Doe"
          confirmLabel="Save"
          onClose={() => setOpen(false)}
          onConfirm={(val) => {
            onChange(val);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
