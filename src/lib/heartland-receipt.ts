// Heartland receipt parsing + matching to BO ticket types.

import { supabase } from './supabase';
import type { CartLine } from './cart';
import type { TicketCategory } from './database.types';

// ── Parsed receipt shape ────────────────────────────────────────────────────

export interface HeartlandLineItem {
  rawName: string;
  qty: number;
  unitPriceCents: number;
}

export interface ParsedHeartlandReceipt {
  receiptNumber: string;
  invoiceNumber: string;
  items: HeartlandLineItem[];
  totalCents: number;
  cardBrand: string;
  cardLast4: string;
}

// ── Parser ──────────────────────────────────────────────────────────────────

export function parseHeartlandReceipt(text: string): ParsedHeartlandReceipt {
  const receiptNumber = text.match(/Receipt\s+Number\s+(\S+)/i)?.[1] ?? '';
  const invoiceNumber = text.match(/Invoice\s+Number\s+(\S+)/i)?.[1] ?? '';
  const cardBrand     = text.match(/Card\s+Brand\s+(.+)/i)?.[1]?.trim() ?? '';
  const cardLast4     = text.match(/Card\s+ending\s+in\s+(\d+)/i)?.[1] ?? '';

  // Items: "ITEM NAME (x1)  $12.00"
  const items: HeartlandLineItem[] = [];
  const itemRe = /^(.+?)\s+\(x(\d+)\)\s+\$(\d+\.\d{2})/gm;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(text)) !== null) {
    items.push({
      rawName: m[1].trim(),
      qty: parseInt(m[2], 10),
      unitPriceCents: Math.round(parseFloat(m[3]) * 100),
    });
  }

  // Use the last "Total" line (avoids matching "Subtotal")
  const totalMatches = [...text.matchAll(/^Total\s+\$(\d+\.\d{2})/gim)];
  const totalCents = totalMatches.length
    ? Math.round(parseFloat(totalMatches[totalMatches.length - 1][1]) * 100)
    : items.reduce((s, i) => s + i.qty * i.unitPriceCents, 0);

  return { receiptNumber, invoiceNumber, items, totalCents, cardBrand, cardLast4 };
}

// ── Ticket type + screening loader ─────────────────────────────────────────

interface TTypeRow {
  id: string;
  screening_id: string;
  label: string;
  price_cents: number;
  category: TicketCategory;
  heartland_sku: string | null;
}
interface SRow {
  id: string;
  title: string;
  starts_at: string;
}

let _cache: { ticketTypes: TTypeRow[]; screenings: SRow[] } | null = null;

async function loadCatalog() {
  if (_cache) return _cache;
  const [{ data: tt }, { data: sc }] = await Promise.all([
    supabase.from('ticket_types').select('id, screening_id, label, price_cents, category, heartland_sku').eq('active', true),
    supabase.from('screenings').select('id, title, starts_at'),
  ]);
  _cache = { ticketTypes: (tt ?? []) as TTypeRow[], screenings: (sc ?? []) as SRow[] };
  // Bust cache after 5 min
  setTimeout(() => { _cache = null; }, 5 * 60 * 1000);
  return _cache;
}

// ── Matcher ─────────────────────────────────────────────────────────────────

export interface MatchedItem {
  raw: HeartlandLineItem;
  screeningId: string | null;
  screeningTitle: string;
  screeningStartsAt: string;
  ticketTypeId: string | null;
  label: string;
  category: TicketCategory;
  matched: boolean; // true = found in our system
}

export async function matchReceiptItems(items: HeartlandLineItem[]): Promise<MatchedItem[]> {
  const { ticketTypes, screenings } = await loadCatalog();
  const screeningMap = new Map(screenings.map((s) => [s.id, s]));

  return items.map((item): MatchedItem => {
    // 1. Try exact heartland_sku match
    const bySkuExact = ticketTypes.find(
      (t) => t.heartland_sku?.toLowerCase() === item.rawName.toLowerCase()
    );
    if (bySkuExact) {
      const sc = screeningMap.get(bySkuExact.screening_id);
      return {
        raw: item,
        screeningId: bySkuExact.screening_id,
        screeningTitle: sc?.title ?? bySkuExact.heartland_sku ?? item.rawName,
        screeningStartsAt: sc?.starts_at ?? '',
        ticketTypeId: bySkuExact.id,
        label: bySkuExact.label,
        category: bySkuExact.category,
        matched: true,
      };
    }

    // 2. Parse Heartland name format: "WORD DATE TIME SUFFIX"
    //    e.g. "CIRCE 5/2 1PM SS" → code=CIRCE, date=5/2, time=1PM, suffix=SS
    const parts = item.rawName.split(/\s+/);
    const code     = parts[0] ?? '';           // e.g. "CIRCE"
    const datePart = parts[1] ?? '';           // e.g. "5/2"
    const suffix   = parts.slice(3).join(' '); // e.g. "SS" or "GA" (parts[2] = time, skip)

    // Find screenings whose title contains the code word and
    // whose starts_at matches the date portion
    const [mon, day] = datePart.split('/').map(Number);
    const matchingScreenings = screenings.filter((sc) => {
      if (!code || !sc.title.toUpperCase().includes(code.toUpperCase())) return false;
      if (!mon || !day) return true;
      const d = new Date(sc.starts_at);
      // month is 1-indexed in the receipt, 0-indexed in JS
      return d.getMonth() + 1 === mon && d.getDate() === day;
    });

    // Among matching screenings, find ticket type whose label or sku
    // includes the suffix (GA=General, SS=Student/Senior, etc.)
    const suffixMap: Record<string, string[]> = {
      GA: ['general', 'adult', 'ga'],
      SS: ['student', 'senior', 'ss'],
      CH: ['child', 'children', 'kid'],
      MEM: ['member'],
    };
    const suffixTerms = suffixMap[suffix.toUpperCase()] ?? [suffix.toLowerCase()];

    for (const sc of matchingScreenings) {
      const candidateTypes = ticketTypes.filter((t) => t.screening_id === sc.id);

      // Try to find a ticket type matching the suffix
      const byLabel = candidateTypes.find((t) =>
        suffixTerms.some((term) => t.label.toLowerCase().includes(term))
      );
      // Fall back to matching by price alone
      const byPrice = candidateTypes.find((t) => t.price_cents === item.unitPriceCents);
      const matched = byLabel ?? byPrice ?? candidateTypes[0];

      if (matched) {
        return {
          raw: item,
          screeningId: sc.id,
          screeningTitle: sc.title,
          screeningStartsAt: sc.starts_at,
          ticketTypeId: matched.id,
          label: matched.label,
          category: matched.category,
          matched: true,
        };
      }
    }

    // 3. No match — record as "other" with raw name
    // Use first screening as a best-guess anchor, or null
    const fallback = matchingScreenings[0];
    return {
      raw: item,
      screeningId: fallback?.id ?? null,
      screeningTitle: fallback?.title ?? item.rawName,
      screeningStartsAt: fallback?.starts_at ?? '',
      ticketTypeId: null,
      label: item.rawName,
      category: 'paid',
      matched: false,
    };
  });
}

// ── Convert to CartLines ────────────────────────────────────────────────────

export function matchedItemsToCartLines(matched: MatchedItem[]): Omit<CartLine, 'key'>[] {
  return matched
    .filter((m) => m.screeningId !== null)
    .map((m) => ({
      screeningId: m.screeningId!,
      screeningTitle: m.screeningTitle,
      screeningStartsAt: m.screeningStartsAt,
      ticketTypeId: m.ticketTypeId,
      label: m.label,
      qty: m.raw.qty,
      unitPriceCents: m.raw.unitPriceCents,
      category: m.category,
      compCategory: null,
      passholderId: null,
      patronName: null,
    }));
}
