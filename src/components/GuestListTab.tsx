import { useState, useEffect, useMemo } from 'react';
import type { WixEventSummary } from '../lib/wix';
import { fetchWixEvents } from '../lib/wix';

interface GuestTicket {
  number: string;
  typeName: string;
  checkedIn: boolean;
}

interface GuestRecord {
  id: string;
  orderNumber: string;
  firstName: string;
  lastName: string;
  email: string;
  checkedIn: boolean;
  tickets: GuestTicket[];
}

type CheckinState = 'idle' | 'loading' | 'done' | 'error';

export function GuestListTab() {
  // ── Event selection ──
  const [events, setEvents]         = useState<WixEventSummary[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [selectedEventId, setSelectedEventId] = useState('');

  // ── Guest list ──
  const [guests, setGuests]         = useState<GuestRecord[]>([]);
  const [guestsLoading, setGuestsLoading] = useState(false);
  const [guestsError, setGuestsError]     = useState<string | null>(null);
  const [fetchedAt, setFetchedAt]   = useState<string | null>(null);

  // ── UI state ──
  const [search, setSearch]         = useState('');
  const [checkingIn, setCheckingIn] = useState<Record<string, CheckinState>>({});
  const [checkInError, setCheckInError] = useState<Record<string, string>>({});

  // Load event list on mount
  useEffect(() => {
    fetchWixEvents()
      .then(({ events: evs }) => setEvents(evs))
      .catch(() => { /* silently fail — user can still pick nothing */ })
      .finally(() => setEventsLoading(false));
  }, []);

  // Load guests whenever selected event changes
  useEffect(() => {
    if (!selectedEventId) { setGuests([]); return; }
    loadGuests(selectedEventId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEventId]);

  async function loadGuests(eventId: string) {
    setGuestsLoading(true);
    setGuestsError(null);
    try {
      const res  = await fetch(`/api/wix-guests?eventId=${encodeURIComponent(eventId)}`);
      const data = await res.json() as { guests?: GuestRecord[]; error?: string; total?: number };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      // API already sorts: unchecked first, then alpha by last name
      const sorted = data.guests ?? [];
      setGuests(sorted);
      setFetchedAt(new Date().toISOString());
    } catch (e: unknown) {
      setGuestsError(e instanceof Error ? e.message : 'Failed to load guests');
    } finally {
      setGuestsLoading(false);
    }
  }

  // Filter by search query
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return guests;
    return guests.filter((g) => {
      const full = `${g.firstName} ${g.lastName}`.toLowerCase();
      const rev  = `${g.lastName} ${g.firstName}`.toLowerCase();
      return full.includes(q) || rev.includes(q) || g.email.toLowerCase().includes(q) || g.orderNumber.toLowerCase().includes(q);
    });
  }, [guests, search]);

  // Stats
  const totalCheckedIn = useMemo(() => guests.filter((g) => g.checkedIn).length, [guests]);

  async function checkInGuest(guest: GuestRecord) {
    const eventId = selectedEventId;
    if (!eventId) return;

    // Get all unchecked tickets for this guest
    const unchecked = guest.tickets.filter((t) => !t.checkedIn).map((t) => t.number);
    if (unchecked.length === 0) return;

    setCheckingIn((prev) => ({ ...prev, [guest.id]: 'loading' }));
    setCheckInError((prev) => { const n = { ...prev }; delete n[guest.id]; return n; });

    try {
      // Check in all unchecked tickets (one POST per ticket — Wix API quirk)
      for (const tn of unchecked) {
        const res = await fetch('/api/wix-checkin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticketNumber: tn, eventId }),
        });
        if (!res.ok) {
          const body = await res.json() as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
      }

      // Optimistic update: mark guest + all tickets as checked in
      setGuests((prev) =>
        prev.map((g) =>
          g.id !== guest.id ? g : {
            ...g,
            checkedIn: true,
            tickets: g.tickets.map((t) => ({ ...t, checkedIn: true })),
          }
        )
      );
      setCheckingIn((prev) => ({ ...prev, [guest.id]: 'done' }));
    } catch (e: unknown) {
      setCheckingIn((prev) => ({ ...prev, [guest.id]: 'error' }));
      setCheckInError((prev) => ({
        ...prev,
        [guest.id]: e instanceof Error ? e.message : 'Check-in failed',
      }));
    }
  }

  // ── Selected event info ──
  const selectedEvent = events.find((e) => e.id === selectedEventId);

  return (
    <div className="space-y-3">
      {/* Event selector */}
      <div>
        {eventsLoading ? (
          <div className="text-sm text-slate-400">Loading events…</div>
        ) : (
          <select
            value={selectedEventId}
            onChange={(e) => {
              setSelectedEventId(e.target.value);
              setSearch('');
              setCheckingIn({});
              setCheckInError({});
            }}
            className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm"
          >
            <option value="">— Pick a Wix event —</option>
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.startDateLabel ? `${ev.startDateLabel} — ` : ''}{ev.title}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* No event selected */}
      {!selectedEventId && !eventsLoading && (
        <div className="text-sm text-slate-500 text-center py-4">
          Select an event above to see the guest list.
        </div>
      )}

      {/* Loading guests */}
      {guestsLoading && (
        <div className="text-sm text-slate-400 text-center py-6">Loading guests…</div>
      )}

      {/* Error */}
      {guestsError && (
        <div className="bg-red-900/40 border border-red-700 text-red-200 text-sm p-3 rounded-lg">
          {guestsError}
          <button
            onClick={() => loadGuests(selectedEventId)}
            className="ml-3 underline text-red-300 hover:text-red-100"
          >
            Retry
          </button>
        </div>
      )}

      {/* Guest list */}
      {!guestsLoading && !guestsError && selectedEventId && guests.length > 0 && (
        <>
          {/* Stats + search */}
          <div className="flex items-center gap-2">
            <div className="text-xs text-slate-400 shrink-0">
              {totalCheckedIn}/{guests.length} in
            </div>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name…"
              className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm"
              autoCapitalize="off"
              autoCorrect="off"
            />
            <button
              onClick={() => loadGuests(selectedEventId)}
              className="text-xs text-slate-400 hover:text-slate-200 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5"
              title="Refresh guest list"
            >
              ↺
            </button>
          </div>

          {fetchedAt && (
            <div className="text-[11px] text-slate-600 -mt-1">
              Last fetched {new Date(fetchedAt).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })}
              {selectedEvent && (
                <> · {selectedEvent.title}</>
              )}
            </div>
          )}

          {filtered.length === 0 ? (
            <div className="text-sm text-slate-500 text-center py-4">No guests match "{search}"</div>
          ) : (
            <ul className="space-y-1.5">
              {filtered.map((guest) => {
                const state   = checkingIn[guest.id] ?? 'idle';
                const ciErr   = checkInError[guest.id];
                const isIn    = guest.checkedIn || state === 'done';
                const loading = state === 'loading';
                const typeNames = [...new Set(guest.tickets.map((t) => t.typeName))].join(', ');

                return (
                  <li
                    key={guest.id}
                    className={`rounded-xl p-3 flex items-center justify-between gap-3 ${
                      isIn
                        ? 'bg-emerald-950/60 border border-emerald-800'
                        : 'bg-slate-800 border border-slate-700'
                    }`}
                  >
                    {/* Guest info */}
                    <div className="min-w-0 flex-1">
                      <div className={`font-semibold text-sm leading-snug ${isIn ? 'text-emerald-300' : 'text-white'}`}>
                        {guest.lastName ? `${guest.lastName}, ${guest.firstName}` : guest.firstName || '—'}
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5">{typeNames || 'Ticket'}</div>
                      {ciErr && (
                        <div className="text-xs text-red-400 mt-0.5">{ciErr}</div>
                      )}
                    </div>

                    {/* Check-in button / badge */}
                    {isIn ? (
                      <div className="shrink-0 text-emerald-400 text-sm font-semibold flex items-center gap-1">
                        <span className="text-lg leading-none">✓</span>
                        <span className="text-xs">In</span>
                      </div>
                    ) : (
                      <button
                        disabled={loading}
                        onClick={() => checkInGuest(guest)}
                        className={`shrink-0 font-bold text-sm px-3 py-2 rounded-lg transition-colors ${
                          state === 'error'
                            ? 'bg-red-800 hover:bg-red-700 text-white'
                            : 'bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white'
                        }`}
                      >
                        {loading ? '…' : state === 'error' ? 'Retry' : 'Check In'}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {/* Empty state after load */}
      {!guestsLoading && !guestsError && selectedEventId && guests.length === 0 && (
        <div className="text-sm text-slate-500 text-center py-6">
          No guests found for this event.
        </div>
      )}
    </div>
  );
}
