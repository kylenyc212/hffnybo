// Shared helpers for the Vercel serverless functions that talk to Wix.
// Keep this file lean — it's bundled into every /api/wix-* function.

const WIX_BASE = 'https://www.wixapis.com';

export interface WixEvent {
  id: string;
  title: string;
  status: 'UPCOMING' | 'STARTED' | 'ENDED' | 'CANCELED' | 'DRAFT' | string;
  createdDate?: string;
  updatedDate?: string;
  dateAndTimeSettings?: {
    startDate?: string;
    endDate?: string;
    dateAndTimeTbd?: boolean;
    dateAndTimeTbdMessage?: string;
    formatted?: { dateAndTime?: string; startDate?: string; startTime?: string };
  };
  registration?: {
    type?: 'TICKETING' | 'RSVP' | 'EXTERNAL' | 'NO_REGISTRATION' | string;
    tickets?: {
      lowestPrice?: { value: string; currency: string; formattedValue?: string };
      highestPrice?: { value: string; currency: string; formattedValue?: string };
      soldOut?: boolean;
    };
    rsvp?: unknown;
  };
  summaries?: {
    rsvps?: { totalCount?: number; yesCount?: number; noCount?: number; waitlistCount?: number };
    tickets?: { ticketsSold?: number; totalOrders?: number; currencyLocked?: boolean };
  };
}

/** Compact, UI-friendly shape we expose to the browser. */
export interface WixEventSummary {
  id: string;
  title: string;
  status: string;
  startDate: string | null;     // ISO if known, else null
  startDateLabel: string | null; // "May 1, 2026, 6:00 PM" or TBD message
  registrationType: string | null;
  isFree: boolean;
  lowestPrice: string | null;   // formatted, e.g. "$12.30"
  highestPrice: string | null;
  soldOut: boolean;
  ticketsSold: number;
  totalOrders: number;
  rsvpCount: number;
}

function getCreds() {
  const apiKey = process.env.WIX_API_KEY;
  const accountId = process.env.WIX_ACCOUNT_ID;
  const siteId = process.env.WIX_SITE_ID;
  if (!apiKey || !accountId || !siteId) {
    throw new Error(
      'Missing Wix credentials. Set WIX_API_KEY, WIX_ACCOUNT_ID, WIX_SITE_ID in Vercel env vars.'
    );
  }
  return { apiKey, accountId, siteId };
}

async function wixCall(path: string, body: unknown): Promise<Record<string, unknown>> {
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

/**
 * Fetch all UPCOMING events. Pages until done. Includes summaries so we
 * can read `summaries.tickets.ticketsSold`.
 */
export async function listUpcomingWixEvents(): Promise<WixEvent[]> {
  const all: WixEvent[] = [];
  let offset = 0;
  // Wix paging cap is 100/req
  while (offset < 1000) {
    const data = await wixCall('/events/v3/events/query', {
      query: {
        filter: { status: { $in: ['UPCOMING', 'STARTED'] } },
        paging: { limit: 100, offset }
      },
      fields: ['DETAILS', 'TEXTS', 'REGISTRATION']
    });
    const batch = (data.events as WixEvent[] | undefined) ?? [];
    all.push(...batch);
    if (batch.length < 100) break;
    offset += 100;
  }
  return all;
}

export function toSummary(ev: WixEvent): WixEventSummary {
  const tix = ev.registration?.tickets;
  const summ = ev.summaries?.tickets ?? {};
  const rsvps = ev.summaries?.rsvps ?? {};
  const lowVal = tix?.lowestPrice?.value;
  const highVal = tix?.highestPrice?.value;
  // "Free" if registration type is RSVP, OR ticketing has no price/zero price
  const isFree =
    ev.registration?.type === 'RSVP' ||
    (lowVal === '0.00' && (highVal === undefined || highVal === '0.00')) ||
    (lowVal === '0' && (highVal === undefined || highVal === '0'));

  return {
    id: ev.id,
    title: ev.title || '(untitled)',
    status: ev.status,
    startDate: ev.dateAndTimeSettings?.startDate ?? null,
    startDateLabel:
      ev.dateAndTimeSettings?.formatted?.dateAndTime ||
      ev.dateAndTimeSettings?.dateAndTimeTbdMessage ||
      ev.dateAndTimeSettings?.startDate ||
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
