import { useEffect, useState } from 'react';
import {
  backfillShortCodes,
  backfillSkus,
  buildHeartlandCatalogCSV,
  downloadCatalogCSV
} from '../../lib/heartland';
import { supabase } from '../../lib/supabase';
import { money } from '../../lib/money';
import type { HeartlandTransactionRow } from '../../lib/database.types';

export function HeartlandPanel() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [summary, setSummary] = useState<{
    screeningsTotal: number;
    screeningsWithCode: number;
    typesTotal: number;
    typesWithSku: number;
  } | null>(null);
  const [unmatched, setUnmatched] = useState<HeartlandTransactionRow[]>([]);

  async function loadSummary() {
    try {
      const [s, t, um] = await Promise.all([
        supabase.from('screenings').select('id, short_code'),
        supabase.from('ticket_types').select('id, heartland_sku').eq('active', true),
        supabase
          .from('heartland_transactions')
          .select('*')
          .in('status', ['pending', 'needs_review'])
          .order('charged_at', { ascending: false })
          .limit(100)
      ]);
      const screenings = (s.data ?? []) as { id: string; short_code: string | null }[];
      const types = (t.data ?? []) as { id: string; heartland_sku: string | null }[];
      setSummary({
        screeningsTotal: screenings.length,
        screeningsWithCode: screenings.filter((x) => x.short_code).length,
        typesTotal: types.length,
        typesWithSku: types.filter((x) => x.heartland_sku).length
      });
      setUnmatched((um.data ?? []) as HeartlandTransactionRow[]);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to load');
    }
  }

  useEffect(() => { loadSummary(); }, []);

  async function runBackfill() {
    setErr(null); setMsg(null); setBusy(true);
    try {
      const sRes = await backfillShortCodes();
      const tRes = await backfillSkus();
      setMsg(`Generated ${sRes.updated} new screening codes and ${tRes.updated} SKUs.`);
      await loadSummary();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Backfill failed');
    } finally { setBusy(false); }
  }

  async function download() {
    setErr(null); setMsg(null); setBusy(true);
    try {
      const csv = await buildHeartlandCatalogCSV();
      downloadCatalogCSV(csv);
      setMsg('Catalog CSV downloaded. Upload it to Heartland Mobile Payments (Items → Import).');
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to build CSV');
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
        <div className="text-lg font-semibold mb-2">Heartland catalog sync</div>
        <div className="text-sm text-slate-400 mb-4">
          Heartland Mobile Payments uses its own item catalog. Generate short codes + SKUs for every
          screening × paid ticket-type combo, then download the CSV and bulk-import it into Heartland.
          When the Edge Function poll is live (coming after you share API credentials), transactions
          from Heartland will auto-match back to our screenings by SKU.
        </div>

        {summary && (
          <div className="grid grid-cols-2 gap-3 mb-4">
            <Stat label="Screenings with short code" value={`${summary.screeningsWithCode} / ${summary.screeningsTotal}`} />
            <Stat label="Ticket types with SKU" value={`${summary.typesWithSku} / ${summary.typesTotal}`} />
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            disabled={busy}
            onClick={runBackfill}
            className="bg-brand hover:bg-brand-dark disabled:opacity-50 text-white font-semibold px-4 py-2 rounded-lg"
          >
            {busy ? 'Working…' : 'Generate short codes + SKUs'}
          </button>
          <button
            disabled={busy}
            onClick={download}
            className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded-lg"
          >
            Download Heartland catalog CSV
          </button>
        </div>
        {msg && <div className="text-emerald-400 text-sm mt-3">{msg}</div>}
        {err && <div className="text-red-400 text-sm mt-3 whitespace-pre-wrap">{err}</div>}
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
        <div className="text-lg font-semibold mb-2">Unmatched Heartland transactions</div>
        <div className="text-sm text-slate-400 mb-3">
          When the API poll lands here with an item we can&apos;t map to a screening, it lands in this list for you to review.
        </div>
        {unmatched.length === 0 ? (
          <div className="text-slate-500 text-sm">Nothing waiting.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-400">
              <tr>
                <th className="text-left font-normal py-1">Time</th>
                <th className="text-left font-normal py-1">Heartland ID</th>
                <th className="text-right font-normal py-1">Amount</th>
                <th className="text-left font-normal py-1">Status</th>
              </tr>
            </thead>
            <tbody>
              {unmatched.map((tx) => (
                <tr key={tx.id} className="border-t border-slate-700">
                  <td className="py-1">
                    {new Date(tx.charged_at).toLocaleString('en-US', { timeZone: 'America/New_York' })}
                  </td>
                  <td className="py-1 font-mono text-xs">{tx.heartland_txn_id}</td>
                  <td className="py-1 text-right tabular-nums">{money(tx.amount_cents)}</td>
                  <td className="py-1 text-xs text-amber-300">{tx.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-3">
      <div className="text-xs uppercase text-slate-400">{label}</div>
      <div className="text-lg font-bold tabular-nums">{value}</div>
    </div>
  );
}
