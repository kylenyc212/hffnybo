// GET /api/wix-ticket-defs
// Returns all ticket type definitions for current Wix events, grouped by eventId.
// Each definition includes the per-type limit (actualLimit) when set.
// Does NOT include per-type sold counts — Wix only exposes aggregate sold at the event level.

interface VReq { method?: string; }
interface VRes { status(n: number): VRes; json(o: unknown): void; }

const WIX_BASE = 'https://www.wixapis.com';

function getCreds() {
  const apiKey    = process.env.WIX_API_KEY;
  const accountId = process.env.WIX_ACCOUNT_ID;
  const siteId    = process.env.WIX_SITE_ID;
  if (!apiKey || !accountId || !siteId) throw new Error('Missing Wix credentials');
  return { apiKey, accountId, siteId };
}

async function wixPost(path: string, body: unknown) {
  const { apiKey, accountId, siteId } = getCreds();
  const res = await fetch(`${WIX_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': apiKey,
      'wix-account-id': accountId,
      'wix-site-id': siteId,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Wix ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json() as Promise<Record<string, unknown>>;
}

interface RawDef {
  id: string;
  eventId: string;
  name?: string;
  limited?: boolean;
  initialLimit?: number;
  actualLimit?: number;
  saleStatus?: string;
  sortIndex?: number;
  pricingMethod?: {
    fixedPrice?: { value?: string; formattedValue?: string };
    free?: boolean;
  };
}

export interface TicketDefSummary {
  id: string;
  eventId: string;
  name: string;
  price: string | null;
  limited: boolean;
  limit: number | null;       // actualLimit — null means unlimited
  saleStatus: string;
  sortIndex: number;
}

async function fetchAllDefs(): Promise<TicketDefSummary[]> {
  const all: RawDef[] = [];
  let cursor: string | null = null;

  // Paginate through all definitions (up to 1000 total)
  for (let i = 0; i < 20; i++) {
    const body: Record<string, unknown> = { query: { paging: { limit: 100 } } };
    if (cursor) (body.query as Record<string, unknown>).cursorPaging = { cursor };

    let data: Record<string, unknown>;
    try {
      data = await wixPost('/events/v3/ticket-definitions/query', body);
    } catch {
      break;
    }

    const batch = (data.ticketDefinitions as RawDef[] | undefined) ?? [];
    all.push(...batch);

    const meta = data.metadata as { cursors?: { next?: string } } | undefined;
    const next = meta?.cursors?.next;
    if (!next || batch.length < 100) break;
    cursor = next;
  }

  return all.map((d) => ({
    id: d.id,
    eventId: d.eventId,
    name: d.name ?? '(unnamed)',
    price: d.pricingMethod?.fixedPrice?.formattedValue
        ?? (d.pricingMethod?.fixedPrice?.value ? `$${d.pricingMethod.fixedPrice.value}` : null),
    limited: !!d.limited,
    limit: d.limited ? (d.actualLimit ?? d.initialLimit ?? null) : null,
    saleStatus: d.saleStatus ?? '',
    sortIndex: d.sortIndex ?? 0,
  }));
}

export default async function handler(req: VReq, res: VRes) {
  try {
    if (req.method && req.method !== 'GET') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }
    const defs = await fetchAllDefs();
    // Group by eventId for easy lookup
    const byEvent: Record<string, TicketDefSummary[]> = {};
    for (const d of defs) {
      (byEvent[d.eventId] ??= []).push(d);
    }
    // Sort each event's types by sortIndex
    for (const list of Object.values(byEvent)) {
      list.sort((a, b) => a.sortIndex - b.sortIndex);
    }
    res.status(200).json({ byEvent, total: defs.length });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Failed';
    console.error('[/api/wix-ticket-defs]', msg);
    res.status(500).json({ error: msg });
  }
}
