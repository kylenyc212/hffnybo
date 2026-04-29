// GET /api/wix-guests?eventId=xxx
// Returns all attendees for a Wix event, one record per ORDER (the buyer).
// Names come from the order's contactDetails — the only reliable name source
// for ticketed (non-RSVP) events. CheckedIn status comes from per-ticket checkIn.

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

function wixHeaders(): Record<string, string> {
  const { apiKey, accountId, siteId } = getCreds();
  return {
    Authorization:    apiKey,
    'wix-account-id': accountId,
    'wix-site-id':    siteId,
  };
}

// ── Types ────────────────────────────────────────────────────────────────────

interface WixOrderTicket {
  ticketNumber?: string;
  name?: string;
  checkIn?: { created?: string } | null;
  status?: string;
  archived?: boolean;
}

interface WixOrder {
  orderNumber?: string;
  status?: string;
  // Buyer name can live in a few places depending on API version:
  buyer?: {
    email?: string;
    contactDetails?: {
      firstName?: string; lastName?: string; email?: string; phone?: string;
    };
  };
  // Some versions put contactDetails at root level
  contactDetails?: {
    firstName?: string; lastName?: string; email?: string; phone?: string;
  };
  tickets?: WixOrderTicket[];
}

export interface GuestRecord {
  id: string;
  orderNumber: string;
  firstName: string;
  lastName: string;
  email: string;
  /** true only when every ticket in the order is checked in */
  checkedIn: boolean;
  tickets: { number: string; typeName: string; checkedIn: boolean }[];
}

// ── Fetchers ─────────────────────────────────────────────────────────────────

async function fetchAllOrders(eventId: string): Promise<WixOrder[]> {
  const headers = wixHeaders();
  const all: WixOrder[] = [];
  let offset = 0;
  const limit = 100;

  for (let page = 0; page < 50; page++) {
    const url = `${WIX_BASE}/events/v1/events/${encodeURIComponent(eventId)}/orders?limit=${limit}&offset=${offset}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      // Swallow errors — caller will fall back to guest list
      console.error(`[wix-guests] orders fetch ${res.status}:`, await res.text().catch(() => ''));
      break;
    }
    const data = await res.json() as { orders?: WixOrder[]; total?: number };
    const batch = data.orders ?? [];
    all.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
  }
  return all;
}

/** Fallback: v2 guests query — used when orders endpoint doesn't have names. */
async function fetchRawGuests(eventId: string): Promise<{
  orderNumber: string;
  guestDetails: Record<string, unknown> | null;
  attendanceStatus?: string;
  tickets: WixOrderTicket[];
}[]> {
  const all: ReturnType<typeof fetchRawGuests> extends Promise<infer T> ? T : never = [];
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

    const res = await fetch(`${WIX_BASE}/events/v2/guests/query`, {
      method: 'POST',
      headers: { ...wixHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) break;

    const data = await res.json() as {
      guests?: Array<{
        orderNumber?: string;
        attendanceStatus?: string;
        guestDetails?: Record<string, unknown>;
        tickets?: WixOrderTicket[];
      }>;
      pagingMetadata?: { cursors?: { next?: string } };
    };
    const guests = data.guests ?? [];
    for (const g of guests) {
      all.push({
        orderNumber: g.orderNumber ?? '',
        guestDetails: g.guestDetails ?? null,
        attendanceStatus: g.attendanceStatus,
        tickets: g.tickets ?? [],
      });
    }

    const next = data.pagingMetadata?.cursors?.next;
    if (!next || guests.length < 100) break;
    cursor = next;
  }
  return all;
}

// ── Main builder ─────────────────────────────────────────────────────────────

async function buildGuestRecords(eventId: string): Promise<GuestRecord[]> {
  // Fetch both in parallel
  const [orders, rawGuests] = await Promise.all([
    fetchAllOrders(eventId),
    fetchRawGuests(eventId),
  ]);

  // Build order-level records (primary source for names + tickets)
  const records = new Map<string, GuestRecord>();

  for (const order of orders) {
    const num = order.orderNumber ?? '';
    if (!num) continue;

    // Try several field paths for buyer name
    const cd = order.buyer?.contactDetails ?? order.contactDetails ?? {};
    const firstName = cd.firstName ?? '';
    const lastName  = cd.lastName  ?? '';
    const email     = cd.email ?? order.buyer?.email ?? '';

    const tickets = (order.tickets ?? [])
      .filter((t) => t.ticketNumber && t.status !== 'CANCELLED' && !t.archived)
      .map((t) => ({
        number:    t.ticketNumber!,
        typeName:  t.name ?? 'Ticket',
        // checkIn is null/missing when not yet checked in, an object when done
        checkedIn: t.checkIn !== null && t.checkIn !== undefined,
      }));

    records.set(num, {
      id:          num,
      orderNumber: num,
      firstName,
      lastName,
      email,
      checkedIn:   tickets.length > 0 && tickets.every((t) => t.checkedIn),
      tickets,
    });
  }

  // Merge in guest-level checkedIn status (v2 guests is more authoritative for door status)
  // and fill in names for orders where contactDetails was empty
  const guestsByOrder = new Map<string, typeof rawGuests>();
  for (const g of rawGuests) {
    const key = g.orderNumber;
    if (!guestsByOrder.has(key)) guestsByOrder.set(key, []);
    guestsByOrder.get(key)!.push(g);
  }

  for (const [orderNum, guestList] of guestsByOrder.entries()) {
    const record = records.get(orderNum);
    if (!record) continue; // order not in orders list (shouldn't happen)

    // If we still have no name, try guest details (RSVP-style events)
    if (!record.firstName && !record.lastName) {
      for (const g of guestList) {
        const gd = g.guestDetails ?? {};
        // Try firstName/lastName (RSVP) and name.first/last (some paid ticket formats)
        const nameObj = gd.name as Record<string, unknown> | undefined;
        const fn = (gd.firstName ?? nameObj?.first ?? '') as string;
        const ln = (gd.lastName  ?? nameObj?.last  ?? '') as string;
        if (fn || ln) {
          record.firstName = fn;
          record.lastName  = ln;
          record.email     = (gd.email as string | undefined) ?? record.email;
          break;
        }
      }
    }

    // Update per-ticket checkedIn using attendance status from guests endpoint
    for (const g of guestList) {
      const attended = g.attendanceStatus === 'ATTENDED';
      if (!attended) continue;
      for (const gt of g.tickets ?? []) {
        if (!gt.ticketNumber) continue;
        const t = record.tickets.find((rt) => rt.number === gt.ticketNumber);
        if (t) t.checkedIn = true;
      }
    }

    // Recompute overall checkedIn
    record.checkedIn = record.tickets.length > 0 && record.tickets.every((t) => t.checkedIn);
  }

  // Sort: checked-in at bottom, then alphabetical by last name
  return [...records.values()].sort((a, b) => {
    if (a.checkedIn !== b.checkedIn) return a.checkedIn ? 1 : -1;
    const ln = a.lastName.localeCompare(b.lastName);
    return ln !== 0 ? ln : a.firstName.localeCompare(b.firstName);
  });
}

// ── Handler ───────────────────────────────────────────────────────────────────

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
    const guests = await buildGuestRecords(eventId);
    res.status(200).json({ guests, total: guests.length });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Failed';
    console.error('[/api/wix-guests]', msg);
    res.status(500).json({ error: msg });
  }
}
