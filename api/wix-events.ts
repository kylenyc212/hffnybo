// GET /api/wix-events
// Returns all UPCOMING (and STARTED) Wix events in a slim shape suitable
// for the admin mapping UI. Read-only; no DB writes.
//
// Self-contained: no shared imports from other api/ files (Vercel sometimes
// chokes on those at cold-start). Helpers inlined.

interface VReq { method?: string; }
interface VRes {
  status(n: number): VRes;
  json(o: unknown): void;
}

const WIX_BASE = 'https://www.wixapis.com';

function getCreds() {
  const apiKey = process.env.WIX_API_KEY;
  const accountId = process.env.WIX_ACCOUNT_ID;
  const siteId = process.env.WIX_SITE_ID;
  if (!apiKey || !accountId || !siteId) {
    throw new Error(
      'Missing Wix credentials. Set WIX_API_KEY, WIX_ACCOUNT_ID, WIX_SITE_ID in Vercel → Settings → Environment Variables, then redeploy.'
    );
  }
  return { apiKey, accountId, siteId };
}

async function wixCall(path: string, body: unknown) {
  const { apiKey, accountId, siteId } = getCreds();
  const res = await fetch(`${WIX_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': apiKey,
      'wix-account-id': accountId,
      'wix-site-id': siteId,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) {
    const errStr = typeof data === 'string' ? data : JSON.stringify(data);
    throw new Error(`Wix API ${res.status}: ${errStr.slice(0, 500)}`);
  }
  return data as Record<string, unknown>;
}

interface WixEvent {
  id: string;
  title?: string;
  status?: string;
  // v3 API uses scheduling; v1/v2 used dateAndTimeSettings — check both
  scheduling?: {
    config?: { startDate?: string; endDate?: string };
    formatted?: { start?: string; end?: string; dateAndTime?: string };
  };
  dateAndTimeSettings?: {
    startDate?: string;
    dateAndTimeTbdMessage?: string;
    formatted?: { dateAndTime?: string };
  };
  registration?: {
    type?: string;
    tickets?: {
      lowestPrice?: { value?: string; formattedValue?: string };
      highestPrice?: { value?: string; formattedValue?: string };
      soldOut?: boolean;
    };
  };
  summaries?: {
    rsvps?: { totalCount?: number };
    tickets?: { ticketsSold?: number; totalOrders?: number };
  };
}

async function listUpcomingWixEvents(): Promise<WixEvent[]> {
  const all: WixEvent[] = [];
  let offset = 0;
  while (offset < 1000) {
    const data = await wixCall('/events/v3/events/query', {
      query: {
        filter: { status: { $in: ['UPCOMING', 'STARTED'] } },
        paging: { limit: 100, offset }
      },
      // DASHBOARD is required for `summaries.tickets.ticketsSold` to come back.
      fields: ['DETAILS', 'TEXTS', 'REGISTRATION', 'DASHBOARD']
    });
    const batch = (data.events as WixEvent[] | undefined) ?? [];
    all.push(...batch);
    if (batch.length < 100) break;
    offset += 100;
  }
  return all;
}

function toSummary(ev: WixEvent) {
  const tix = ev.registration?.tickets;
  const summ = ev.summaries?.tickets ?? {};
  const rsvps = ev.summaries?.rsvps ?? {};
  const lowVal = tix?.lowestPrice?.value;
  const highVal = tix?.highestPrice?.value;
  const isFree =
    ev.registration?.type === 'RSVP' ||
    (lowVal === '0.00' && (highVal === undefined || highVal === '0.00')) ||
    (lowVal === '0' && (highVal === undefined || highVal === '0'));

  return {
    id: ev.id,
    title: ev.title || '(untitled)',
    status: ev.status,
      // Wix returns the human-readable date in formatted.dateAndTime or dateAndTimeTbdMessage.
    // There is no machine-readable startDate field in the v3 API response.
    startDate: ev.dateAndTimeSettings?.startDate ?? null,
    startDateLabel:
      ev.dateAndTimeSettings?.formatted?.dateAndTime ||
      ev.dateAndTimeSettings?.dateAndTimeTbdMessage ||
      null,
    registrationType: ev.registration?.type ?? null,
    isFree,
    lowestPrice: tix?.lowestPrice?.formattedValue ?? (lowVal ? `$${lowVal}` : null),
    highestPrice: tix?.highestPrice?.formattedValue ?? (highVal ? `$${highVal}` : null),
    soldOut: tix?.soldOut ?? false,
    ticketsSold: summ.ticketsSold ?? 0,
    totalOrders: summ.totalOrders ?? 0,
    rsvpCount: rsvps.totalCount ?? 0
  };
}

export default async function handler(req: VReq, res: VRes) {
  try {
    if (req.method && req.method !== 'GET') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }
    const events = await listUpcomingWixEvents();
    const summaries = events.map(toSummary);
    // startDate is always null in v3 API; parse startDateLabel for chronological sort
    summaries.sort((a, b) => {
      const da = a.startDateLabel ? new Date(a.startDateLabel).getTime() : NaN;
      const db = b.startDateLabel ? new Date(b.startDateLabel).getTime() : NaN;
      if (!isNaN(da) && !isNaN(db)) return da - db;
      if (!isNaN(da)) return -1;
      if (!isNaN(db)) return 1;
      return a.title.localeCompare(b.title);
    });
    res.status(200).json({
      events: summaries,
      fetchedAt: new Date().toISOString(),
      count: summaries.length
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Wix list failed';
    // Surface to Vercel's function logs for debugging
    console.error('[/api/wix-events]', msg, e);
    res.status(500).json({ error: msg });
  }
}
