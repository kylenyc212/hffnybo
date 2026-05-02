import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useCart, type CartLine } from '../lib/cart';
import { useSession } from '../lib/session';
import { money, toCents } from '../lib/money';
import { fmtWhen } from '../lib/datetime';
import { getOpenDrawer } from '../lib/drawer';
import { checkout } from '../lib/checkout';
import type { CashDrawerRow } from '../lib/database.types';
import { InputPromptModal } from '../components/InputPromptModal';
import { PassScanner } from '../components/PassScanner';
import { HeartlandReceiptModal } from '../components/HeartlandReceiptModal';
import { parseHeartlandReceipt } from '../lib/heartland-receipt';
import type { ParsedHeartlandReceipt } from '../lib/heartland-receipt';
import { getCheckinLinesForOrder, checkInOne, uncheckInOne, type OrderLineWithScreening } from '../lib/checkins';
import { sendReceiptEmail } from '../lib/email';

export function CartPage() {
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
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
  const [lastSale, setLastSale] = useState<{ changeCents: number; subtotalCents: number; synced: boolean; external: boolean; orderId: string; ref: string | null; name: string | null; email: string | null; lines: typeof lines } | null>(null);
  const [checkoutLines, setCheckoutLines] = useState<OrderLineWithScreening[] | null>(null);
  // Per-line checked_in_qty tracked locally after checkout
  const [checkedInQty, setCheckedInQty] = useState<Record<string, number>>({});
  const [checkingIn, setCheckingIn] = useState<Set<string>>(new Set());
  const [emailSending, setEmailSending] = useState(false);
  const [emailResult, setEmailResult] = useState<'sent' | 'error' | null>(null);
  const [payMethod, setPayMethod] = useState<'cash' | 'external'>('cash');
  const [externalRef, setExternalRef] = useState('');

  // Optional customer contact info (visible by default so cashier sees the option)
  const [contactOpen, setContactOpen] = useState(true);
  const [cName, setCName] = useState('');
  const [cEmail, setCEmail] = useState('');
  const [cPhone, setCPhone] = useState('');
  const [cAddress, setCAddress] = useState('');
  const [scanOpen, setScanOpen]   = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText]         = useState('');
  const [shortcutReceipt, setShortcutReceipt] = useState<ParsedHeartlandReceipt | null>(null);

  // Handle ?sc=1 flag from the iOS Shortcut.
  // The Shortcut copies OCR text to clipboard then opens this URL.
  // We read the clipboard here so the user doesn't have to tap anything.
  useEffect(() => {
    const sc = searchParams.get('sc');
    if (!sc) return;
    setSearchParams((p) => { p.delete('sc'); return p; }, { replace: true });

    (async () => {
      try {
        // Read plain text from clipboard (Shortcut put OCR text there)
        const text = await navigator.clipboard.readText();
        if (!text?.trim()) return;
        const receipt = parseHeartlandReceipt(text);
        if (receipt.items.length > 0) {
          setShortcutReceipt(receipt);
          setPayMethod('external');
        } else {
          // Has text but no items — show raw for manual review
          setShortcutReceipt({ ...receipt, _rawText: text } as ParsedHeartlandReceipt & { _rawText: string });
        }
      } catch {
        // Clipboard permission denied — fall back silently
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-populate customer name from cart lines: if exactly one distinct patron
  // name exists across comp lines (a single person bought all the comps),
  // and the customer name field is still empty, fill it in.
  useEffect(() => {
    if (cName) return;
    const names = Array.from(new Set(lines.map((l) => l.patronName).filter((n): n is string => !!n)));
    if (names.length === 1) setCName(names[0]);
  }, [lines, cName]);

  // Push the customer name down to any comp lines that don't have a patron set.
  function applyCustomerNameToCompLines(name: string, extra?: { passholderId?: string | null; email?: string | null }) {
    if (!name.trim()) return;
    for (const l of lines) {
      if (l.category === 'comp' && !l.patronName) {
        useCart.getState().updateLine(l.key, {
          patronName: name.trim(),
          ...(extra?.passholderId ? { passholderId: extra.passholderId } : {})
        });
      }
    }
    if (extra?.email !== undefined && !cEmail && extra.email) {
      setCEmail(extra.email);
    }
  }

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

  const isExternal = payMethod === 'external';
  const needsCash = subtotalCents > 0 && !isExternal;
  const tenderCents = tenderStr ? toCents(parseFloat(tenderStr)) : 0;
  const changeCents = tenderCents - subtotalCents;
  const canCheckout =
    lines.length > 0 &&
    (isExternal
      ? subtotalCents > 0 // external requires a non-zero sale (comps go through cash path with $0)
      : !needsCash || (drawer && tenderCents >= subtotalCents));

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
        source: isExternal ? 'external_heartland' : 'boxoffice',
        externalRef: isExternal ? (externalRef.trim() || null) : null,
        customerName: cName.trim() || null,
        customerEmail: cEmail.trim() || null,
        customerPhone: cPhone.trim() || null,
        customerAddress: cAddress.trim() || null
      });
      setLastSale({
        changeCents: result.changeCents,
        subtotalCents: result.subtotalCents,
        synced: result.synced,
        external: isExternal,
        orderId: result.orderId,
        ref: isExternal ? (externalRef.trim() || null) : null,
        name: cName.trim() || null,
        email: cEmail.trim() || null,
        lines: [...lines], // snapshot before clear()
      });
      // Load order_lines for post-checkout check-in (only works when synced)
      if (result.synced) {
        getCheckinLinesForOrder(result.orderId)
          .then((cls) => {
            setCheckoutLines(cls);
            // Seed local qty map from DB state
            const init: Record<string, number> = {};
            for (const l of cls) init[l.id] = l.checked_in_qty ?? 0;
            setCheckedInQty(init);
          })
          .catch(() => {});
      }
      clear();
      setTenderStr('');
      setExternalRef('');
      setPayMethod('cash');
      setCName(''); setCEmail(''); setCPhone(''); setCAddress('');
      setContactOpen(true);
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
            {lastSale.synced ? (lastSale.external ? 'External sale recorded' : 'Sale complete') : 'Saved offline'}
          </div>
          {!lastSale.synced && (
            <div className="mt-2 text-sm text-amber-200">
              No network — order queued locally. Will sync automatically when back online.
            </div>
          )}
          {lastSale.external && (
            <div className="mt-2 text-xs text-slate-400">Heartland sale logged. Cash drawer was not touched.</div>
          )}
          {lastSale.name && (
            <div className="mt-2 text-slate-200 font-semibold">{lastSale.name}</div>
          )}
          {lastSale.ref && (
            <div className="mt-1 font-mono text-sm text-slate-400">Ref: {lastSale.ref}</div>
          )}
          <div className="mt-3 text-slate-300">Total: {money(lastSale.subtotalCents)}</div>
          {lastSale.changeCents > 0 && !lastSale.external && (
            <div className="mt-2 text-3xl font-bold text-amber-300">
              Give change: {money(lastSale.changeCents)}
            </div>
          )}
        </div>
        {/* Check-in at door */}
        {checkoutLines && checkoutLines.length > 0 && (
          <div className="mt-4 bg-slate-800 border border-slate-700 rounded-xl p-4">
            <div className="text-sm font-semibold mb-3 text-slate-200">Check in at door</div>
            <div className="space-y-2">
              {checkoutLines.map((line) => {
                const total = line.qty;
                const inQty = checkedInQty[line.id] ?? 0;
                const full = inQty >= total;
                const busy = checkingIn.has(line.id);
                const screening = line.screenings;
                return (
                  <div key={line.id} className={`flex items-center gap-3 rounded-xl px-3 py-3 border ${full ? 'bg-emerald-950/40 border-emerald-800' : inQty > 0 ? 'bg-amber-950/30 border-amber-700' : 'bg-slate-900 border-slate-700'}`}>
                    <div className="flex-1 min-w-0">
                      {screening && (
                        <div className="text-xs text-slate-400 mb-0.5">
                          {screening.title}
                          {!screening.is_always_available && ` · ${fmtWhen(screening.starts_at)}`}
                        </div>
                      )}
                      <div className="font-semibold text-sm leading-tight">
                        {line.label}
                      </div>
                      {line.patron_name && (
                        <div className="text-xs text-slate-400 mt-0.5">{line.patron_name}</div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {/* Status badge */}
                      {full ? (
                        <span className="text-emerald-400 text-sm font-semibold">
                          ✓ {total > 1 ? `All ${total} in` : 'In'}
                        </span>
                      ) : inQty > 0 ? (
                        <span className="text-amber-300 text-sm font-semibold tabular-nums">
                          {inQty}/{total} in
                        </span>
                      ) : null}
                      {/* −1 undo button */}
                      {inQty > 0 && (
                        <button
                          disabled={busy}
                          onClick={async () => {
                            if (!user) return;
                            setCheckingIn((p) => new Set(p).add(line.id));
                            try {
                              await uncheckInOne(line.id, inQty);
                              setCheckedInQty((p) => ({ ...p, [line.id]: inQty - 1 }));
                            } catch { /* ignore */ } finally {
                              setCheckingIn((p) => { const s = new Set(p); s.delete(line.id); return s; });
                            }
                          }}
                          className="w-9 h-9 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-white font-bold rounded-lg"
                        >−</button>
                      )}
                      {/* +1 check-in button */}
                      {!full && (
                        <button
                          disabled={busy}
                          onClick={async () => {
                            if (!user) return;
                            setCheckingIn((p) => new Set(p).add(line.id));
                            try {
                              await checkInOne(line.id, user.name, inQty, total);
                              setCheckedInQty((p) => ({ ...p, [line.id]: inQty + 1 }));
                            } catch { /* ignore */ } finally {
                              setCheckingIn((p) => { const s = new Set(p); s.delete(line.id); return s; });
                            }
                          }}
                          className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm font-bold px-4 py-2 rounded-lg whitespace-nowrap"
                        >
                          {busy ? '…' : `Check In${total > 1 ? ' +1' : ' ✓'}`}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {!lastSale?.synced && (
          <div className="mt-3 text-xs text-slate-500 text-center">Door check-in available once back online.</div>
        )}
        {/* Email receipt */}
        {lastSale?.email && lastSale.synced && (
          <div className="mt-4">
            {emailResult === 'sent' ? (
              <div className="text-center text-emerald-400 text-sm font-semibold py-2">
                ✓ Receipt sent to {lastSale.email}
              </div>
            ) : emailResult === 'error' ? (
              <div className="text-center text-red-400 text-sm py-2">
                Failed to send — check email settings
              </div>
            ) : (
              <button
                disabled={emailSending}
                onClick={async () => {
                  if (!lastSale?.email || !user) return;
                  setEmailSending(true);
                  setEmailResult(null);
                  try {
                    await sendReceiptEmail({
                      to: lastSale.email,
                      orderRef: lastSale.ref,
                      cashierName: user.name,
                      items: lastSale.lines.map((l) => ({
                        label: l.label,
                        screeningTitle: l.screeningTitle,
                        qty: l.qty,
                        unitPriceCents: l.unitPriceCents,
                      })),
                      totalCents: lastSale.subtotalCents,
                      payMethod: lastSale.external ? 'external' : 'cash',
                    });
                    setEmailResult('sent');
                  } catch {
                    setEmailResult('error');
                  } finally {
                    setEmailSending(false);
                  }
                }}
                className="w-full bg-indigo-700 hover:bg-indigo-600 disabled:opacity-50 text-white font-semibold py-3 rounded-xl"
              >
                {emailSending ? 'Sending…' : `📧 Email receipt to ${lastSale.email}`}
              </button>
            )}
          </div>
        )}

        <div className="mt-4 flex gap-3">
          <button
            onClick={() => {
              setLastSale(null); setCheckoutLines(null);
              setCheckingIn(new Set()); setCheckedInQty({}); setEmailResult(null);
              nav('/catalog');
            }}
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
      <div className="flex items-center justify-between mb-3 gap-4">
        <h1 className="text-2xl font-bold">Cart</h1>
        <Link to="/catalog" className="text-slate-400 hover:text-white">← Screenings</Link>
      </div>

      {/* ── Heartland receipt paste — always visible ── */}
      {!pasteOpen ? (
        <button
          onClick={() => { setPasteOpen(true); setPasteText(''); }}
          className="w-full mb-4 bg-indigo-700 hover:bg-indigo-600 active:bg-indigo-800 text-white font-bold py-4 rounded-xl text-base"
        >
          ⚡ Scan Heartland receipt
        </button>
      ) : (
        <div className="mb-4 bg-slate-800 border border-indigo-700 rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-indigo-300">Paste Heartland receipt text</div>
            <button onClick={() => setPasteOpen(false)} className="text-slate-500 hover:text-white text-lg leading-none">✕</button>
          </div>
          <textarea
            autoFocus
            className="w-full h-32 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm font-mono text-slate-300 resize-none"
            placeholder="Long-press here → Paste"
            value={pasteText}
            onChange={(e) => {
              const text = e.target.value;
              setPasteText(text);
              if (text.trim().length > 20) {
                const receipt = parseHeartlandReceipt(text);
                if (receipt.items.length > 0 || receipt.invoiceNumber || receipt.receiptNumber) {
                  setShortcutReceipt({ ...receipt, _rawText: text } as ParsedHeartlandReceipt & { _rawText: string });
                  setPasteOpen(false);
                  setPasteText('');
                }
              }
            }}
          />
          <div className="text-xs text-slate-500">Run the HFFNY Receipt shortcut first, then paste here</div>
        </div>
      )}

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
                <button
                  type="button"
                  onClick={() => setScanOpen(true)}
                  className="sm:col-span-2 bg-emerald-800 hover:bg-emerald-700 text-white font-semibold py-2 rounded-lg"
                >
                  📷 Scan passholder barcode
                </button>
                <input
                  className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2"
                  placeholder="Name"
                  value={cName}
                  onChange={(e) => setCName(e.target.value)}
                  onBlur={(e) => applyCustomerNameToCompLines(e.target.value)}
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

            {subtotalCents > 0 && (
              <div className="mb-4">
                <div className="text-xs uppercase text-slate-400 mb-1">Payment method</div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPayMethod('cash')}
                    className={`py-3 rounded-lg font-semibold ${
                      payMethod === 'cash' ? 'bg-brand text-white' : 'bg-slate-900 text-slate-300 border border-slate-700'
                    }`}
                  >
                    💵 Cash
                  </button>
                  <button
                    type="button"
                    onClick={() => setPayMethod('external')}
                    className={`py-3 rounded-lg font-semibold ${
                      payMethod === 'external' ? 'bg-brand text-white' : 'bg-slate-900 text-slate-300 border border-slate-700'
                    }`}
                  >
                    💳 External (CC)
                  </button>
                </div>
                {isExternal && (
                  <div className="mt-3 bg-slate-900 border border-slate-700 rounded-lg p-3 space-y-3">
                    <div className="text-xs text-slate-400">
                      Charge on Heartland first, then record the details below.
                    </div>
                    <label className="block">
                      <div className="text-xs font-semibold text-slate-300 mb-1">Customer name</div>
                      <input
                        className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm"
                        placeholder="As it appears on Heartland receipt"
                        value={cName}
                        onChange={(e) => setCName(e.target.value)}
                        onBlur={(e) => applyCustomerNameToCompLines(e.target.value)}
                        autoCapitalize="words"
                      />
                    </label>
                    <label className="block">
                      <div className="text-xs font-semibold text-slate-300 mb-1">Heartland order / receipt #</div>
                      <input
                        className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm font-mono"
                        placeholder="e.g. 123456"
                        value={externalRef}
                        onChange={(e) => setExternalRef(e.target.value)}
                        autoCapitalize="off"
                        autoCorrect="off"
                      />
                    </label>
                  </div>
                )}
              </div>
            )}

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
            ) : isExternal ? (
              <div className="text-sm text-slate-400 mb-3">External (CC) order — charge on Heartland terminal first, then tap Record.</div>
            ) : (
              <div className="text-sm text-slate-400 mb-3">Comp-only order — no cash collected.</div>
            )}

            {err && <div className="text-red-400 text-sm mt-2">{err}</div>}

            <button
              disabled={!canCheckout || submitting}
              onClick={submit}
              className="mt-3 w-full bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-4 rounded-xl text-lg"
            >
              {submitting ? 'Saving…' :
                isExternal ? 'Record external (CC) sale' :
                needsCash ? 'Complete sale' : 'Record comps'}
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
      {scanOpen && (
        <PassScanner
          onClose={() => setScanOpen(false)}
          onFound={(ph) => {
            setCName(ph.name);
            if (ph.email) setCEmail(ph.email);
            applyCustomerNameToCompLines(ph.name, { passholderId: ph.id, email: ph.email });
            setScanOpen(false);
          }}
        />
      )}
      {/* Auto-shown when receipt text is pasted — modal handles full checkout */}
      {shortcutReceipt && (
        <HeartlandReceiptModal
          receipt={shortcutReceipt}
          onClose={() => setShortcutReceipt(null)}
        />
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
