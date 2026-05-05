import { useState, useEffect, useMemo, useCallback } from 'react';
import type { WixEventSummary } from '../lib/wix';
import { fetchWixEvents } from '../lib/wix';
import {
  lookupScreeningByWixId,
  loadBOGuestsForScreening,
  checkInOne,
  uncheckInOne,
  recordWixCheckin,
} from '../lib/checkins';
import type { BOGuestOrder } from '../lib/checkins';
import { useSession } from '../lib/session';
import { supabase } from '../lib/supabase';

/** Load ticket numbers checked in via our QR scanner for a Wix event. */
async function loadWixCheckinTickets(wixEventId: string): Promise<Set<string>> {
  const { data } = await supabase
    .from('wix_checkins')
    .select('ticket_number')
    .eq('wix_event_id', wixEventId);
  return new Set((data ?? []).map((r: { ticket_number: string }) => r.ticket_number));
}

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
// Guest list auto-refreshes after CACHE_TTL_MS to pick up new check-ins.
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes
const _cache: {
  events: WixEventSummary[];
  selectedEventId: string;
  guests: GuestRecord[];
  boOrders: BOGuestOrder[];
  boScreeningId: string | null;
  fetchedAt: string | null;
} = {
  events: [],
  selectedEventId: '',
  guests: [],
  boOrders: [],
  boScreeningId: null,
  fetchedAt: null,
};

interface GuestListTabProps {
  jumpToEventId?: string;
  onJumpConsumed?: () => void;
}

export function GuestListTab({ jumpToEventId, onJumpConsumed }: GuestListTabProps = {}) {
  const { user } = useSession();

  const [events, setEvents]                   = useState<WixEventSummary[]>(_cache.events);
  const [eventsLoading, setEventsLoading]     = useState(_cache.events.length === 0);
  const [selectedEventId, setSelectedEventId] = useState(_cache.selectedEventId);

  const [guests, setGuests]               = useState<GuestRecord[]>(_cache.guests);
  const [guestsLoading, setGuestsLoading] = useState(false);
  const [guestsError, setGuestsError]     = useState<string | null>(null);
  const [fetchedAt, setFetchedAt]         = useState<string | null>(_cache.fetchedAt);

  // Box-office guests
  const [boOrders, setBoOrders]               = useState<BOGuestOrder[]>(_cache.boOrders);
  const [boScreeningId, setBoScreeningId]     = useState<string | null>(_cache.boScreeningId);
  const [boLoading, setBoLoading]             = useState(false);
  // Local checked-in qty map: lineId → current qty (optimistic)
  const [boCheckedIn, setBoCheckedIn]         = useState<Record<string, number>>({});
  const [boLineBusy, setBoLineBusy]           = useState<Record<string, boolean>>({});

  const [search, setSearch] = useState('');
  const [ticketBusy, setTicketBusy]   = useState<Record<string, boolean>>({});
  const [ticketError, setTicketError] = useState<Record<string, string>>({});

  useEffect(() => {
    if (_cache.events.length > 0) return;
    fetchWixEvents()
      .then(({ events: evs }) => { _cache.events = evs; setEvents(evs); })
      .catch(() => {})
      .finally(() => setEventsLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedEventId) { setGuests([]); setBoOrders([]); return; }
    const cacheAge = _cache.fetchedAt ? Date.now() - new Date(_cache.fetchedAt).getTime() : Infinity;
    const cacheValid = _cache.selectedEventId === selectedEventId && _cache.guests.length > 0 && cacheAge < CACHE_TTL_MS;
    if (cacheValid) return;
    loadGuests(selectedEventId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEventId]);

  // Jump: when the QR scan tab taps a screening card, auto-select that event + load
  useEffect(() => {
    if (!jumpToEventId) return;
    _cache.selectedEventId = jumpToEventId;
    setSelectedEventId(jumpToEventId);
    setSearch('');
    setBoOrders([]);
    setBoCheckedIn({});
    loadGuests(jumpToEventId);
    onJumpConsumed?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpToEventId]);

  async function loadGuests(eventId: string) {
    setGuestsLoading(true);
    setBoLoading(true);
    setGuestsError(null);
    setTicketBusy({});
    setTicketError({});

    // Fetch Wix guests + our check-in records + linked BO screening in parallel
    const [wixResult, ourCheckinsResult, boScreening] = await Promise.allSettled([
      fetch(`/api/wix-guests?eventId=${encodeURIComponent(eventId)}`)
        .then((r) => r.json() as Promise<{ guests?: GuestRecord[]; error?: string }>),
      loadWixCheckinTickets(eventId),
      lookupScreeningByWixId(eventId),
    ]);

    // Wix guests — overlay check-in status from our own DB
    // (Wix guests/query API never updates checkedIn/attendanceStatus after ticket check-in)
    if (wixResult.status === 'fulfilled') {
      const data = wixResult.value;
      let fetched = data.guests ?? [];
      const ourCheckins = wixResult.status === 'fulfilled' && ourCheckinsResult.status === 'fulfilled'
        ? ourCheckinsResult.value
        : new Set<string>();

      if (ourCheckins.size > 0) {
        fetched = fetched.map((g) => {
          const tickets = g.tickets.map((t) => ({
            ...t,
            checkedIn: t.checkedIn || ourCheckins.has(t.number),
          }));
          return {
            ...g,
            tickets,
            checkedIn: tickets.length > 0 && tickets.every((t) => t.checkedIn),
          };
        });
      }

      const now = new Date().toISOString();
      _cache.selectedEventId = eventId;
      _cache.guests = fetched;
      _cache.fetchedAt = now;
      setGuests(fetched);
      setFetchedAt(now);
      if (data.error) setGuestsError(data.error);
    } else {
      setGuestsError('Failed to load Wix guests');
    }
    setGuestsLoading(false);

    // BO guests
    const sc = boScreening.status === 'fulfilled' ? boScreening.value : null;
    setBoScreeningId(sc?.id ?? null);
    _cache.boScreeningId = sc?.id ?? null;
    if (sc?.id) {
      try {
        const orders = await loadBOGuestsForScreening(sc.id);
        _cache.boOrders = orders;
        setBoOrders(orders);
        // Seed local check-in map
        const init: Record<string, number> = {};
        for (const o of orders) for (const l of o.lines) init[l.lineId] = l.checkedInQty;
        setBoCheckedIn(init);
      } catch { /* non-fatal */ }
    } else {
      setBoOrders([]);
    }
    setBoLoading(false);
  }

  const refreshBO = useCallback(async () => {
    if (!boScreeningId) return;
    setBoLoading(true);
    try {
      const orders = await loadBOGuestsForScreening(boScreeningId);
      _cache.boOrders = orders;
      setBoOrders(orders);
      const init: Record<string, number> = {};
      for (const o of orders) for (const l of o.lines) init[l.lineId] = l.checkedInQty;
      setBoCheckedIn(init);
    } catch { /* ignore */ } finally {
      setBoLoading(false);
    }
  }, [boScreeningId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return guests;
    return guests.filter((g) => {
      const full = `${g.firstName} ${g.lastName}`.toLowerCase();
      const rev  = `${g.lastName} ${g.firstName}`.toLowerCase();
      return full.includes(q) || rev.includes(q) || g.email.toLowerCase().includes(q);
    });
  }, [guests, search]);

  const filteredBO = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return boOrders;
    return boOrders.filter((o) => {
      const name = (o.customerName ?? '').toLowerCase();
      const lines = o.lines.map((l) => (l.patronName ?? '') + ' ' + l.label).join(' ').toLowerCase();
      return name.includes(q) || lines.includes(q);
    });
  }, [boOrders, search]);

  const totalCheckedIn = useMemo(() => guests.filter((g) => g.checkedIn).length, [guests]);
  const ticketsCheckedIn = useMemo(() =>
    guests.reduce((sum, g) => sum + g.tickets.filter((t) => t.checkedIn).length, 0), [guests]);
  const ticketsTotal = useMemo(() =>
    guests.reduce((sum, g) => sum + g.tickets.length, 0), [guests]);

  const boTicketsTotal = useMemo(() =>
    boOrders.reduce((sum, o) => sum + o.lines.reduce((s, l) => s + l.qty, 0), 0), [boOrders]);
  const boTicketsIn = useMemo(() =>
    Object.values(boCheckedIn).reduce((s, n) => s + n, 0), [boCheckedIn]);

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
      setGuests((prev) => {
        const updated = prev.map((g) => {
          if (g.id !== guest.id) return g;
          const newTickets = g.tickets.map((t) =>
            t.number === ticket.number ? { ...t, checkedIn: true } : t
          );
          return { ...g, tickets: newTickets, checkedIn: newTickets.every((t) => t.checkedIn) };
        });
        _cache.guests = updated;
        return updated;
      });

      // Record in our DB so the main screen check-in count stays in sync
      if (user) {
        recordWixCheckin({
          ticketNumber: ticket.number,
          wixEventId:   selectedEventId,
          screeningId:  boScreeningId,
          checkedInBy:  user.name,
          guestName:    [guest.firstName, guest.lastName].filter(Boolean).join(' ') || null,
          ticketType:   ticket.typeName !== 'Ticket' ? ticket.typeName : null,
        }).catch(() => {}); // best-effort
      }
    } catch (e: unknown) {
      setTicketError((prev) => ({ ...prev, [ticket.number]: e instanceof Error ? e.message : 'Failed' }));
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
              setBoOrders([]);
              setBoCheckedIn({});
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

      {(guestsLoading || boLoading) && (
        <div className="text-sm text-slate-400 text-center py-6">Loading guests…</div>
      )}

      {guestsError && (
        <div className="bg-red-900/40 border border-red-700 text-red-200 text-sm p-3 rounded-lg">
          {guestsError}
          <button onClick={() => loadGuests(selectedEventId)} className="ml-3 underline text-red-300">Retry</button>
        </div>
      )}

      {!guestsLoading && !boLoading && selectedEventId && (guests.length > 0 || boOrders.length > 0) && (
        <>
          {/* Stats bar + search */}
          <div className="flex items-center gap-2">
            <div className="text-xs text-slate-400 shrink-0 leading-tight">
              <div>
                <span className="text-slate-300 font-semibold">{ticketsCheckedIn + boTicketsIn}</span>
                <span className="text-slate-500">/{ticketsTotal + boTicketsTotal} in</span>
              </div>
              <div className="text-slate-600">{totalCheckedIn}/{guests.length} Wix · {boOrders.length} BO</div>
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
              onClick={() => { loadGuests(selectedEventId); }}
              className="text-xs text-slate-400 hover:text-slate-200 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5"
              title="Refresh all"
            >↺</button>
          </div>

          {fetchedAt && (
            <div className="text-[11px] text-slate-600 -mt-1">
              Last fetched {new Date(fetchedAt).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })}
              {selectedEvent && <> · {selectedEvent.title}</>}
            </div>
          )}

          {/* ── Wix Online section ── */}
          {filtered.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 px-1">
                🎟 Wix Online · {ticketsCheckedIn}/{ticketsTotal} tickets in
              </div>
              <ul className="space-y-1.5">
                {filtered.map((guest) => {
                  const allIn  = guest.tickets.every((t) => t.checkedIn);
                  const someIn = !allIn && guest.tickets.some((t) => t.checkedIn);
                  const name   = guest.lastName
                    ? `${guest.lastName}, ${guest.firstName}`
                    : guest.firstName || '—';
                  return (
                    <li key={guest.id} className={`rounded-xl border overflow-hidden ${
                      allIn  ? 'border-emerald-800 bg-emerald-950/60' :
                      someIn ? 'border-amber-800 bg-amber-950/30' :
                               'border-slate-700 bg-slate-800'
                    }`}>
                      <div className={`px-3 pt-2.5 pb-1 font-semibold text-sm ${
                        allIn ? 'text-emerald-300' : someIn ? 'text-amber-300' : 'text-white'
                      }`}>
                        {name}
                        {allIn  && <span className="ml-2 text-emerald-400 text-xs font-normal">✓ all in</span>}
                        {someIn && <span className="ml-2 text-amber-400 text-xs font-normal">partial</span>}
                      </div>
                      <div className="px-2 pb-2 space-y-1">
                        {guest.tickets.map((ticket) => {
                          const busy   = ticketBusy[ticket.number] ?? false;
                          const errMsg = ticketError[ticket.number];
                          const suffix = guest.tickets.length > 1 ? ` #${ticket.number.slice(-4)}` : '';
                          return (
                            <div key={ticket.number} className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 ${
                              ticket.checkedIn ? 'bg-emerald-900/40' : 'bg-slate-900/60'
                            }`}>
                              <div className="min-w-0 flex-1">
                                <span className="text-xs text-slate-300">{ticket.typeName}{suffix}</span>
                                {errMsg && <div className="text-xs text-red-400">{errMsg}</div>}
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
            </div>
          )}

          {/* ── Box Office Sales section ── */}
          {filteredBO.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 px-1 flex items-center justify-between">
                <span>📱 Box Office · {boTicketsIn}/{boTicketsTotal} tickets in</span>
                {boLoading && <span className="text-slate-600 normal-case font-normal">refreshing…</span>}
                {!boLoading && boScreeningId && (
                  <button onClick={refreshBO} className="text-slate-600 hover:text-slate-400 normal-case font-normal">↺ refresh</button>
                )}
              </div>
              <ul className="space-y-1.5">
                {filteredBO.map((order) => {
                  const totalQty = order.lines.reduce((s, l) => s + l.qty, 0);
                  const inQty    = order.lines.reduce((s, l) => s + (boCheckedIn[l.lineId] ?? l.checkedInQty), 0);
                  const allIn    = inQty >= totalQty;
                  const someIn   = inQty > 0 && !allIn;
                  const name     = order.customerName ?? order.lines.find((l) => l.patronName)?.patronName ?? 'Guest';
                  const sourceBadge = order.source === 'external_heartland'
                    ? <span className="ml-1.5 text-[10px] text-indigo-400 font-normal bg-indigo-900/40 px-1.5 py-0.5 rounded">CC</span>
                    : <span className="ml-1.5 text-[10px] text-emerald-400 font-normal bg-emerald-900/30 px-1.5 py-0.5 rounded">Cash</span>;

                  return (
                    <li key={order.orderId} className={`rounded-xl border overflow-hidden ${
                      allIn  ? 'border-emerald-800 bg-emerald-950/60' :
                      someIn ? 'border-amber-800 bg-amber-950/30' :
                               'border-slate-700 bg-slate-800'
                    }`}>
                      <div className={`px-3 pt-2.5 pb-1 font-semibold text-sm flex items-center ${
                        allIn ? 'text-emerald-300' : someIn ? 'text-amber-300' : 'text-white'
                      }`}>
                        <span className="flex-1 truncate">{name}</span>
                        {sourceBadge}
                        {allIn  && <span className="ml-2 text-emerald-400 text-xs font-normal shrink-0">✓ all in</span>}
                        {someIn && <span className="ml-2 text-amber-400 text-xs font-normal shrink-0">{inQty}/{totalQty}</span>}
                      </div>
                      <div className="px-2 pb-2 space-y-2">
                        {order.lines.map((line) => {
                          const curIn = boCheckedIn[line.lineId] ?? line.checkedInQty;
                          const busy  = boLineBusy[line.lineId] ?? false;
                          const displayName = line.patronName && line.patronName !== order.customerName
                            ? `${line.label} — ${line.patronName}`
                            : line.label;
                          return (
                            <div key={line.lineId} className="rounded-lg bg-slate-900/60 px-2 py-2 space-y-1.5">
                              <div className="text-xs text-slate-400">{displayName}</div>
                              {/* One badge per ticket slot — green = in, gray = not in */}
                              <div className="flex flex-wrap gap-1.5">
                                {Array.from({ length: line.qty }, (_, i) => {
                                  const isIn = i < curIn;
                                  return (
                                    <button
                                      key={i}
                                      disabled={busy}
                                      onClick={async () => {
                                        if (!user) return;
                                        setBoLineBusy((p) => ({ ...p, [line.lineId]: true }));
                                        try {
                                          if (isIn) {
                                            // tapping a checked-in slot → undo one
                                            await uncheckInOne(line.lineId, curIn);
                                            setBoCheckedIn((p) => ({ ...p, [line.lineId]: curIn - 1 }));
                                          } else {
                                            // tapping an unchecked slot → check in one more
                                            await checkInOne(line.lineId, user.name, curIn, line.qty);
                                            setBoCheckedIn((p) => ({ ...p, [line.lineId]: curIn + 1 }));
                                          }
                                        } catch { /* ignore */ } finally {
                                          setBoLineBusy((p) => ({ ...p, [line.lineId]: false }));
                                        }
                                      }}
                                      className={`h-10 rounded-lg text-sm font-bold border transition-colors disabled:opacity-50 ${
                                        line.qty === 1 ? 'w-full' : 'min-w-[2.75rem] px-2'
                                      } ${
                                        isIn
                                          ? 'bg-emerald-700 border-emerald-600 text-white'
                                          : 'bg-slate-800 border-slate-600 text-slate-500 hover:border-emerald-600 hover:text-emerald-300'
                                      }`}
                                    >
                                      {isIn ? '✓ In' : line.qty > 1 ? `${i + 1}` : 'Check In'}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {filtered.length === 0 && filteredBO.length === 0 && search && (
            <div className="text-sm text-slate-500 text-center py-4">No guests match "{search}"</div>
          )}
        </>
      )}

      {!guestsLoading && !boLoading && selectedEventId && guests.length === 0 && boOrders.length === 0 && (
        <div className="text-sm text-slate-500 text-center py-6">No guests found for this event.</div>
      )}
    </div>
  );
}
