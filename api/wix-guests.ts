// GET /api/wix-guests?eventId=xxx
// Returns all guests for a Wix event (paginated internally, flattened for the client).
// Each guest includes name, email, ticket numbers+types, and checkedIn status.

interface VReq {
  method?: string;
  query?: Record<string, string | string[] | undefined>;
}
interface VRes { status(n: number): VRes; json(o: unknown): void; }

function getCreds() {
  const apiKey    = process.env.WIX_API_KEY;
  const accountId = process.env.WIX_ACCOUNT_ID;
  const siteId    = process.env.WIX_SITE_ID;
  if (!apiKey || !accountId || !siteId) throw new Error('Missing Wix credentials');
  return { apiKey, accountId, siteId };
}

async function wixPost(path: string, body: unknown) {
  const { apiKey, accountId, siteId } = getCreds();
  const res = await fetch(`https://www.wixapis.com${path}`, {
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

interface WixTicket {
  number?: string;
  definitionId?: string;
  name?: string;
  guestDetails?: { checkedIn?: boolean };
}
interface WixGuest {
  id?: string;
  eventId?: string;
  orderNumber?: string;
  tickets?: WixTicket[];
  guestDetails?: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    checkedIn?: boolean;
  };
  attendanceStatus?: string;
  createdDate?: string;
}

export interface GuestRecord {
  id: string;
  orderNumber: string;
  firstName: string;
  lastName: string;
  email: string;
  checkedIn: boolean;
  tickets: { number: string; typeName: string; checkedIn: boolean }[];
}

async function fetchAllGuests(eventId: string): Promise<GuestRecord[]> {
  const all: GuestRecord[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < 50; page++) {
    const body: Record<string, unknown> = {
      query: {
        filter: { eventId },
        sort: [{ fieldName: 'createdDate', order: 'ASC' }],
      },
      fields: ['GUEST_DETAILS'],
    };
    if (cursor) {
      (body.query as Record<string, unknown>).cursorPaging = { cursor, limit: 100 };
    } else {
      (body.query as Record<string, unknown>).paging = { limit: 100 };
    }

    const data = await wixPost('/events/v2/guests/query', body);
    const guests = (data.guests as WixGuest[] | undefined) ?? [];

    for (const g of guests) {
      const d = g.guestDetails ?? {};
      all.push({
        id: g.id ?? '',
        orderNumber: g.orderNumber ?? '',
        firstName: d.firstName ?? '',
        lastName: d.lastName ?? '',
        email: d.email ?? '',
        checkedIn: d.checkedIn ?? false,
        tickets: (g.tickets ?? [])
          .filter((t) => t.number)
          .map((t) => ({
            number: t.number!,
            typeName: t.name ?? 'Ticket',
            checkedIn: t.guestDetails?.checkedIn ?? d.checkedIn ?? false,
          })),
      });
    }

    const meta = data.pagingMetadata as { cursors?: { next?: string } } | undefined;
    const next = meta?.cursors?.next;
    if (!next || guests.length < 100) break;
    cursor = next;
  }

  return all;
}

export default async function handler(req: VReq, res: VRes) {
  try {
    if (req.method && req.method !== 'GET') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }
    const eventId = Array.isArray(req.query?.eventId)
      ? req.query.eventId[0]
      : req.query?.eventId;
    if (!eventId) {
      res.status(400).json({ error: 'eventId required' });
      return;
    }
    const guests = await fetchAllGuests(eventId);
    res.status(200).json({ guests, total: guests.length });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Failed';
    console.error('[/api/wix-guests]', msg);
    res.status(500).json({ error: msg });
  }
}
