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

// Module-level cache — survives navigation away and back within the same session.
const _cache: {
  events: WixEventSummary[];
  selectedEventId: string;
  guests: GuestRecord[];
  fetchedAt: string | null;
} = {
  events: [],
  selectedEventId: '',
  guests: [],
  fetchedAt: null,
};

export function GuestListTab() {
  const [events, setEvents]               = useState<WixEventSummary[]>(_cache.events);
  const [eventsLoading, setEventsLoading] = useState(_cache.events.length === 0);
  const [selectedEventId, setSelectedEventId] = useState(_cache.selectedEventId);

  const [guests, setGuests]             = useState<GuestRecord[]>(_cache.guests);
  const [guestsLoading, setGuestsLoading] = useState(false);
  const [guestsError, setGuestsError]   = useState<string | null>(null);
  const [fetchedAt, setFetchedAt]       = useState<string | null>(_cache.fetchedAt);

  const [search, setSearch] = useState('');
  // Per-ticket loading/error state keyed by ticket number
  const [ticketBusy, setTicketBusy]   = useState<Record<string, boolean>>({});
  const [ticketError, setTicketError] = useState<Record<string, string>>({});

  useEffect(() => {
    if (_cache.events.length > 0) return; // already cached
    fetchWixEvents()
      .then(({ events: evs }) => { _cache.events = evs; setEvents(evs); })
      .catch(() => {})
      .finally(() => setEventsLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedEventId) { setGuests([]); return; }
    // If we already have cached guests for this event, don't re-fetch automatically
    if (_cache.selectedEventId === selectedEventId && _cache.guests.length > 0) return;
    loadGuests(selectedEventId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEventId]);

  async function loadGuests(eventId: string) {
    setGuestsLoading(true);
    setGuestsError(null);
    setTicketBusy({});
    setTicketError({});
    try {
      const res  = await fetch(`/api/wix-guests?eventId=${encodeURIComponent(eventId)}`);
      const data = await res.json() as { guests?: GuestRecord[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      const fetched = data.guests ?? [];
      const now = new Date().toISOString();
      // Write through to cache
      _cache.selectedEventId = eventId;
      _cache.guests = fetched;
      _cache.fetchedAt = now;
      setGuests(fetched);
      setFetchedAt(now);
    } catch (e: unknown) {
      setGuestsError(e instanceof Error ? e.message : 'Failed to load guests');
    } finally {
      setGuestsLoading(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return guests;
    return guests.filter((g) => {
      const full = `${g.firstName} ${g.lastName}`.toLowerCase();
      const rev  = `${g.lastName} ${g.firstName}`.toLowerCase();
      return full.includes(q) || rev.includes(q) || g.email.toLowerCase().includes(q);
    });
  }, [guests, search]);

  // Count fully checked-in orders
  const totalCheckedIn = useMemo(() => guests.filter((g) => g.checkedIn).length, [guests]);
  // Count individual checked-in tickets
  const ticketsCheckedIn = useMemo(() =>
    guests.reduce((sum, g) => sum + g.tickets.filter((t) => t.checkedIn).length, 0), [guests]);
  const ticketsTotal = useMemo(() =>
    guests.reduce((sum, g) => sum + g.tickets.length, 0), [guests]);

  async function checkInTicket(guest: GuestRecord, ticket: GuestTicket) {
    if (!selectedEventId || ticket.checkedIn || ticketBusy[ticket.number]) return;

    setTicketBusy((prev) => ({ ...prev, [ticket.number]: true }));
    setTicketError((prev) => { const n = { ...prev }; delete n[ticket.number]; return n; });

    try {
      const res = await fetch('/api/wix-checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketNumber: ticket.number, eventId: selectedEventId }),
      });
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }

      // Optimistic update: mark this ticket checked in, recompute order checkedIn
      setGuests((prev) => {
        const updated = prev.map((g) => {
          if (g.id !== guest.id) return g;
          const newTickets = g.tickets.map((t) =>
            t.number === ticket.number ? { ...t, checkedIn: true } : t
          );
          return { ...g, tickets: newTickets, checkedIn: newTickets.every((t) => t.checkedIn) };
        });
        _cache.guests = updated; // keep cache in sync
        return updated;
      });
    } catch (e: unknown) {
      setTicketError((prev) => ({
        ...prev,
        [ticket.number]: e instanceof Error ? e.message : 'Failed',
      }));
    } finally {
      setTicketBusy((prev) => ({ ...prev, [ticket.number]: false }));
    }
  }

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
              const id = e.target.value;
              _cache.selectedEventId = id;
              setSelectedEventId(id);
              setSearch('');
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

      {!selectedEventId && !eventsLoading && (
        <div className="text-sm text-slate-500 text-center py-4">Select an event above to see the guest list.</div>
      )}

      {guestsLoading && (
        <div className="text-sm text-slate-400 text-center py-6">Loading guests…</div>
      )}

      {guestsError && (
        <div className="bg-red-900/40 border border-red-700 text-red-200 text-sm p-3 rounded-lg">
          {guestsError}
          <button onClick={() => loadGuests(selectedEventId)} className="ml-3 underline text-red-300 hover:text-red-100">Retry</button>
        </div>
      )}

      {!guestsLoading && !guestsError && selectedEventId && guests.length > 0 && (
        <>
          {/* Stats + search */}
          <div className="flex items-center gap-2">
            <div className="text-xs text-slate-400 shrink-0 text-right leading-tight">
              <div>{ticketsCheckedIn}/{ticketsTotal} tkts in</div>
              <div className="text-slate-600">{totalCheckedIn}/{guests.length} orders</div>
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
              title="Refresh"
            >↺</button>
          </div>

          {fetchedAt && (
            <div className="text-[11px] text-slate-600 -mt-1">
              Last fetched {new Date(fetchedAt).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })}
              {selectedEvent && <> · {selectedEvent.title}</>}
            </div>
          )}

          {filtered.length === 0 ? (
            <div className="text-sm text-slate-500 text-center py-4">No guests match "{search}"</div>
          ) : (
            <ul className="space-y-1.5">
              {filtered.map((guest) => {
                const allIn     = guest.tickets.every((t) => t.checkedIn);
                const someIn    = !allIn && guest.tickets.some((t) => t.checkedIn);
                const name      = guest.lastName
                  ? `${guest.lastName}, ${guest.firstName}`
                  : guest.firstName || '—';

                return (
                  <li
                    key={guest.id}
                    className={`rounded-xl border overflow-hidden ${
                      allIn  ? 'border-emerald-800 bg-emerald-950/60' :
                      someIn ? 'border-amber-800 bg-amber-950/30' :
                               'border-slate-700 bg-slate-800'
                    }`}
                  >
                    {/* Name header */}
                    <div className={`px-3 pt-2.5 pb-1 font-semibold text-sm ${
                      allIn ? 'text-emerald-300' : someIn ? 'text-amber-300' : 'text-white'
                    }`}>
                      {name}
                      {allIn && <span className="ml-2 text-emerald-400 text-xs font-normal">✓ all in</span>}
                      {someIn && <span className="ml-2 text-amber-400 text-xs font-normal">partial</span>}
                    </div>

                    {/* Per-ticket rows */}
                    <div className="px-2 pb-2 space-y-1">
                      {guest.tickets.map((ticket) => {
                        const busy  = ticketBusy[ticket.number] ?? false;
                        const err   = ticketError[ticket.number];
                        const suffix = guest.tickets.length > 1
                          ? ` #${ticket.number.slice(-4)}`
                          : '';
                        return (
                          <div
                            key={ticket.number}
                            className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 ${
                              ticket.checkedIn ? 'bg-emerald-900/40' : 'bg-slate-900/60'
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <span className="text-xs text-slate-300">
                                {ticket.typeName}{suffix}
                              </span>
                              {err && <div className="text-xs text-red-400">{err}</div>}
                            </div>
                            {ticket.checkedIn ? (
                              <span className="text-emerald-400 text-sm shrink-0">✓</span>
                            ) : (
                              <button
                                disabled={busy}
                                onClick={() => checkInTicket(guest, ticket)}
                                className="shrink-0 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-xs font-bold px-3 py-1 rounded-lg"
                              >
                                {busy ? '…' : 'Check In'}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {!guestsLoading && !guestsError && selectedEventId && guests.length === 0 && (
        <div className="text-sm text-slate-500 text-center py-6">No guests found for this event.</div>
      )}
    </div>
  );
}
