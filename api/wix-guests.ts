// GET /api/wix-guests?eventId=xxx
// Returns all attendees for a Wix event via v2/guests/query.
// One record per guest. Names come from guestDetails.firstName/lastName
// (populated for the buyer; may be blank for additional unnamed guests in an order).
// CheckedIn from guestDetails.checkedIn + attendanceStatus.

interface VReq {
  method?: string;
  query?: Record<string, string | string[] | undefined>;
}
interface VRes { status(n: number): VRes; json(o: unknown): void; }

const WIX_BASE = 'https://www.wixapis.com';

function getCreds() {
  const apiKey    = process.env.WIX_API_KEY;
  const accountId = process.env.WIX_ACCOUNT_ID;
  const siteId    = process.env.WIX_SITE_ID;
  if (!apiKey || !accountId || !siteId) throw new Error('Missing Wix credentials');
  return { apiKey, accountId, siteId };
}

function wixHeaders(contentType = false): Record<string, string> {
  const { apiKey, accountId, siteId } = getCreds();
  const h: Record<string, string> = {
    Authorization:    apiKey,
    'wix-account-id': accountId,
    'wix-site-id':    siteId,
  };
  if (contentType) h['Content-Type'] = 'application/json';
  return h;
}

interface WixGuestTicket {
  number?: string;
  definitionId?: string;
  name?: string;
  guestDetails?: { checkedIn?: boolean };
}

interface WixGuest {
  id?: string;
  eventId?: string;
  orderNumber?: string;
  tickets?: WixGuestTicket[];
  contactId?: string;
  guestDetails?: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    checkedIn?: boolean;
  };
  attendanceStatus?: string;   // "ATTENDING" | "NOT_ATTENDING" | "WAITLIST"
  guestType?: string;          // "BUYER" | "GUEST"
  createdDate?: string;
  additionalDetails?: {
    orderStatus?: string;
    archived?: boolean;
  };
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
  const seen = new Set<string>(); // deduplicate by guest id
  let cursor: string | null = null;

  for (let page = 0; page < 50; page++) {
    // Wix: when resuming with a cursor, filter+sort must be omitted entirely
    const body = cursor
      ? { query: { cursorPaging: { cursor, limit: 100 } }, fields: ['GUEST_DETAILS'] }
      : { query: { filter: { eventId }, sort: [{ fieldName: 'createdDate', order: 'ASC' }], cursorPaging: { limit: 100 } }, fields: ['GUEST_DETAILS'] };

    const res = await fetch(`${WIX_BASE}/events/v2/guests/query`, {
      method: 'POST',
      headers: wixHeaders(true),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Wix guests ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }

    const data = await res.json() as {
      guests?: WixGuest[];
      pagingMetadata?: { cursors?: { next?: string } };
    };

    const guests = data.guests ?? [];

    for (const g of guests) {
      // Skip archived/cancelled orders
      if (g.additionalDetails?.archived) continue;
      // Skip guests from other events (cursor pages don't re-apply the eventId filter)
      if (g.eventId && g.eventId !== eventId) continue;
      // Skip duplicates (can appear if cursor overlaps)
      if (seen.has(g.id ?? '')) continue;
      seen.add(g.id ?? '');

      const gd = g.guestDetails ?? {};
      const firstName = (gd.firstName ?? '').trim();
      const lastName  = (gd.lastName  ?? '').trim();

      // checkedIn: true if guestDetails says so, or attendanceStatus is arrived
      const checkedIn = gd.checkedIn === true || g.attendanceStatus === 'ARRIVED';

      const tickets = (g.tickets ?? [])
        .filter((t) => t.number)
        .map((t) => ({
          number:    t.number!,
          typeName:  t.name ?? 'Ticket',
          checkedIn: t.guestDetails?.checkedIn ?? checkedIn,
        }));

      all.push({
        id:          g.id ?? '',
        orderNumber: g.orderNumber ?? '',
        firstName,
        lastName,
        email:       gd.email ?? '',
        checkedIn,
        tickets,
      });
    }

    const nextCursor = data.pagingMetadata?.cursors?.next;
    // Stop if no more pages, or if this page had no matching guests for our event
    // (means the cursor has drifted into other events' records)
    const matchedThisPage = guests.filter(g => !g.eventId || g.eventId === eventId).length;
    if (!nextCursor || guests.length < 100 || matchedThisPage === 0) break;
    cursor = nextCursor;
  }

  // Sort: unchecked-in first, then last name alpha
  all.sort((a, b) => {
    if (a.checkedIn !== b.checkedIn) return a.checkedIn ? 1 : -1;
    const ln = a.lastName.localeCompare(b.lastName);
    return ln !== 0 ? ln : a.firstName.localeCompare(b.firstName);
  });

  return all;
}

export default async function handler(req: VReq, res: VRes) {
  try {
    if (req.method && req.method !== 'GET') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }
    const eventId = Array.isArray(req.query?.eventId)
      ? req.query!.eventId[0]
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
