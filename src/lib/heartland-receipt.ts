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
//
// Heartland receipts are printed in two columns. OCR (Tesseract) reads the
// columns separately, producing text like:
//
//   CIRCE 5/2 1PM SS (x1)   ← left col: item name
//   CIRCE 5/2 1PM GA (x1)   ← left col: item name
//   5/1/26, 12:49 PM         ← right col: date
//   1005959380               ← right col: receipt number
//   560640                   ← right col: invoice number
//   $12.00                   ← right col: price for item 1
//   $16.00                   ← right col: price for item 2
//   Totals
//   ...
//   $28.00                   ← grand total
//   American Express
//   Card ending in 1008
//
// Strategy 1 handles single-column / same-line format (fallback for future).
// Strategy 2 handles the two-column layout described above.

export function parseHeartlandReceipt(text: string): ParsedHeartlandReceipt {
  // ── Card info ─────────────────────────────────────────────────────────────
  let cardBrand = text.match(/Card\s+Brand\s+(.+)/i)?.[1]?.trim() ?? '';
  if (!cardBrand) {
    const brandMatch = text.match(
      /\b(American Express|Mastercard|Visa|Discover|Amex|JCB|Diners Club)\b/i
    );
    cardBrand = brandMatch?.[1]?.trim() ?? '';
  }
  // "Card ending in 1234" (old format) OR "Card Number  ****1234" (new format)
  const cardLast4 =
    text.match(/Card\s+ending\s+in\s+(\d+)/i)?.[1] ??
    text.match(/Card\s+Number\s+[*\s]*(\d{4})\b/i)?.[1] ??
    '';

  // ── Items ─────────────────────────────────────────────────────────────────
  const items: HeartlandLineItem[] = [];

  // Strategy 1: same-line format  "ITEM NAME (x1)  $12.00"
  const sameLine = /^(.+?)\s+\(x(\d+)\)\s+\$(\d+\.\d{2})/gm;
  let m: RegExpExecArray | null;
  while ((m = sameLine.exec(text)) !== null) {
    items.push({
      rawName: m[1].trim(),
      qty: parseInt(m[2], 10),
      unitPriceCents: Math.round(parseFloat(m[3]) * 100),
    });
  }

  // Strategy 3: "1 x ITEM NAME @ $12.00" inline format (new Heartland layout)
  if (items.length === 0) {
    const inlineRe = /^(\d+)\s+x\s+(.+?)\s+@\s+\$(\d+\.\d{2})/gm;
    while ((m = inlineRe.exec(text)) !== null) {
      items.push({
        rawName: m[2].trim(),
        qty: parseInt(m[1], 10),
        unitPriceCents: Math.round(parseFloat(m[3]) * 100),
      });
    }
  }

  // Strategy 2: two-column layout — names and prices on separate lines
  if (items.length === 0) {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

    // Collect all "ITEM NAME (xN)" lines.
    // Allow trailing junk (e.g. "|" from OCR column bleed) after the (xN).
    const nameRe = /^(.+?)\s+\(x(\d+)\)\s*[^a-z\d]*$/i;
    const itemLines: { idx: number; name: string; qty: number }[] = [];
    for (let i = 0; i < lines.length; i++) {
      const lm = nameRe.exec(lines[i]);
      if (lm) itemLines.push({ idx: i, name: lm[1].trim(), qty: parseInt(lm[2], 10) });
    }

    if (itemLines.length > 0) {
      const lastItemIdx = itemLines[itemLines.length - 1].idx;

      // Find the "Totals" / "Subtotal" boundary after the last item line
      const boundaryIdx = lines.findIndex(
        (l, i) => i > lastItemIdx && /^(totals?|subtotal)\b/i.test(l)
      );
      const searchEnd = boundaryIdx !== -1 ? boundaryIdx : lines.length;

      // Collect bare "$XX.XX" price lines between last item and the boundary.
      // When OCR reads left column then right column entirely, prices land
      // AFTER "Totals" rather than before it — fall back to a full scan in
      // that case, taking only the first N prices (N = number of items).
      const priceRe = /^\$(\d+\.\d{2})$/;
      const prices: number[] = [];
      for (let i = lastItemIdx + 1; i < searchEnd; i++) {
        const pm = priceRe.exec(lines[i]);
        if (pm) prices.push(Math.round(parseFloat(pm[1]) * 100));
      }

      if (prices.length < itemLines.length) {
        // Prices weren't in the primary window — scan everything after the
        // last item line and collect the first itemLines.length prices found.
        const fallback: number[] = [];
        for (
          let i = lastItemIdx + 1;
          i < lines.length && fallback.length < itemLines.length;
          i++
        ) {
          const pm = priceRe.exec(lines[i]);
          if (pm) fallback.push(Math.round(parseFloat(pm[1]) * 100));
        }
        if (fallback.length > prices.length) {
          prices.splice(0, prices.length, ...fallback);
        }
      }

      // Match names → prices positionally (item 1 gets first price, etc.)
      for (let i = 0; i < itemLines.length; i++) {
        const il = itemLines[i];
        const lineTotalCents = prices[i] ?? 0;
        const unitPriceCents = il.qty > 1 ? Math.round(lineTotalCents / il.qty) : lineTotalCents;
        items.push({ rawName: il.name, qty: il.qty, unitPriceCents });
      }
    }
  }

  // ── Receipt / Invoice numbers ─────────────────────────────────────────────
  // Try labeled format first; fall back to bare digit strings (two-column layout)
  let receiptNumber = text.match(/Receipt\s+Number\s+(\S+)/i)?.[1] ?? '';
  let invoiceNumber = text.match(/Invoice\s+Number\s+(\S+)/i)?.[1] ?? '';

  if (!receiptNumber) {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    // Bare standalone digit strings ≥ 5 digits (not a price line)
    const bareNums = lines.filter((l) => /^\d{5,}$/.test(l));
    if (bareNums.length >= 1) receiptNumber = bareNums[0];
    if (bareNums.length >= 2 && !invoiceNumber) invoiceNumber = bareNums[1];
  }

  // ── Total ─────────────────────────────────────────────────────────────────
  // Handles "Total  $36.00" and "Total  USD $36.00"
  const totalMatches = [...text.matchAll(/^Total\s+(?:USD\s+)?\$(\d+\.\d{2})/gim)];
  const totalCents = totalMatches.length
    ? Math.round(parseFloat(totalMatches[totalMatches.length - 1][1]) * 100)
    : items.reduce((s, i) => s + i.qty * i.unitPriceCents, 0);

  return { receiptNumber, invoiceNumber, items, totalCents, cardBrand, cardLast4 };
}

// ── Ticket type + screening loader ─────────────────────────────────────────

export interface TTypeRow {
  id: string;
  screening_id: string;
  label: string;
  price_cents: number;
  category: TicketCategory;
  heartland_sku: string | null;
}
export interface SRow {
  id: string;
  title: string;
  starts_at: string;
}

let _cache: { ticketTypes: TTypeRow[]; screenings: SRow[] } | null = null;

export function bustMatchCatalogCache() { _cache = null; }

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

    // 2. Parse Heartland name format: "FILM TITLE M/D TIME SUFFIX"
    //    Works for single-word titles ("CIRCE 5/2 1PM SS") and
    //    multi-word titles ("AUN ES DE NOCHE EN CARACAS 5/1 6PM SS").
    //    Scan for the M/D date token; everything before it is the title
    //    (we use the first word as the code for title matching), and
    //    everything two tokens after it is the type suffix (SS / GA / …).
    const parts = item.rawName.split(/\s+/);
    const dateIdx = parts.findIndex((p) => /^\d{1,2}\/\d{1,2}$/.test(p));
    const code     = parts[0] ?? '';
    const datePart = dateIdx >= 0 ? parts[dateIdx] : (parts[1] ?? '');
    // suffix is the word(s) after the time token (dateIdx+1); fall back to parts[3+]
    const suffix   = dateIdx >= 0 ? parts.slice(dateIdx + 2).join(' ') : parts.slice(3).join(' ');

    // Find screenings whose title contains the code word and
    // whose starts_at matches the date portion.
    // Strip diacritics so "AUN" matches "AÚN", "BELEN" matches "BELÉN", etc.
    // ̀-ͯ = Unicode combining diacritical marks
    const strip = (s: string) =>
      s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
    const [mon, day] = datePart.split('/').map(Number);
    const matchingScreenings = screenings.filter((sc) => {
      if (!code || !strip(sc.title).includes(strip(code))) return false;
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

/** Expose catalog so the receipt modal can power manual-match dropdowns */
export async function loadMatchCatalog(): Promise<{ ticketTypes: TTypeRow[]; screenings: SRow[] }> {
  return loadCatalog();
}

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
