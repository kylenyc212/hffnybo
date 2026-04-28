// GET  /api/wix-checkin?ticket=AAAA-AAAA-BB021&eventId=xxx  → look up a Wix ticket
// POST /api/wix-checkin  { ticketNumber, eventId? }          → mark checked in
//
// The Wix ticket QR code encodes:
//   https://www.wixevents.com/check-in/{ticketNumber},{eventId}
// Pass BOTH values here so we can try endpoint variants that require eventId.
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

function wixHeaders(): Record<string, string> {
  const key     = process.env.WIX_API_KEY     ?? '';
  const account = process.env.WIX_ACCOUNT_ID  ?? '';
  const site    = process.env.WIX_SITE_ID     ?? '';
  if (!key || !account || !site) {
    throw new Error('Missing WIX_API_KEY, WIX_ACCOUNT_ID, or WIX_SITE_ID env vars');
  }
  return {
    Authorization:    key,
    'wix-account-id': account,
    'wix-site-id':    site,
    'Content-Type':   'application/json',
  };
}

export default async function handler(req: VReq, res: VRes) {
  try {
    const headers = wixHeaders();
    const url = new URL(req.url ?? '/', 'http://localhost');

    // ── GET: look up ticket ──────────────────────────────────────────────
    if (req.method === 'GET') {
      const ticketNumber = url.searchParams.get('ticket') ?? '';
      const eventId      = url.searchParams.get('eventId') ?? '';
      if (!ticketNumber) {
        res.status(400).json({ error: 'ticket query param required' });
        return;
      }

      // Try the two most likely Wix endpoint shapes. The V1 API may require
      // the eventId scoped in the path; try both and return whichever works.
      const endpoints = [
        // Shape 1: ticket number only (documented in Wix dev portal)
        `${WIX_BASE}/events/v1/tickets/${encodeURIComponent(ticketNumber)}`,
        // Shape 2: scoped under event (common Wix pattern)
        ...(eventId
          ? [`${WIX_BASE}/events/v1/events/${encodeURIComponent(eventId)}/tickets/${encodeURIComponent(ticketNumber)}`]
          : []),
        // Shape 3: query via ticketNumber as query param
        `${WIX_BASE}/events/v1/tickets?ticketNumber=${encodeURIComponent(ticketNumber)}`,
      ];

      let lastStatus = 0;
      let lastBody: unknown = null;

      for (const endpoint of endpoints) {
        const r    = await fetch(endpoint, { headers });
        const body = await r.json() as Record<string, unknown>;
        lastStatus = r.status;
        lastBody   = body;
        if (r.ok) {
          res.status(200).json({ ...body, _endpoint: endpoint });
          return;
        }
        // 400 / 404 → try next shape; anything else (401, 403) → stop immediately
        if (r.status !== 400 && r.status !== 404) break;
      }

      // All endpoints failed — return the last error with full detail
      res.status(lastStatus || 502).json({
        error: String((lastBody as Record<string, unknown>)?.message ?? 'Wix lookup failed'),
        wixStatus: lastStatus,
        raw: lastBody,
        hint: lastStatus === 403 || lastStatus === 401
          ? 'API key is missing "Read Guest List" / "Manage Guest List" permissions. Update it in the Wix developer portal.'
          : lastStatus === 400
          ? 'Wix returned 400 — ticket number may be invalid, or the API key lacks ticket permissions.'
          : undefined,
      });
      return;
    }

    // ── POST: check in ──────────────────────────────────────────────────
    if (req.method === 'POST') {
      const ticketNumber = String(req.body?.ticketNumber ?? '').trim();
      if (!ticketNumber) {
        res.status(400).json({ error: 'ticketNumber required in request body' });
        return;
      }

      const r = await fetch(`${WIX_BASE}/events/v1/tickets/check-in`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ticketNumbers: [ticketNumber] }),
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
