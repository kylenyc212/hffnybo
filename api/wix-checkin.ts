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

function wixHeaders(includeContentType = false, minimal = false): Record<string, string> {
  const key     = process.env.WIX_API_KEY     ?? '';
  const account = process.env.WIX_ACCOUNT_ID  ?? '';
  const site    = process.env.WIX_SITE_ID     ?? '';
  if (!key || !account || !site) {
    throw new Error('Missing WIX_API_KEY, WIX_ACCOUNT_ID, or WIX_SITE_ID env vars');
  }
  // minimal=true: only Authorization, matching the Wix docs curl examples exactly.
  // Some v1 endpoints return 400 when extra headers (wix-account-id) are present.
  const h: Record<string, string> = minimal
    ? { Authorization: key }
    : { Authorization: key, 'wix-account-id': account, 'wix-site-id': site };
  if (includeContentType) h['Content-Type'] = 'application/json';
  return h;
}

export default async function handler(req: VReq, res: VRes) {
  try {
    const minHeaders  = wixHeaders(false, true);  // Authorization only — matches Wix docs curl examples
    const getHeaders  = wixHeaders(false, false); // Authorization + account/site headers
    const postHeaders = wixHeaders(true,  false); // + Content-Type for POST bodies
    // Site-only: auth + wix-site-id but no wix-account-id (untried variant)
    const key  = process.env.WIX_API_KEY    ?? '';
    const site = process.env.WIX_SITE_ID    ?? '';
    const siteOnlyHeaders: Record<string, string> = { Authorization: key, 'wix-site-id': site };
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

      // ── Strategy A: GET ticket — try multiple path shapes + header variants
      // Flat path (/events/v1/tickets/{tn}) consistently returns 400 for unknown reasons.
      // Event-scoped path (/events/v1/events/{eid}/tickets/{tn}) follows the same
      // pattern as the working order endpoint and may behave differently.
      const gtParams = new URLSearchParams();
      gtParams.append('fieldset', 'GUEST_DETAILS');
      gtParams.append('fieldset', 'TICKET_DETAILS');
      if (eventId) gtParams.set('event_id', eventId);
      const gtUrls = [
        // Event-scoped path (new — same pattern as working order endpoint)
        ...(eid ? [`${WIX_BASE}/events/v1/events/${eid}/tickets/${tn}`] : []),
        // Flat path with fieldsets + event_id
        `${WIX_BASE}/events/v1/tickets/${tn}?${gtParams}`,
      ];
      for (const gtUrl of gtUrls) {
        for (const hdr of [minHeaders, siteOnlyHeaders, getHeaders]) {
          const gtRes = await fetch(gtUrl, { headers: hdr });
          if (gtRes.ok) {
            const gtBody = await gtRes.json() as Record<string, unknown>;
            const ticket = (gtBody.ticket as Record<string, unknown> | undefined) ?? gtBody;
            res.status(200).json({ ticket, _endpoint: gtUrl, _raw: gtBody });
            return;
          }
        }
      }

      // ── Strategy B: POST /events/v2/guests/query → then CRM contact lookup for name
      // Guest query reliably finds the ticket; contacts API gives us the name.
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

          // Try to fetch the guest name from the CRM contacts API using contactId
          let orderFullName: string | null = (g.fullName as string | undefined) ?? null;
          if (!orderFullName && g.contactId) {
            try {
              const cRes = await fetch(
                `${WIX_BASE}/contacts/v4/contacts/${encodeURIComponent(String(g.contactId))}`,
                { headers: getHeaders }
              );
              if (cRes.ok) {
                const cBody = await cRes.json() as Record<string, unknown>;
                const info = (cBody.contact as Record<string, unknown> | undefined)?.info as Record<string, unknown> | undefined;
                const nameObj = info?.name as Record<string, unknown> | undefined;
                if (nameObj?.full) {
                  orderFullName = String(nameObj.full);
                } else if (nameObj?.first || nameObj?.last) {
                  orderFullName = [nameObj.first, nameObj.last].filter(Boolean).join(' ');
                }
              }
            } catch { /* name lookup failed — proceed without it */ }
          }

          // Fetch order to get ticket type name + definitive check-in status.
          // Correct endpoint: /events/v1/events/{eventId}/orders/{orderNumber}
          let ticketName: string | null = null;
          let orderCheckIn: Record<string, unknown> | null = null;
          let orderDebug: unknown = null;
          const orderNum  = String(g.orderNumber ?? '');
          const gEventId  = String(g.eventId ?? eventId ?? '');
          if (orderNum && gEventId) {
            try {
              const orUrl = `${WIX_BASE}/events/v1/events/${encodeURIComponent(gEventId)}/orders/${encodeURIComponent(orderNum)}`;
              const orRes = await fetch(orUrl, { headers: getHeaders });
              const orBody = await orRes.json() as Record<string, unknown>;
              orderDebug = { url: orUrl, status: orRes.status, body: orBody };
              if (orRes.ok) {
                const order  = (orBody.order ?? orBody) as Record<string, unknown>;
                const tickets = Array.isArray(order.tickets)
                  ? order.tickets as Record<string, unknown>[]
                  : [];
                const matchedTicket = tickets.find(
                  (t) => t.ticketNumber === ticketNumber || t.ticketNumber === g.ticketNumber
                ) ?? tickets[0];
                if (matchedTicket?.name)    ticketName   = String(matchedTicket.name);
                if (matchedTicket?.checkIn) orderCheckIn = matchedTicket.checkIn as Record<string, unknown>;
                // fullyCheckedIn is the order-level check-in flag Wix sets when all
                // tickets in the order are checked in — use it as fallback when
                // the tickets array is empty (e.g. comp/add-guest tickets).
                if (!orderCheckIn && order.fullyCheckedIn === true) {
                  orderCheckIn = { fullyCheckedIn: true };
                }
              }
            } catch (e) {
              orderDebug = { error: String(e) };
            }
          }

          // "Already checked in" detection: prefer ticket-level checkIn from order;
          // fall back to guest attendanceStatus (updates to ATTENDED after check-in).
          const isAttended = g.attendanceStatus === 'ATTENDED';
          const checkIn    = orderCheckIn ?? (isAttended ? { created: g.attendanceStatusUpdatedDate } : null);

          const ticket: Record<string, unknown> = {
            ticketNumber:  g.ticketNumber ?? ticketNumber,
            eventId:       gEventId,           // needed for check-in POST when no QR eventId
            orderFullName,
            guestDetails:  g.guestDetails ?? null,
            name:          ticketName ?? (g.ticketDetails as Record<string,unknown> | undefined)?.ticketName ?? null,
            checkIn,
            checkedIn:     isAttended || orderCheckIn !== null,
            canceled:      addl?.archived === true,
            orderStatus:   addl?.orderStatus,
            _source:       'guests/query',
          };
          res.status(200).json({ ticket, _endpoint: '/events/v2/guests/query', _raw: gqBody, _orderDebug: orderDebug });
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
