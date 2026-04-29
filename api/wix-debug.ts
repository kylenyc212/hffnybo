// GET /api/wix-debug?type=event   → raw first event object from v3 query
// GET /api/wix-debug?type=order&eventId=xxx → raw first order for that event
// GET /api/wix-debug?type=guest&eventId=xxx → raw first guest for that event
// DELETE AFTER USE — do not ship to production permanently

interface VReq {
  method?: string;
  query?: Record<string, string | string[] | undefined>;
}
interface VRes { status(n: number): VRes; json(o: unknown): void; }

const WIX_BASE = 'https://www.wixapis.com';

function getHeaders(includeContentType = false): Record<string, string> {
  const h: Record<string, string> = {
    Authorization:    process.env.WIX_API_KEY    ?? '',
    'wix-account-id': process.env.WIX_ACCOUNT_ID ?? '',
    'wix-site-id':    process.env.WIX_SITE_ID    ?? '',
  };
  if (includeContentType) h['Content-Type'] = 'application/json';
  return h;
}

export default async function handler(req: VReq, res: VRes) {
  const type    = Array.isArray(req.query?.type)    ? req.query!.type[0]    : req.query?.type    ?? 'event';
  const eventId = Array.isArray(req.query?.eventId) ? req.query!.eventId[0] : req.query?.eventId ?? '';

  try {
    if (type === 'event') {
      const r = await fetch(`${WIX_BASE}/events/v3/events/query`, {
        method: 'POST',
        headers: getHeaders(true),
        body: JSON.stringify({
          query: { filter: { status: { $in: ['UPCOMING','STARTED'] } }, paging: { limit: 1 } },
          fields: ['DETAILS','TEXTS','REGISTRATION','DASHBOARD'],
        }),
      });
      const data = await r.json();
      res.status(r.status).json(data);
      return;
    }

    if (type === 'order' && eventId) {
      const r = await fetch(
        `${WIX_BASE}/events/v1/events/${encodeURIComponent(eventId)}/orders?limit=1`,
        { headers: getHeaders() }
      );
      const data = await r.json();
      res.status(r.status).json(data);
      return;
    }

    if (type === 'guest' && eventId) {
      const offset = Number(Array.isArray(req.query?.offset) ? req.query!.offset[0] : req.query?.offset ?? '0');
      const r = await fetch(`${WIX_BASE}/events/v2/guests/query`, {
        method: 'POST',
        headers: getHeaders(true),
        body: JSON.stringify({
          query: { filter: { eventId }, paging: { limit: 100, offset }, sort: [{ fieldName: 'createdDate', order: 'ASC' }] },
          fields: ['GUEST_DETAILS'],
        }),
      });
      const data = await r.json() as Record<string, unknown>;
      const guests = Array.isArray(data.guests) ? data.guests as unknown[] : [];
      res.status(r.status).json({ pagingMetadata: data.pagingMetadata, guestsReturned: guests.length, offset });
      return;
    }

    res.status(400).json({ error: 'type=event|order|guest required; order and guest need eventId' });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
}
