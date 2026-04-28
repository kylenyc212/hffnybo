// GET /api/wix-events
// Returns all UPCOMING (and STARTED) Wix events in a slim shape suitable
// for the admin mapping UI. Read-only; no DB writes.
//
// No auth: data is essentially public (visible on the merchant's Wix store).
// We never expose the API key to the browser; the function uses server-side
// env vars.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { listUpcomingWixEvents, toSummary } from './_wix';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const events = await listUpcomingWixEvents();
    const summaries = events.map(toSummary);
    // Sort: real start dates first (chronological), then TBD by title.
    summaries.sort((a, b) => {
      if (a.startDate && b.startDate) return a.startDate.localeCompare(b.startDate);
      if (a.startDate) return -1;
      if (b.startDate) return 1;
      return a.title.localeCompare(b.title);
    });
    res.status(200).json({
      events: summaries,
      fetchedAt: new Date().toISOString(),
      count: summaries.length
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Wix list failed';
    res.status(500).json({ error: msg });
  }
}
