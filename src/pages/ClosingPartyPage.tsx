import { useEffect, useMemo, useRef, useState } from 'react';
import {
  loadPartyGuests,
  checkInGuest,
  undoCheckIn,
  addDoorGuest,
  type PartyGuest,
} from '../lib/partyGuests';
import { useSession } from '../lib/session';

// ── helpers ──────────────────────────────────────────────────────────────────

function fmtTime(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function fullName(g: PartyGuest) {
  return [g.first_name, g.last_name].filter(Boolean).join(' ');
}

type SortKey = 'az' | 'za' | 'pending' | 'checkedin';
type FilterKey = 'all' | 'party' | 'screening' | 'unchecked';

const SORT_LABELS: Record<SortKey, string> = {
  az: 'A → Z',
  za: 'Z → A',
  pending: 'Not in yet',
  checkedin: 'Checked in',
};
const FILTER_LABELS: Record<FilterKey, string> = {
  all: 'All',
  party: 'Party ✓',
  screening: 'Screening ✓',
  unchecked: 'Not in',
};

function noteColor(notes: string): string {
  const n = notes.toUpperCase();
  if (n === 'STAFF') return 'bg-blue-900/60 text-blue-300 border-blue-700';
  if (n.includes('JUROR')) return 'bg-purple-900/60 text-purple-300 border-purple-700';
  if (n.includes('VOLUNTEER')) return 'bg-teal-900/60 text-teal-300 border-teal-700';
  if (n.includes('SPONSOR')) return 'bg-yellow-900/60 text-yellow-300 border-yellow-700';
  if (n.includes('PRESS')) return 'bg-sky-900/60 text-sky-300 border-sky-700';
  if (n.includes('PASSHOLDER')) return 'bg-amber-900/60 text-amber-300 border-amber-700';
  if (n.includes('FILMMAKER')) return 'bg-rose-900/60 text-rose-300 border-rose-700';
  return 'bg-slate-700/60 text-slate-300 border-slate-600';
}

// ── component ─────────────────────────────────────────────────────────────────

export function ClosingPartyPage() {
  const { user } = useSession();
  const [guests, setGuests] = useState<PartyGuest[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('az');
  const [filter, setFilter] = useState<FilterKey>('all');

  // Door-add form
  const [addOpen, setAddOpen] = useState(false);
  const [addFirst, setAddFirst] = useState('');
  const [addLast, setAddLast] = useState('');
  const [addNotes, setAddNotes] = useState('');
  const [addBusy, setAddBusy] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);

  async function reload() {
    try {
      setErr(null);
      const data = await loadPartyGuests();
      setGuests(data);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); }, []);

  // Poll every 15 s so multiple iPads stay in sync
  useEffect(() => {
    const id = setInterval(() => {
      reload().catch(() => {});
    }, 15_000);
    return () => clearInterval(id);
  }, []);

  async function handleCheckIn(g: PartyGuest) {
    if (!user) return;
    // Optimistic update
    setGuests((prev) =>
      prev.map((x) =>
        x.id === g.id
          ? { ...x, checked_in: true, checked_in_at: new Date().toISOString(), checked_in_by: user.name }
          : x
      )
    );
    try {
      await checkInGuest(g.id, user.name);
    } catch {
      // Revert on error
      setGuests((prev) => prev.map((x) => (x.id === g.id ? g : x)));
    }
  }

  async function handleUndo(g: PartyGuest) {
    // Optimistic update
    setGuests((prev) =>
      prev.map((x) =>
        x.id === g.id
          ? { ...x, checked_in: false, checked_in_at: null, checked_in_by: null }
          : x
      )
    );
    try {
      await undoCheckIn(g.id);
    } catch {
      setGuests((prev) => prev.map((x) => (x.id === g.id ? g : x)));
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !addFirst.trim()) return;
    setAddBusy(true);
    try {
      const newGuest = await addDoorGuest({
        firstName: addFirst.trim(),
        lastName: addLast.trim(),
        notes: addNotes.trim(),
        checkedInBy: user.name,
      });
      setGuests((prev) => [...prev, newGuest]);
      setAddFirst('');
      setAddLast('');
      setAddNotes('');
      setAddOpen(false);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to add guest');
    } finally {
      setAddBusy(false);
    }
  }

  // ── derived lists ─────────────────────────────────────────────────────────

  const displayed = useMemo(() => {
    const q = search.trim().toLowerCase();

    let list = guests.filter((g) => {
      if (q) {
        const name = fullName(g).toLowerCase();
        const notes = g.notes.toLowerCase();
        if (!name.includes(q) && !notes.includes(q)) return false;
      }
      if (filter === 'party') return g.has_party;
      if (filter === 'screening') return g.has_screening;
      if (filter === 'unchecked') return !g.checked_in;
      return true;
    });

    list = [...list].sort((a, b) => {
      if (sort === 'az' || sort === 'za') {
        const la = (a.last_name || a.first_name).toLowerCase();
        const lb = (b.last_name || b.first_name).toLowerCase();
        const fa = a.first_name.toLowerCase();
        const fb = b.first_name.toLowerCase();
        const cmp = la.localeCompare(lb) || fa.localeCompare(fb);
        return sort === 'az' ? cmp : -cmp;
      }
      if (sort === 'pending') {
        // Not checked in first, then alphabetical
        if (a.checked_in !== b.checked_in) return a.checked_in ? 1 : -1;
        return (a.last_name || a.first_name).localeCompare(b.last_name || b.first_name);
      }
      if (sort === 'checkedin') {
        if (a.checked_in !== b.checked_in) return a.checked_in ? -1 : 1;
        return (a.checked_in_at ?? '').localeCompare(b.checked_in_at ?? '');
      }
      return 0;
    });

    return list;
  }, [guests, search, sort, filter]);

  const totalIn = guests.filter((g) => g.checked_in).length;
  const partyIn = guests.filter((g) => g.has_party && g.checked_in).length;
  const partyTotal = guests.filter((g) => g.has_party).length;

  // ── render ────────────────────────────────────────────────────────────────

  if (loading) return <div className="p-6 text-slate-400">Loading…</div>;
  if (err && guests.length === 0) return <div className="p-6 text-red-400">{err}</div>;

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">

      {/* ── Header ── */}
      <div className="sticky top-0 bg-slate-900 pt-2 pb-3 z-10 border-b border-slate-800 mb-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <h1 className="text-2xl font-bold leading-tight">🎉 Closing Party</h1>
            <div className="flex gap-3 text-sm text-slate-400 mt-0.5">
              <span><span className="text-white font-semibold">{totalIn}</span> / {guests.length} checked in</span>
              <span className="text-slate-600">·</span>
              <span><span className="text-emerald-400 font-semibold">{partyIn}</span> / {partyTotal} party</span>
            </div>
          </div>
          <button
            onClick={() => { setAddOpen((o) => !o); setTimeout(() => document.getElementById('add-first')?.focus(), 50); }}
            className={`shrink-0 px-4 py-2.5 rounded-xl font-semibold text-sm border transition-colors ${
              addOpen
                ? 'bg-emerald-700 border-emerald-600 text-white'
                : 'bg-slate-800 border-emerald-700/60 text-emerald-300 hover:bg-slate-700'
            }`}
          >
            + Add guest
          </button>
        </div>

        {/* Add-guest inline form */}
        {addOpen && (
          <form onSubmit={handleAdd} className="mb-3 bg-slate-800 border border-emerald-700 rounded-xl p-3 grid grid-cols-1 sm:grid-cols-6 gap-2 items-end">
            <input
              id="add-first"
              required
              className="sm:col-span-2 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm"
              placeholder="First name *"
              value={addFirst}
              onChange={(e) => setAddFirst(e.target.value)}
            />
            <input
              className="sm:col-span-2 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm"
              placeholder="Last name"
              value={addLast}
              onChange={(e) => setAddLast(e.target.value)}
            />
            <input
              className="sm:col-span-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm"
              placeholder="Notes"
              value={addNotes}
              onChange={(e) => setAddNotes(e.target.value)}
            />
            <div className="flex gap-2 sm:col-span-1">
              <button
                type="submit"
                disabled={addBusy || !addFirst.trim()}
                className="flex-1 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white font-semibold rounded-lg py-2 text-sm"
              >{addBusy ? '…' : '✓ Add'}</button>
              <button
                type="button"
                onClick={() => setAddOpen(false)}
                className="text-slate-500 hover:text-white px-2"
              >✕</button>
            </div>
            <div className="sm:col-span-6 text-xs text-emerald-400/80">
              Walk-in guests are automatically checked in and marked as added at the door.
            </div>
          </form>
        )}

        {/* Search */}
        <input
          ref={searchRef}
          className="w-full mb-2 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm"
          placeholder="Search name or notes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {/* Sort + Filter */}
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
            <button
              key={k}
              onClick={() => setSort(k)}
              className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                sort === k
                  ? 'bg-brand border-brand-dark text-white'
                  : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'
              }`}
            >{SORT_LABELS[k]}</button>
          ))}
          <div className="w-px bg-slate-700 mx-1" />
          {(Object.keys(FILTER_LABELS) as FilterKey[]).map((k) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                filter === k
                  ? 'bg-slate-600 border-slate-500 text-white'
                  : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'
              }`}
            >{FILTER_LABELS[k]}</button>
          ))}
        </div>

        {err && <div className="text-red-400 text-xs mt-2">{err}</div>}
      </div>

      {/* ── Guest list ── */}
      <div className="text-xs text-slate-500 mb-2">{displayed.length} shown</div>

      <div className="space-y-1.5">
        {displayed.map((g) => (
          <GuestRow
            key={g.id}
            guest={g}
            onCheckIn={() => handleCheckIn(g)}
            onUndo={() => handleUndo(g)}
          />
        ))}
        {displayed.length === 0 && (
          <div className="text-slate-500 text-center py-8">No guests match.</div>
        )}
      </div>
    </div>
  );
}

// ── GuestRow ──────────────────────────────────────────────────────────────────

function GuestRow({
  guest: g,
  onCheckIn,
  onUndo,
}: {
  guest: PartyGuest;
  onCheckIn: () => void;
  onUndo: () => void;
}) {
  const [undoOpen, setUndoOpen] = useState(false);

  return (
    <div
      className={`flex items-center gap-3 rounded-xl px-3 py-2.5 border transition-colors ${
        g.checked_in
          ? 'bg-emerald-950/30 border-emerald-800/50'
          : 'bg-slate-800 border-slate-700'
      } ${g.added_at_door ? 'border-dashed' : ''}`}
    >
      {/* Name + meta */}
      <div className="flex-1 min-w-0">
        <div className={`font-semibold truncate ${g.checked_in ? 'text-slate-400 line-through decoration-emerald-700' : ''}`}>
          {fullName(g)}
          {g.added_at_door && (
            <span className="ml-1.5 text-[10px] bg-slate-700 text-slate-400 px-1.5 rounded border border-slate-600 no-underline font-normal" style={{ textDecoration: 'none' }}>
              door
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
          {g.has_party && (
            <span className="text-[10px] bg-emerald-900/60 text-emerald-300 border border-emerald-700 px-1.5 rounded font-semibold">PARTY</span>
          )}
          {g.has_screening && (
            <span className="text-[10px] bg-indigo-900/60 text-indigo-300 border border-indigo-700 px-1.5 rounded font-semibold">SCREENING</span>
          )}
          {g.notes && (
            <span className={`text-[10px] px-1.5 rounded border font-medium ${noteColor(g.notes)}`}>
              {g.notes}
            </span>
          )}
          {g.checked_in && g.checked_in_at && (
            <span className="text-[10px] text-emerald-500">
              ✓ {fmtTime(g.checked_in_at)}{g.checked_in_by ? ` · ${g.checked_in_by}` : ''}
            </span>
          )}
        </div>
      </div>

      {/* Action */}
      {g.checked_in ? (
        undoOpen ? (
          <div className="flex gap-1.5 shrink-0">
            <button
              onClick={() => { onUndo(); setUndoOpen(false); }}
              className="bg-red-800 hover:bg-red-700 text-white text-xs font-semibold px-3 py-2 rounded-lg"
            >Undo</button>
            <button
              onClick={() => setUndoOpen(false)}
              className="text-slate-500 hover:text-white text-sm px-2"
            >✕</button>
          </div>
        ) : (
          <button
            onClick={() => setUndoOpen(true)}
            className="shrink-0 text-emerald-500 text-lg leading-none"
            title="Tap to undo check-in"
          >✓</button>
        )
      ) : (
        <button
          onClick={onCheckIn}
          className="shrink-0 bg-emerald-700 hover:bg-emerald-600 active:bg-emerald-500 text-white font-bold px-5 py-2.5 rounded-xl text-base leading-none"
        >In</button>
      )}
    </div>
  );
}
