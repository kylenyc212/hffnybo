// GET  /api/wix-checkin?ticket=AAAA-AAAA-BB021  → look up a Wix ticket
// POST /api/wix-checkin  { ticketNumber }        → mark checked in
//
// Uses the same WIX_API_KEY / WIX_ACCOUNT_ID / WIX_SITE_ID env vars
// as the other Wix functions. Self-contained (no shared imports).

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
      if (!ticketNumber) {
        res.status(400).json({ error: 'ticket query param required' });
        return;
      }

      const r = await fetch(
        `${WIX_BASE}/events/v1/tickets/${encodeURIComponent(ticketNumber)}`,
        { headers }
      );
      const data = await r.json() as Record<string, unknown>;
      if (!r.ok) {
        res.status(r.status).json({
          error: String((data as Record<string, unknown>).message ?? 'Wix lookup failed'),
          raw: data,
        });
        return;
      }
      res.status(200).json(data);
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
          error: String((data as Record<string, unknown>).message ?? 'Check-in failed'),
          raw: data,
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
