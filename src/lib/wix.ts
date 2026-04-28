import { supabase } from './supabase';
import type { ScreeningRow } from './database.types';

/** Slim shape returned by /api/wix-events (mirrors api/_wix.ts WixEventSummary). */
export interface WixEventSummary {
  id: string;
  title: string;
  status: string;
  startDate: string | null;
  startDateLabel: string | null;
  registrationType: string | null;
  isFree: boolean;
  lowestPrice: string | null;
  highestPrice: string | null;
  soldOut: boolean;
  ticketsSold: number;
  totalOrders: number;
  rsvpCount: number;
}

/** Fetch live UPCOMING events from Wix (via our serverless proxy). */
export async function fetchWixEvents(): Promise<{
  events: WixEventSummary[];
  fetchedAt: string;
}> {
  const res = await fetch('/api/wix-events');
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Wix list failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return res.json();
}

/** Map a Wix event ID onto a screening (or clear it). */
export async function setScreeningWixMapping(
  screeningId: string,
  wixEventId: string | null
): Promise<void> {
  const { error } = await supabase
    .from('screenings')
    .update({ wix_event_id: wixEventId })
    .eq('id', screeningId);
  if (error) throw new Error(error.message);
}

/**
 * Push current Wix sold counts into screenings.online_sold for every screening
 * with a wix_event_id mapping. Called by the "Sync now" button. The Vercel
 * cron does the same thing every 5 minutes server-side.
 *
 * Returns the list of changes for display.
 */
export async function syncWixSoldNow(events: WixEventSummary[]): Promise<{
  updated: number;
  changes: { title: string; before: number; after: number }[];
}> {
  const byId = new Map(events.map((e) => [e.id, e]));

  const { data: mapped, error } = await supabase
    .from('screenings')
    .select('id, title, wix_event_id, online_sold')
    .not('wix_event_id', 'is', null);
  if (error) throw new Error(error.message);

  const now = new Date().toISOString();
  const changes: { title: string; before: number; after: number }[] = [];
  let updated = 0;

  for (const row of mapped ?? []) {
    const wix = byId.get(row.wix_event_id!);
    if (!wix) continue;
    const newSold = wix.registrationType === 'RSVP' ? wix.rsvpCount : wix.ticketsSold;
    const before = row.online_sold ?? 0;
    const { error: upErr } = await supabase
      .from('screenings')
      .update({ online_sold: newSold, wix_synced_at: now })
      .eq('id', row.id);
    if (upErr) throw new Error(`Update ${row.title}: ${upErr.message}`);
    updated += 1;
    if (before !== newSold) {
      changes.push({ title: row.title, before, after: newSold });
    }
  }
  return { updated, changes };
}

/** Pretty timestamp helper for "X minutes ago" display. */
export function timeAgo(iso: string | null): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'just now';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

/** All screenings, ordered, for the mapping dropdown. */
export async function listScreeningsForMapping(): Promise<ScreeningRow[]> {
  const { data, error } = await supabase
    .from('screenings')
    .select('*')
    .order('starts_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as ScreeningRow[];
}
