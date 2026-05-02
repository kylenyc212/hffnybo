import { useEffect, useState } from 'react';
import { money } from '../lib/money';
import { fmtWhen } from '../lib/datetime';
import {
  matchReceiptItems,
  matchedItemsToCartLines,
  loadMatchCatalog,
} from '../lib/heartland-receipt';
import type {
  ParsedHeartlandReceipt,
  MatchedItem,
  TTypeRow,
  SRow,
} from '../lib/heartland-receipt';
import { checkout } from '../lib/checkout';
import { getCheckinLinesForOrder, checkInOrderLine } from '../lib/checkins';
import type { OrderLineWithScreening } from '../lib/checkins';
import { useSession } from '../lib/session';

interface Props {
  receipt: ParsedHeartlandReceipt & { _rawText?: string };
  /** Called on both Cancel and Done — caller just closes the modal */
  onClose: () => void;
}

export function HeartlandReceiptModal({ receipt, onClose }: Props) {
  const { user, deviceLabel } = useSession();
  const [matched, setMatched]     = useState<MatchedItem[] | null>(null);
  const [loading, setLoading]     = useState(true);
  const [err, setErr]             = useState<string | null>(null);
  const [cName, setCName]         = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess]     = useState<{
    totalCents: number;
    synced: boolean;
  } | null>(null);
  const [checkinLines, setCheckinLines]   = useState<OrderLineWithScreening[]>([]);
  const [checkingIn, setCheckingIn]       = useState(false);

  // Catalog for manual-match dropdowns
  const [catalog, setCatalog] = useState<{ ticketTypes: TTypeRow[]; screenings: SRow[] } | null>(null);
  // Manual overrides keyed by item index: { screeningId, ticketTypeId }
  const [manualSc, setManualSc] = useState<Record<number, string>>({});   // idx → screeningId
  const [manualTt, setManualTt] = useState<Record<number, string>>({});   // idx → ticketTypeId

  useEffect(() => {
    setLoading(true);
    Promise.all([
      matchReceiptItems(receipt.items),
      loadMatchCatalog(),
    ])
      .then(([matchResult, cat]) => {
        setMatched(matchResult);
        setCatalog(cat);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : 'Match failed'))
      .finally(() => setLoading(false));
  }, [receipt]);

  /** Merge auto-matched results with any manual overrides */
  function buildFinalMatched(): MatchedItem[] {
    if (!matched || !catalog) return matched ?? [];
    return matched.map((m, i) => {
      const scId = manualSc[i];
      const ttId = manualTt[i];
      if (!scId || !ttId) return m; // no override → use auto result (may be unmatched)
      const sc = catalog.screenings.find((s) => s.id === scId);
      const tt = catalog.ticketTypes.find((t) => t.id === ttId);
      if (!sc || !tt) return m;
      return {
        ...m,
        screeningId: sc.id,
        screeningTitle: sc.title,
        screeningStartsAt: sc.starts_at,
        ticketTypeId: tt.id,
        label: tt.label,
        category: tt.category,
        matched: true,
      };
    });
  }

  async function confirm() {
    if (!matched || !user || !deviceLabel) return;
    setSubmitting(true);
    setErr(null);
    try {
      const finalMatched = buildFinalMatched();
      const baseLines = matchedItemsToCartLines(finalMatched);
      if (baseLines.length === 0) throw new Error('No items to record — assign each item to a screening first');
      const lines = baseLines.map((l, i) => ({ ...l, key: `hl-${i}` }));

      const result = await checkout({
        lines,
        cashierId: user.id,
        cashierName: user.name,
        deviceLabel,
        drawerId: null,            // Heartland CC never touches the cash drawer
        cashTenderedCents: 0,
        source: 'external_heartland',
        externalRef: receipt.receiptNumber || receipt.invoiceNumber || null,
        customerName: cName.trim() || null,
      });

      setSuccess({ totalCents: result.subtotalCents, synced: result.synced });

      // Auto-check in all lines so the cashier doesn't have to tap again
      if (result.synced) {
        setCheckingIn(true);
        try {
          const cls = await getCheckinLinesForOrder(result.orderId);
          await Promise.all(cls.map((l) => checkInOrderLine(l.id, user.name)));
          const updated = await getCheckinLinesForOrder(result.orderId);
          setCheckinLines(updated);
        } catch { /* check-in failure is non-fatal */ }
        setCheckingIn(false);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Checkout failed');
    } finally {
      setSubmitting(false);
    }
  }

  const finalMatched = buildFinalMatched();
  const stillUnmatched = finalMatched.filter((m) => !m.matched).length;

  // ── Success screen ──────────────────────────────────────────────────────────
  if (success) {
    return (
      <div className="fixed inset-0 bg-black/90 z-50 flex flex-col p-4 overflow-auto">
        <div className="max-w-lg mx-auto w-full space-y-4">

          <div className={`border rounded-2xl p-6 text-center ${
            success.synced
              ? 'bg-emerald-900/40 border-emerald-700'
              : 'bg-amber-900/40 border-amber-600'
          }`}>
            <div className={`text-2xl font-bold ${success.synced ? 'text-emerald-200' : 'text-amber-200'}`}>
              {success.synced ? '✓ Sale recorded' : 'Saved offline'}
            </div>
            {!success.synced && (
              <div className="mt-2 text-sm text-amber-200">
                Order queued — will sync when back online.
              </div>
            )}
            {cName && <div className="mt-2 text-slate-200 font-semibold">{cName}</div>}
            {(receipt.receiptNumber || receipt.invoiceNumber) && (
              <div className="mt-1 font-mono text-sm text-slate-400">
                Ref: {receipt.receiptNumber || receipt.invoiceNumber}
              </div>
            )}
            <div className="mt-2 text-slate-300">{money(success.totalCents)}</div>
            {receipt.cardBrand && (
              <div className="mt-1 text-xs text-slate-500">
                {receipt.cardBrand}{receipt.cardLast4 ? ` ···· ${receipt.cardLast4}` : ''}
              </div>
            )}
          </div>

          {/* Check-in status */}
          {success.synced && (
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
              {checkingIn ? (
                <div className="text-slate-400 text-sm text-center py-2">Checking in…</div>
              ) : checkinLines.length > 0 ? (
                <div className="space-y-2">
                  {checkinLines.map((line) => (
                    <div key={line.id} className="flex items-center gap-3 text-sm">
                      <span className="text-emerald-400 text-base">✓</span>
                      <div className="flex-1 min-w-0">
                        {line.screenings && (
                          <div className="text-xs text-slate-400">
                            {line.screenings.title} · {fmtWhen(line.screenings.starts_at)}
                          </div>
                        )}
                        <div className="font-semibold">
                          {line.label}{line.qty > 1 ? ` ×${line.qty}` : ''}
                        </div>
                      </div>
                      <span className="text-emerald-400 text-xs font-semibold">Checked in</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-slate-400 text-sm text-center">
                  Sale recorded — check-in unavailable offline
                </div>
              )}
            </div>
          )}

          <button
            onClick={onClose}
            className="w-full bg-brand hover:bg-brand-dark text-white font-bold py-4 rounded-xl text-lg"
          >
            Done — next sale
          </button>
        </div>
      </div>
    );
  }

  // ── Review + confirm ────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-black/90 z-50 flex flex-col p-4 overflow-auto">
      <div className="max-w-lg mx-auto w-full space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <div className="font-bold text-lg">Heartland Receipt</div>
            {receipt.receiptNumber && (
              <div className="text-xs text-slate-400 font-mono">#{receipt.receiptNumber}</div>
            )}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">✕</button>
        </div>

        {/* Receipt summary */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-2">
          {receipt.cardBrand && (
            <div className="text-xs text-slate-400">
              {receipt.cardBrand}{receipt.cardLast4 ? ` ···· ${receipt.cardLast4}` : ''}
            </div>
          )}
          <div className="space-y-1">
            {receipt.items.map((item, i) => (
              <div key={i} className="flex justify-between text-sm">
                <span className="text-slate-300 font-mono text-xs">{item.rawName} ×{item.qty}</span>
                <span className="tabular-nums">{money(item.qty * item.unitPriceCents)}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-slate-700 pt-2 flex justify-between font-bold">
            <span>Total</span>
            <span className="tabular-nums">{money(receipt.totalCents)}</span>
          </div>
        </div>

        {/* No items — show raw OCR for debugging */}
        {receipt.items.length === 0 && receipt._rawText && (
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-2">
            <div className="text-sm font-semibold text-amber-400">⚠ No items found — raw OCR text:</div>
            <pre className="text-xs text-slate-400 whitespace-pre-wrap max-h-48 overflow-auto">{receipt._rawText}</pre>
            <div className="text-xs text-slate-500">Share this with the developer if the text looks correct.</div>
          </div>
        )}

        {/* Matching results */}
        {loading && receipt.items.length > 0 && (
          <div className="text-slate-400 text-sm text-center py-4">Matching to screenings…</div>
        )}

        {err && (
          <div className="bg-red-900/40 border border-red-700 text-red-200 text-sm p-3 rounded-xl">{err}</div>
        )}

        {matched && matched.length > 0 && catalog && (
          <div className="space-y-2">
            {matched.map((m, i) => {
              const fm = finalMatched[i]; // after applying manual override
              const isFixed = !m.matched && fm.matched; // was unmatched, now manually assigned
              const scOptions = catalog.screenings
                .slice()
                .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
              const ttOptions = catalog.ticketTypes.filter(
                (t) => t.screening_id === (manualSc[i] ?? '')
              );

              return (
                <div
                  key={i}
                  className={`rounded-xl border p-3 space-y-2 ${
                    fm.matched
                      ? isFixed
                        ? 'bg-blue-950/40 border-blue-700'
                        : 'bg-emerald-950/40 border-emerald-800'
                      : 'bg-amber-950/30 border-amber-800'
                  }`}
                >
                  {/* Item header */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-sm leading-tight">
                        {fm.matched ? fm.label : m.raw.rawName}
                        {m.raw.qty > 1 && <span className="text-slate-400 ml-1">×{m.raw.qty}</span>}
                      </div>
                      {fm.matched && fm.screeningTitle && (
                        <div className="text-xs text-slate-400 mt-0.5">
                          {fm.screeningTitle}
                          {fm.screeningStartsAt ? ` · ${fmtWhen(fm.screeningStartsAt)}` : ''}
                        </div>
                      )}
                      {!fm.matched && (
                        <div className="text-xs text-amber-400 mt-0.5">
                          Not matched — assign below
                        </div>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="tabular-nums font-semibold">{money(m.raw.qty * m.raw.unitPriceCents)}</div>
                      <div className={`text-xs mt-0.5 ${
                        isFixed ? 'text-blue-400' : fm.matched ? 'text-emerald-400' : 'text-amber-400'
                      }`}>
                        {isFixed ? '✓ assigned' : fm.matched ? '✓ matched' : '⚠ unmatched'}
                      </div>
                    </div>
                  </div>

                  {/* Manual-match dropdowns — show for unmatched OR already-fixed items */}
                  {(!m.matched || isFixed) && (
                    <div className="space-y-1.5 pt-1 border-t border-slate-700/60">
                      {/* Screening picker */}
                      <select
                        className="w-full bg-slate-800 border border-slate-600 rounded-lg px-2 py-1.5 text-xs"
                        value={manualSc[i] ?? ''}
                        onChange={(e) => {
                          const scId = e.target.value;
                          setManualSc((p) => ({ ...p, [i]: scId }));
                          setManualTt((p) => { const n = { ...p }; delete n[i]; return n; });
                        }}
                      >
                        <option value="">— Select screening —</option>
                        {scOptions.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.starts_at ? `${fmtWhen(s.starts_at)} · ` : ''}{s.title}
                          </option>
                        ))}
                      </select>

                      {/* Ticket type picker — only shown once a screening is chosen */}
                      {manualSc[i] && (
                        <select
                          className="w-full bg-slate-800 border border-slate-600 rounded-lg px-2 py-1.5 text-xs"
                          value={manualTt[i] ?? ''}
                          onChange={(e) => {
                            setManualTt((p) => ({ ...p, [i]: e.target.value }));
                          }}
                        >
                          <option value="">— Select ticket type —</option>
                          {ttOptions.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.label} — {money(t.price_cents)}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {stillUnmatched > 0 && (
              <div className="text-xs text-amber-400 px-1">
                {stillUnmatched} item{stillUnmatched > 1 ? 's' : ''} still unmatched — assign above or they'll be skipped.
              </div>
            )}
          </div>
        )}

        {/* Optional customer name */}
        {matched && matched.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-slate-300 mb-1">
              Customer name <span className="font-normal text-slate-500">(optional)</span>
            </div>
            <input
              className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm"
              placeholder="As shown on Heartland receipt"
              value={cName}
              onChange={(e) => setCName(e.target.value)}
              autoCapitalize="words"
            />
          </div>
        )}

        {/* Actions */}
        {matched && (
          <div className="flex gap-2 pb-4">
            <button
              onClick={onClose}
              className="flex-1 bg-slate-700 hover:bg-slate-600 text-white font-semibold py-3 rounded-xl"
            >
              Cancel
            </button>
            <button
              disabled={submitting || finalMatched.filter((m) => m.matched).length === 0}
              onClick={confirm}
              className="flex-[2] bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white font-bold py-3 rounded-xl"
            >
              {submitting ? 'Recording…' : `Confirm & Check In ✓${stillUnmatched > 0 ? ` (skip ${stillUnmatched})` : ''}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
