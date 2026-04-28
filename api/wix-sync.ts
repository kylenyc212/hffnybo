// POST /api/wix-sync   (called by Vercel cron only)
// Pulls UPCOMING events from Wix, then for every screening with a non-null
// wix_event_id it updates `screenings.online_sold` to match
// `event.summaries.tickets.ticketsSold` (or rsvps.totalCount for RSVP events).
//
// Auth: requires Authorization: Bearer ${CRON_SECRET}.
// Vercel cron auto-sends this when CRON_SECRET is set in project env vars.
// The admin UI does NOT call this — it calls /api/wix-events and writes
// to Supabase directly (RLS is permissive for the anon role).

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { listUpcomingWixEvents, toSummary } from './_wix';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // ---------- auth ----------
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    res.status(500).json({ error: 'CRON_SECRET not configured on server' });
    return;
  }
  const auth = (req.headers['authorization'] || '') as string;
  if (auth !== `Bearer ${cronSecret}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  // ---------- supabase admin client ----------
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !serviceKey) {
    res.status(500).json({
      error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in Vercel env'
    });
    return;
  }
  const sb = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  try {
    // ---------- 1) pull from Wix ----------
    const events = await listUpcomingWixEvents();
    const summaries = events.map(toSummary);
    const byId = new Map(summaries.map((s) => [s.id, s]));

    // ---------- 2) load mapped screenings ----------
    const { data: mapped, error: loadErr } = await sb
      .from('screenings')
      .select('id, title, wix_event_id, online_sold')
      .not('wix_event_id', 'is', null);
    if (loadErr) throw new Error(`Load screenings: ${loadErr.message}`);

    // ---------- 3) update each ----------
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
      const newSold = wixEv.registrationType === 'RSVP' ? wixEv.rsvpCount : wixEv.ticketsSold;
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
      wixEventsFetched: summaries.length,
      mappedScreenings: (mapped ?? []).length,
      updated,
      changes,
      skipped
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Sync failed';
    res.status(500).json({ error: msg });
  }
}
