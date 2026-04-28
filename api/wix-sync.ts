// POST /api/wix-sync   (intended for cron, not currently scheduled on Hobby plan)
// Pulls UPCOMING events from Wix, then for every screening with a non-null
// wix_event_id it updates `screenings.online_sold` to match
// `event.summaries.tickets.ticketsSold` (or rsvps.totalCount for RSVP events).
//
// Auth: Authorization: Bearer ${CRON_SECRET}
// Self-contained — no shared imports.

import { createClient } from '@supabase/supabase-js';

interface VReq {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
}
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
    throw new Error('Missing WIX_API_KEY / WIX_ACCOUNT_ID / WIX_SITE_ID in env');
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
  registration?: { type?: string };
  summaries?: {
    rsvps?: { totalCount?: number };
    tickets?: { ticketsSold?: number };
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
      fields: ['REGISTRATION']
    });
    const batch = (data.events as WixEvent[] | undefined) ?? [];
    all.push(...batch);
    if (batch.length < 100) break;
    offset += 100;
  }
  return all;
}

export default async function handler(req: VReq, res: VRes) {
  try {
    if (req.method && req.method !== 'POST' && req.method !== 'GET') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    // Auth — Vercel cron auto-attaches Bearer ${CRON_SECRET} when set.
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      res.status(500).json({ error: 'CRON_SECRET not configured on server' });
      return;
    }
    const authHeader = req.headers['authorization'];
    const auth = Array.isArray(authHeader) ? authHeader[0] : (authHeader || '');
    if (auth !== `Bearer ${cronSecret}`) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Supabase admin client
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const serviceKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
    if (!url || !serviceKey) {
      res.status(500).json({ error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing' });
      return;
    }
    const sb = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    // 1) pull from Wix
    const events = await listUpcomingWixEvents();
    const byId = new Map(events.map((e) => [e.id, e]));

    // 2) load mapped screenings
    const { data: mapped, error: loadErr } = await sb
      .from('screenings')
      .select('id, title, wix_event_id, online_sold')
      .not('wix_event_id', 'is', null);
    if (loadErr) throw new Error(`Load screenings: ${loadErr.message}`);

    // 3) update each
    const now = new Date().toISOString();
    let updated = 0;
    const skipped: { id: string; title: string; reason: string }[] = [];
    const changes: { title: string; before: number; after: number }[] = [];

    for (const row of mapped ?? []) {
      const wixEv = byId.get(row.wix_event_id as string);
      if (!wixEv) {
        skipped.push({
          id: row.id as string,
          title: row.title as string,
          reason: 'wix event not in UPCOMING/STARTED'
        });
        continue;
      }
      const isRsvp = wixEv.registration?.type === 'RSVP';
      const newSold = isRsvp
        ? (wixEv.summaries?.rsvps?.totalCount ?? 0)
        : (wixEv.summaries?.tickets?.ticketsSold ?? 0);
      const before = row.online_sold as number;
      const { error } = await sb
        .from('screenings')
        .update({ online_sold: newSold, wix_synced_at: now })
        .eq('id', row.id as string);
      if (error) throw new Error(`Update ${row.id}: ${error.message}`);
      updated += 1;
      if (before !== newSold) {
        changes.push({ title: row.title as string, before, after: newSold });
      }
    }

    res.status(200).json({
      ok: true,
      syncedAt: now,
      wixEventsFetched: events.length,
      mappedScreenings: (mapped ?? []).length,
      updated,
      changes,
      skipped
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Sync failed';
    console.error('[/api/wix-sync]', msg, e);
    res.status(500).json({ error: msg });
  }
}
