import { supabase } from './supabase';
import type { ScreeningRow } from './database.types';

/** Slim shape returned by /api/wix-events. */
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

/**
 * Add or remove a Wix event ID from a screening's mapping array.
 * Use addWixEventToScreening / removeWixEventFromScreening for clarity.
 */
async function patchWixEventIds(screeningId: string, ids: string[]) {
  const { error } = await supabase
    .from('screenings')
    .update({ wix_event_ids: ids })
    .eq('id', screeningId);
  if (error) throw new Error(error.message);
}

/** Add `wixEventId` to the screening's wix_event_ids array (idempotent). */
export async function addWixEventToScreening(screeningId: string, wixEventId: string) {
  const { data, error } = await supabase
    .from('screenings')
    .select('wix_event_ids')
    .eq('id', screeningId)
    .single();
  if (error) throw new Error(error.message);
  const current = (data?.wix_event_ids ?? []) as string[];
  if (current.includes(wixEventId)) return;
  await patchWixEventIds(screeningId, [...current, wixEventId]);
}

/** Remove `wixEventId` from a screening's wix_event_ids array. */
export async function removeWixEventFromScreening(screeningId: string, wixEventId: string) {
  const { data, error } = await supabase
    .from('screenings')
    .select('wix_event_ids')
    .eq('id', screeningId)
    .single();
  if (error) throw new Error(error.message);
  const current = (data?.wix_event_ids ?? []) as string[];
  const next = current.filter((id) => id !== wixEventId);
  if (next.length === current.length) return;
  await patchWixEventIds(screeningId, next);
}

/**
 * Move a Wix event mapping: remove from `fromScreeningId` (if any) and add to `toScreeningId`.
 * Pass `toScreeningId = null` to just unmap.
 */
export async function moveWixEventMapping(
  wixEventId: string,
  fromScreeningId: string | null,
  toScreeningId: string | null
) {
  if (fromScreeningId && fromScreeningId !== toScreeningId) {
    await removeWixEventFromScreening(fromScreeningId, wixEventId);
  }
  if (toScreeningId) {
    await addWixEventToScreening(toScreeningId, wixEventId);
  }
}

/**
 * Push current Wix sold counts into screenings.online_sold for every screening
 * with at least one wix_event_id mapped. For double features (multiple Wix
 * events mapped to one BO screening), the sold counts are SUMMED.
 *
 * Returns the list of changes for display.
 */
export async function syncWixSoldNow(events: WixEventSummary[]): Promise<{
  updated: number;
  changes: { title: string; before: number; after: number }[];
}> {
  const byId = new Map(events.map((e) => [e.id, e]));

  // Pull every screening that has at least one Wix event mapped.
  const { data: mapped, error } = await supabase
    .from('screenings')
    .select('id, title, wix_event_ids, online_sold');
  if (error) throw new Error(error.message);

  const now = new Date().toISOString();
  const changes: { title: string; before: number; after: number }[] = [];
  let updated = 0;

  for (const row of mapped ?? []) {
    const ids = (row.wix_event_ids ?? []) as string[];
    if (ids.length === 0) continue;

    let newSold = 0;
    let foundAny = false;
    for (const id of ids) {
      const wix = byId.get(id);
      if (!wix) continue;
      foundAny = true;
      newSold += wix.registrationType === 'RSVP' ? wix.rsvpCount : wix.ticketsSold;
    }
    if (!foundAny) continue;

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
