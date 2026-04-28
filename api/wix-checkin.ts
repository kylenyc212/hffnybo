// GET  /api/wix-checkin?ticket=AAAA-AAAA-BB021&eventId=xxx  → look up a Wix ticket
// POST /api/wix-checkin  { ticketNumber, eventId }           → mark checked in
//
// The Wix ticket QR code encodes:
//   https://www.wixevents.com/check-in/{ticketNumber},{eventId}
// Both values are required by the Wix API — always pass both.
//
// Wix POST body shape (per official docs):
//   { eventId: string, ticketNumber: string[] }   ← "ticketNumber" not "ticketNumbers"
//
// IMPORTANT: the Wix API key (WIX_API_KEY) must have these permissions:
//   • Wix Events → "Read Guest List" (or "Read Event Tickets and Guest List")
//   • Wix Events → "Manage Guest List"
// If the key only has event-level permissions (for the sold-count sync), you
// will get 400/403 on every ticket call. Update the key in the Wix dev portal.

interface VReq {
  method?: string;
  url?: string;
  body?: Record<string, unknown>;
}
interface VRes {
  status(n: number): VRes;
  json(o: unknown): void;
}

const WIX_BASE = 'https://www.wixapis.com';

function wixHeaders(includeContentType = false): Record<string, string> {
  const key     = process.env.WIX_API_KEY     ?? '';
  const account = process.env.WIX_ACCOUNT_ID  ?? '';
  const site    = process.env.WIX_SITE_ID     ?? '';
  if (!key || !account || !site) {
    throw new Error('Missing WIX_API_KEY, WIX_ACCOUNT_ID, or WIX_SITE_ID env vars');
  }
  const h: Record<string, string> = {
    Authorization:    key,
    'wix-account-id': account,
    'wix-site-id':    site,
  };
  // Only add Content-Type for requests with a body (POST/PUT).
  // Sending Content-Type: application/json on GET requests with no body
  // causes some Wix endpoints to return 400.
  if (includeContentType) h['Content-Type'] = 'application/json';
  return h;
}

export default async function handler(req: VReq, res: VRes) {
  try {
    const getHeaders  = wixHeaders(false);  // no Content-Type — GET requests have no body
    const postHeaders = wixHeaders(true);   // Content-Type: application/json for POST
    const url = new URL(req.url ?? '/', 'http://localhost');

    // ── GET: look up ticket ──────────────────────────────────────────────
    if (req.method === 'GET') {
      const ticketNumber = url.searchParams.get('ticket') ?? '';
      const eventId      = url.searchParams.get('eventId') ?? '';
      if (!ticketNumber) {
        res.status(400).json({ error: 'ticket query param required' });
        return;
      }

      const tn  = encodeURIComponent(ticketNumber);
      const eid = eventId ? encodeURIComponent(eventId) : '';

      // ── Strategy A: GET /events/v1/tickets/{ticketNumber}
      // Returns full ticket with guestDetails (name, email) and checkIn timestamp.
      // No Content-Type header on GETs — that was causing the 400s before.
      const gtRes = await fetch(`${WIX_BASE}/events/v1/tickets/${tn}`, { headers: getHeaders });
      if (gtRes.ok) {
        const gtBody = await gtRes.json() as Record<string, unknown>;
        // Response may be the ticket directly or wrapped in { ticket: {...} }
        const ticket = (gtBody.ticket as Record<string, unknown> | undefined) ?? gtBody;
        res.status(200).json({ ticket, _endpoint: `/events/v1/tickets/${ticketNumber}`, _raw: gtBody });
        return;
      }

      // ── Strategy B: POST /events/v2/guests/query (filter by ticketNumber)
      // Returns limited fields (no name) but reliably finds the ticket.
      const guestFilter: Record<string, unknown> = { ticketNumber: { $eq: ticketNumber } };
      if (eventId) guestFilter.eventId = { $eq: eventId };
      const gqRes = await fetch(`${WIX_BASE}/events/v2/guests/query`, {
        method: 'POST',
        headers: postHeaders,
        body: JSON.stringify({ query: { filter: guestFilter } }),
      });
      if (gqRes.ok) {
        const gqBody = await gqRes.json() as Record<string, unknown>;
        const guests = Array.isArray(gqBody.guests) ? gqBody.guests as Record<string, unknown>[] : [];
        if (guests.length > 0) {
          const g = guests[0];
          const addl = g.additionalDetails as Record<string, unknown> | undefined;
          const ticket: Record<string, unknown> = {
            ticketNumber:  g.ticketNumber ?? ticketNumber,
            orderFullName: g.fullName ?? null,
            guestDetails:  g.guestDetails ?? null,
            name:          (g.ticketDetails as Record<string,unknown> | undefined)?.ticketName ?? null,
            checkIn:       g.attendanceStatus === 'ATTENDED' ? { created: g.attendanceStatusUpdatedDate } : null,
            checkedIn:     g.attendanceStatus === 'ATTENDED',
            canceled:      addl?.archived === true,
            orderStatus:   addl?.orderStatus,
            _source:       'guests/query',
          };
          res.status(200).json({ ticket, _endpoint: '/events/v2/guests/query', _raw: gqBody });
          return;
        }
      }

      // ── Strategy C: List Tickets GET endpoints ───────────────────────────
      const listEndpoints = [
        ...(eid ? [`${WIX_BASE}/events/v1/tickets?eventId=${eid}&ticketNumber=${tn}`] : []),
        `${WIX_BASE}/events/v1/tickets?ticketNumber=${tn}`,
      ];
      let lastStatus = gqRes.status;
      let lastBody: unknown = await gqRes.json().catch(() => null);

      for (const endpoint of listEndpoints) {
        const r    = await fetch(endpoint, { headers: getHeaders });
        const body = await r.json() as Record<string, unknown>;
        lastStatus = r.status;
        lastBody   = body;
        if (r.ok) {
          const ticketsArr = Array.isArray(body.tickets) ? body.tickets as Record<string, unknown>[] : null;
          if (ticketsArr && ticketsArr.length === 0) { continue; }
          const ticket = ticketsArr ? ticketsArr[0] : (body.ticket as Record<string, unknown> | undefined ?? body);
          res.status(200).json({ ticket, _endpoint: endpoint, _raw: body });
          return;
        }
        if (r.status !== 400 && r.status !== 404) break;
      }

      res.status(lastStatus || 502).json({
        error: String((lastBody as Record<string, unknown>)?.message ?? 'Wix lookup failed'),
        wixStatus: lastStatus,
        raw: lastBody,
      });
      return;
    }

    // ── POST: check in ──────────────────────────────────────────────────
    if (req.method === 'POST') {
      const ticketNumber = String(req.body?.ticketNumber ?? '').trim();
      const eventId      = String(req.body?.eventId      ?? '').trim();
      if (!ticketNumber) {
        res.status(400).json({ error: 'ticketNumber required in request body' });
        return;
      }
      if (!eventId) {
        res.status(400).json({ error: 'eventId required in request body — scan the full QR code URL, not just the ticket number' });
        return;
      }

      // Wix API shape: { eventId: string, ticketNumber: string[] }
      // Note: field is "ticketNumber" (array), NOT "ticketNumbers"
      const r = await fetch(`${WIX_BASE}/events/v1/tickets/check-in`, {
        method: 'POST',
        headers: postHeaders,
        body: JSON.stringify({ eventId, ticketNumber: [ticketNumber] }),
      });
      const data = await r.json() as Record<string, unknown>;
      if (!r.ok) {
        res.status(r.status).json({
          error: String(data.message ?? 'Check-in failed'),
          wixStatus: r.status,
          raw: data,
          hint: r.status === 403 || r.status === 401
            ? 'API key is missing "Manage Guest List" permission.'
            : undefined,
        });
        return;
      }
      res.status(200).json(data);
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Internal error' });
  }
}
