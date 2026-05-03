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

/** Fetch all checked-in ticket numbers for an event via the v1/tickets endpoint.
 *  This is the authoritative source — v2/guests/query never reflects check-in status. */
async function fetchCheckedInTickets(eventId: string): Promise<Set<string>> {
  const checked = new Set<string>();
  const limit = 100;
  for (let offset = 0; offset < 5000; offset += limit) {
    const params = new URLSearchParams({
      eventId,
      fieldset: 'TICKET_DETAILS',
      limit: String(limit),
      offset: String(offset),
    });
    const res = await fetch(`${WIX_BASE}/events/v1/tickets?${params}`, {
      headers: wixHeaders(false),
    });
    if (!res.ok) break;
    const data = await res.json() as { tickets?: Array<{ ticketNumber?: string; checkIn?: unknown }> };
    const tickets = data.tickets ?? [];
    for (const t of tickets) {
      if (t.ticketNumber && t.checkIn) checked.add(t.ticketNumber);
    }
    if (tickets.length < limit) break;
  }
  return checked;
}

async function fetchAllGuests(eventId: string, debug = false): Promise<{ guests: GuestRecord[]; rawSample?: unknown[] }> {
  const all: GuestRecord[] = [];
  const byOrder = new Map<string, GuestRecord>(); // orderNumber → merged record
  const rawSample: unknown[] = []; // debug: first 10 raw Wix guest records
  const limit = 100;

  for (let page = 0; page < 50; page++) {
    // Use offset-based paging so the eventId filter can be sent on every request.
    // Cursor-based paging strips the filter on page 2+, causing cross-event bleed.
    const body = {
      query: {
        filter: { eventId },
        sort: [{ fieldName: 'createdDate', order: 'ASC' }],
        paging: { limit, offset: page * limit },
      },
      fields: ['GUEST_DETAILS'],
    };

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
      pagingMetadata?: { count?: number; total?: number };
    };

    const guests = data.guests ?? [];
    for (const g of guests) {
      // Collect raw sample for debug mode (first 10 records)
      if (debug && rawSample.length < 10) {
        rawSample.push({
          orderNumber:      g.orderNumber,
          attendanceStatus: g.attendanceStatus,
          guestDetails:     g.guestDetails,
          tickets:          (g.tickets ?? []).map((t) => ({ number: t.number, checkedIn: t.guestDetails?.checkedIn })),
        });
      }
      if (g.additionalDetails?.archived) continue;

      const gd        = g.guestDetails ?? {};
      const firstName = (gd.firstName ?? '').trim();
      const lastName  = (gd.lastName  ?? '').trim();
      const email     = (gd.email ?? '').trim();
      const checkedIn = gd.checkedIn === true || g.attendanceStatus === 'ATTENDED' || g.attendanceStatus === 'ARRIVED';
      const orderNum  = g.orderNumber ?? g.id ?? '';

      const tickets = (g.tickets ?? [])
        .filter((t) => t.number)
        .map((t) => ({
          number:    t.number!,
          typeName:  t.name ?? 'Ticket',
          checkedIn: t.guestDetails?.checkedIn ?? checkedIn,
        }));

      const isNamed = !!(firstName || lastName);
      const existing = byOrder.get(orderNum);

      if (!existing) {
        // First record for this order → becomes the anchor row
        const record: GuestRecord = { id: orderNum, orderNumber: orderNum, firstName, lastName, email, checkedIn: false, tickets };
        byOrder.set(orderNum, record);
        all.push(record);
      } else if (isNamed && g.guestType === 'GUEST') {
        // Named additional guest → own searchable row so "Smith" finds Joe & Jane
        all.push({
          id: g.id ?? `${orderNum}-${all.length}`,
          orderNumber: orderNum,
          firstName,
          lastName,
          email: email || existing.email,
          checkedIn: false,
          tickets,
        });
      } else {
        // Nameless additional slot → merge tickets into anchor row
        if (!existing.firstName && firstName) existing.firstName = firstName;
        if (!existing.lastName  && lastName)  existing.lastName  = lastName;
        if (!existing.email     && email)      existing.email     = email;
        for (const t of tickets) {
          if (!existing.tickets.some((et) => et.number === t.number)) {
            existing.tickets.push(t);
          }
        }
      }
    }

    if (guests.length < limit) break; // last page
  }

  // Compute overall checkedIn: true only when every ticket is checked in
  for (const r of all) {
    r.checkedIn = r.tickets.length > 0 && r.tickets.every((t) => t.checkedIn);
  }

  // Overlay authoritative check-in status from v1/tickets
  const checkedInTickets = await fetchCheckedInTickets(eventId);
  for (const r of all) {
    const tickets = r.tickets.map((t) => ({
      ...t,
      checkedIn: t.checkedIn || checkedInTickets.has(t.number),
    }));
    r.tickets = tickets;
    r.checkedIn = tickets.length > 0 && tickets.every((t) => t.checkedIn);
  }

  // Sort: unchecked-in first, then last name alpha
  all.sort((a, b) => {
    if (a.checkedIn !== b.checkedIn) return a.checkedIn ? 1 : -1;
    const ln = a.lastName.localeCompare(b.lastName);
    return ln !== 0 ? ln : a.firstName.localeCompare(b.firstName);
  });

  return { guests: all, rawSample: debug ? rawSample : undefined };
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
    const debug = req.query?.debug === '1' || req.query?.debug === 'true';
    if (!eventId) {
      res.status(400).json({ error: 'eventId required' });
      return;
    }
    const { guests, rawSample } = await fetchAllGuests(eventId, debug);
    res.status(200).json({ guests, total: guests.length, ...(debug ? { _rawSample: rawSample } : {}) });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Failed';
    console.error('[/api/wix-guests]', msg);
    res.status(500).json({ error: msg });
  }
}
