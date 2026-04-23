import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { loadScreenings, type ScreeningWithSold } from '../lib/queries';
import { useCart } from '../lib/cart';
import { nyDateKey, nyTodayKey, fmtDayHeader } from '../lib/datetime';
import { ScreeningCard } from '../components/ScreeningCard';

const FESTIVAL_FROM = '2026-05-01';
const FESTIVAL_TO = '2026-05-07';

export function CatalogPage() {
  const [screenings, setScreenings] = useState<ScreeningWithSold[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const cartCount = useCart((s) => s.count());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await loadScreenings(FESTIVAL_FROM, FESTIVAL_TO);
        if (!cancelled) setScreenings(data);
      } catch (e: unknown) {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'Failed to load screenings');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Optimistic sold-count bump so "X left" updates immediately when a ticket is added.
  const bumpSold = (screeningId: string, qty: number) => {
    setScreenings((prev) =>
      prev.map((s) => (s.id === screeningId ? { ...s, sold_in_person: s.sold_in_person + qty } : s))
    );
  };

  // Passes + merch (always-available) render at the top regardless of date.
  const alwaysAvailable = useMemo(() => {
    const q = search.trim().toLowerCase();
    return screenings
      .filter((s) => s.is_always_available)
      .filter((s) => !q || s.title.toLowerCase().includes(q));
  }, [screenings, search]);

  // Regular screenings: group by NY-local day, hide past days.
  const grouped = useMemo(() => {
    const today = nyTodayKey();
    const q = search.trim().toLowerCase();
    const filtered = screenings.filter((s) => {
      if (s.is_always_available) return false;
      if (nyDateKey(s.starts_at) < today) return false;
      if (q && !s.title.toLowerCase().includes(q)) return false;
      return true;
    });
    const byDay = new Map<string, ScreeningWithSold[]>();
    for (const s of filtered) {
      const k = nyDateKey(s.starts_at);
      const list = byDay.get(k) ?? [];
      list.push(s);
      byDay.set(k, list);
    }
    return Array.from(byDay.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [screenings, search]);

  if (loading) return <div className="p-6 text-slate-400">Loading…</div>;
  if (err) return (
    <div className="p-6 text-red-400">
      <div className="font-bold mb-1">Failed to load</div>
      <div className="text-sm">{err}</div>
    </div>
  );

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4 gap-4 sticky top-0 bg-slate-900 py-2 z-10">
        <h1 className="text-2xl font-bold">Screenings</h1>
        <Link
          to="/cart"
          className="bg-brand hover:bg-brand-dark text-white px-4 py-2 rounded-lg font-semibold whitespace-nowrap"
        >
          Cart ({cartCount})
        </Link>
      </div>

      <input
        className="w-full mb-4 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2"
        placeholder="Search title…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {alwaysAvailable.length > 0 && (
        <section className="mb-6">
          <h2 className="text-sm uppercase tracking-wide text-amber-400 mb-2 sticky top-14 bg-slate-900 py-1">
            Festival-wide
          </h2>
          <div className="space-y-3">
            {alwaysAvailable.map((s) => (
              <ScreeningCard key={s.id} screening={s} onSold={bumpSold} />
            ))}
          </div>
        </section>
      )}

      {grouped.length === 0 && alwaysAvailable.length === 0 ? (
        <div className="text-slate-400">No upcoming screenings.</div>
      ) : (
        <div className="space-y-6">
          {grouped.map(([dayKey, list]) => (
            <section key={dayKey}>
              <h2 className="text-sm uppercase tracking-wide text-slate-400 mb-2 sticky top-14 bg-slate-900 py-1">
                {fmtDayHeader(list[0].starts_at)}
              </h2>
              <div className="space-y-3">
                {list.map((s) => (
                  <ScreeningCard key={s.id} screening={s} onSold={bumpSold} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
