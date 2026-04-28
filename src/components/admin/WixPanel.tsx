import { useEffect, useMemo, useState } from 'react';
import {
  fetchWixEvents,
  moveWixEventMapping,
  syncWixSoldNow,
  timeAgo,
  listScreeningsForMapping,
  type WixEventSummary
} from '../../lib/wix';
import type { ScreeningRow } from '../../lib/database.types';
import { fmtWhen } from '../../lib/datetime';

export function WixPanel() {
  const [wixEvents, setWixEvents] = useState<WixEventSummary[]>([]);
  const [screenings, setScreenings] = useState<ScreeningRow[]>([]);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [autoPoll, setAutoPoll] = useState(true);

  async function loadAll(silent = false) {
    if (!silent) setErr(null);
    try {
      const [w, s] = await Promise.all([fetchWixEvents(), listScreeningsForMapping()]);
      setWixEvents(w.events);
      setFetchedAt(w.fetchedAt);
      setScreenings(s);
    } catch (e: unknown) {
      if (!silent) setErr(e instanceof Error ? e.message : 'Failed to load');
    }
  }

  useEffect(() => { loadAll(); }, []);

  // Auto-poll every 60s while the panel is open. Re-pulls Wix data AND
  // writes back to screenings.online_sold for any mapped screening.
  // Pauses while a manual sync is in progress.
  useEffect(() => {
    if (!autoPoll) return;
    const id = window.setInterval(async () => {
      if (busy) return;
      try {
        const w = await fetchWixEvents();
        setWixEvents(w.events);
        setFetchedAt(w.fetchedAt);
        await syncWixSoldNow(w.events);
        setScreenings(await listScreeningsForMapping());
      } catch {
        // Stay quiet on background failures — manual button surfaces errors.
      }
    }, 60_000);
    return () => window.clearInterval(id);
  }, [autoPoll, busy]);

  async function handleSync() {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const w = await fetchWixEvents();
      setWixEvents(w.events);
      setFetchedAt(w.fetchedAt);
      const r = await syncWixSoldNow(w.events);
      setMsg(
        r.changes.length === 0
          ? `Synced — no changes (${r.updated} screenings checked).`
          : `Synced ${r.changes.length} change(s):\n` +
            r.changes.map((c) => `  • ${c.title}: ${c.before} → ${c.after}`).join('\n')
      );
      setScreenings(await listScreeningsForMapping());
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Sync failed');
    } finally { setBusy(false); }
  }

  async function handleMap(wixEventId: string, fromScreeningId: string | null, toScreeningId: string | null) {
    setErr(null);
    try {
      await moveWixEventMapping(wixEventId, fromScreeningId, toScreeningId);
      setScreenings(await listScreeningsForMapping());
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Map failed');
    }
  }

  // For a given Wix event id, which BO screening (if any) currently has it mapped?
  const screeningByWixId = useMemo(() => {
    const m = new Map<string, ScreeningRow>();
    for (const s of screenings) {
      for (const wid of s.wix_event_ids ?? []) m.set(wid, s);
    }
    return m;
  }, [screenings]);

  // Count of mapped Wix events per BO screening (for dropdown labels)
  const wixCountByScreening = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of screenings) m.set(s.id, (s.wix_event_ids ?? []).length);
    return m;
  }, [screenings]);

  // Stats header
  const stats = useMemo(() => {
    const paid = wixEvents.filter((e) => !e.isFree && e.registrationType === 'TICKETING').length;
    const free = wixEvents.filter((e) => e.isFree).length;
    const totalSold = wixEvents.reduce((s, e) => s + e.ticketsSold, 0);
    const mapped = wixEvents.filter((e) => screeningByWixId.has(e.id)).length;
    return { paid, free, totalSold, mapped };
  }, [wixEvents, screeningByWixId]);

  return (
    <div className="space-y-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div>
            <div className="text-lg font-semibold">Wix online ticket sync</div>
            <div className="text-sm text-slate-400">
              Pulls online sales from Wix and writes them into{' '}
              <code className="text-slate-200">screenings.online_sold</code> so the box office
              capacity math stays correct. For double features, map both Wix events to the same BO
              screening — sold counts get summed.
            </div>
          </div>
          <button
            disabled={busy}
            onClick={handleSync}
            className="bg-brand hover:bg-brand-dark disabled:opacity-50 text-white font-semibold px-4 py-2 rounded-lg whitespace-nowrap"
          >
            {busy ? 'Syncing…' : 'Sync now'}
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
          <Stat label="Wix events (UPCOMING)" value={String(wixEvents.length)} />
          <Stat label="Mapped to BO" value={`${stats.mapped} / ${wixEvents.length}`} />
          <Stat label="Paid / Free" value={`${stats.paid} paid · ${stats.free} free`} />
          <Stat label="Tickets sold (Wix-side)" value={String(stats.totalSold)} />
        </div>

        <div className="flex items-center justify-between gap-3 mt-3 text-xs">
          <div className="text-slate-500">
            {fetchedAt ? `Wix data last fetched: ${timeAgo(fetchedAt)}` : 'Not loaded yet'}
          </div>
          <label className="flex items-center gap-2 cursor-pointer text-slate-400 hover:text-slate-200">
            <input
              type="checkbox"
              checked={autoPoll}
              onChange={(e) => setAutoPoll(e.target.checked)}
            />
            Auto-refresh every 60s while open
          </label>
        </div>
        {msg && <pre className="text-emerald-400 text-xs mt-3 whitespace-pre-wrap font-mono">{msg}</pre>}
        {err && <div className="text-red-400 text-sm mt-3 whitespace-pre-wrap">{err}</div>}
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
        <div className="text-lg font-semibold mb-3">Wix events → BO screenings</div>
        <div className="text-xs text-slate-400 mb-3">
          Pick which BO screening each Wix event belongs to. A single BO screening can receive
          multiple Wix events (double features) — the sold counts are summed.
        </div>

        <div className="overflow-x-auto -mx-2">
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-400">
              <tr>
                <th className="text-left font-normal py-1 px-2">Wix event</th>
                <th className="text-left font-normal py-1 px-2">When</th>
                <th className="text-right font-normal py-1 px-2">Price</th>
                <th className="text-right font-normal py-1 px-2">Sold</th>
                <th className="text-left font-normal py-1 px-2">→ BO screening</th>
              </tr>
            </thead>
            <tbody>
              {wixEvents.map((ev) => {
                const mappedScreening = screeningByWixId.get(ev.id);
                return (
                  <tr key={ev.id} className="border-t border-slate-700 align-top">
                    <td className="py-2 px-2">
                      <div className="font-semibold leading-tight">{ev.title}</div>
                      <div className="text-[10px] text-slate-500 flex gap-2 mt-1">
                        <span className={ev.isFree ? 'text-emerald-400' : 'text-amber-300'}>
                          {ev.isFree ? 'FREE' : 'PAID'}
                        </span>
                        <span>·</span>
                        <span>{ev.registrationType ?? '?'}</span>
                        {ev.soldOut && (
                          <>
                            <span>·</span>
                            <span className="text-red-400 font-bold">SOLD OUT</span>
                          </>
                        )}
                      </div>
                    </td>
                    <td className="py-2 px-2 text-xs text-slate-400">
                      {ev.startDateLabel || <em>TBD</em>}
                    </td>
                    <td className="py-2 px-2 text-xs text-right tabular-nums">
                      {ev.isFree
                        ? '—'
                        : ev.lowestPrice && ev.highestPrice && ev.lowestPrice !== ev.highestPrice
                          ? `${ev.lowestPrice}–${ev.highestPrice}`
                          : ev.lowestPrice ?? '—'}
                    </td>
                    <td className="py-2 px-2 text-right tabular-nums font-semibold">
                      {ev.registrationType === 'RSVP' ? `${ev.rsvpCount} RSVP` : ev.ticketsSold}
                    </td>
                    <td className="py-2 px-2">
                      <select
                        className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs max-w-[280px]"
                        value={mappedScreening?.id ?? ''}
                        onChange={(e) =>
                          handleMap(ev.id, mappedScreening?.id ?? null, e.target.value || null)
                        }
                      >
                        <option value="">— skip —</option>
                        {screenings.map((s) => {
                          const count = wixCountByScreening.get(s.id) ?? 0;
                          // Show count of OTHER Wix events already mapped to this screening.
                          const otherCount =
                            count - ((s.wix_event_ids ?? []).includes(ev.id) ? 1 : 0);
                          return (
                            <option key={s.id} value={s.id}>
                              {s.is_always_available ? '★ ' : ''}
                              {fmtWhen(s.starts_at)} — {s.title}
                              {otherCount > 0 ? ` (+${otherCount} other Wix)` : ''}
                            </option>
                          );
                        })}
                      </select>
                      {mappedScreening?.wix_synced_at && (
                        <div className="text-[10px] text-slate-500 mt-1">
                          synced {timeAgo(mappedScreening.wix_synced_at)} · BO online_sold ={' '}
                          {mappedScreening.online_sold}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <UnmappedScreenings screenings={screenings} />
    </div>
  );
}

function UnmappedScreenings({ screenings }: { screenings: ScreeningRow[] }) {
  const unmapped = screenings.filter(
    (s) => (s.wix_event_ids ?? []).length === 0 && !s.is_always_available
  );
  if (unmapped.length === 0) return null;
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
      <div className="text-sm font-semibold mb-2">
        Box-office screenings without a Wix mapping ({unmapped.length})
      </div>
      <div className="text-xs text-slate-400 mb-3">
        These will keep using whatever <code>online_sold</code> you typed manually.
        Auto-sync only runs for mapped screenings.
      </div>
      <ul className="text-xs space-y-1">
        {unmapped.map((s) => (
          <li key={s.id} className="text-slate-400">
            <span className="font-mono text-slate-500">{fmtWhen(s.starts_at)}</span>{' '}
            <span className="text-slate-200">{s.title}</span>{' '}
            <span className="text-slate-500">· online_sold = {s.online_sold}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-3">
      <div className="text-[10px] uppercase text-slate-400 tracking-wide">{label}</div>
      <div className="text-base font-bold tabular-nums">{value}</div>
    </div>
  );
}
