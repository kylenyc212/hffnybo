#!/usr/bin/env node
// Read-only Wix Events probe. Lists your events + ticket counts so we can
// see what data is available before building any integration. No writes.
//
// Usage:
//   WIX_API_KEY='...' WIX_ACCOUNT_ID='...' WIX_SITE_ID='...' \
//     node scripts/wix-probe.mjs

const API_KEY = process.env.WIX_API_KEY;
const ACCOUNT_ID = process.env.WIX_ACCOUNT_ID;
let SITE_ID = process.env.WIX_SITE_ID;

if (!API_KEY || !ACCOUNT_ID) {
  console.error('Missing one of: WIX_API_KEY, WIX_ACCOUNT_ID');
  console.error('Run like:');
  console.error("  WIX_API_KEY='...' WIX_ACCOUNT_ID='...' [WIX_SITE_ID='...'] \\");
  console.error('    node scripts/wix-probe.mjs');
  console.error('\nIf WIX_SITE_ID is omitted, the script will list sites under your account first.');
  process.exit(1);
}

const BASE = 'https://www.wixapis.com';

async function call(path, method = 'GET', body = null) {
  const headers = {
    'Authorization': API_KEY,
    'wix-account-id': ACCOUNT_ID,
    'Content-Type': 'application/json'
  };
  if (SITE_ID) headers['wix-site-id'] = SITE_ID;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

console.log('→ Probing Wix\n');

// If no Site ID supplied, list sites under the account first.
if (!SITE_ID) {
  console.log('=== 0) No WIX_SITE_ID supplied — listing sites under your account ===');
  // Wix Sites API: query under the account.
  const sitesRes = await call('/sites/v1/sites/query', 'POST', { query: { paging: { limit: 50 } } });
  console.log(`HTTP ${sitesRes.status}`);
  if (!sitesRes.ok) {
    console.log('Error response:');
    console.log(JSON.stringify(sitesRes.data, null, 2));
    console.log('\nTry the URL-bar method to find your Site ID and rerun with WIX_SITE_ID set.');
    process.exit(1);
  }
  const sites = sitesRes.data.sites || sitesRes.data.items || [];
  console.log(`Found ${sites.length} site(s) under this account:\n`);
  for (const s of sites) {
    const id = s.id || s.siteId || s.metaSiteId;
    const name = s.displayName || s.name || s.url || '(unnamed)';
    console.log(`  • ${name}`);
    console.log(`    site id: ${id}`);
  }
  if (sites.length === 1) {
    SITE_ID = sites[0].id || sites[0].siteId || sites[0].metaSiteId;
    console.log(`\nUsing the only site: ${SITE_ID}\n`);
  } else if (sites.length === 0) {
    console.log('\nNo sites returned. Check your API key permissions.');
    process.exit(1);
  } else {
    console.log('\nMultiple sites — pick the right one and rerun with:');
    console.log("  WIX_SITE_ID='...the right id...'");
    process.exit(0);
  }
}

// V3 events query with DASHBOARD fieldset — that's the only one that
// exposes sales data per event (per docs at
// dev.wix.com/docs/rest/business-solutions/events/events-v3/query-events).
console.log('=== 1) List events — V3 with DASHBOARD fieldset ===');
let listRes = await call('/events/v3/events/query', 'POST', {
  query: { paging: { limit: 100 } },
  fields: ['DETAILS', 'TEXTS', 'REGISTRATION', 'DASHBOARD', 'URLS']
});
// Fall back to V2 if V3 doesn't work for some reason.
if (!listRes.ok) {
  console.log(`  V3 failed (HTTP ${listRes.status}). Falling back to V2 query…`);
  listRes = await call('/events/v2/events/query', 'POST', {
    query: { paging: { limit: 100, offset: 0 } },
    fieldsets: ['FULL', 'DETAILS', 'TEXTS', 'REGISTRATION']
  });
}
console.log(`HTTP ${listRes.status}`);
if (!listRes.ok) {
  console.log('Error response:');
  console.log(JSON.stringify(listRes.data, null, 2));
  process.exit(1);
}

const events = listRes.data.events || listRes.data.items || listRes.data.data || [];
console.log(`Found ${events.length} events\n`);

if (events.length === 0) {
  console.log('No events returned. Either:');
  console.log('  - You have no events configured on this site');
  console.log('  - The API key/account/site combination lacks events permission');
  console.log('Raw response:');
  console.log(JSON.stringify(listRes.data, null, 2).slice(0, 2000));
  process.exit(0);
}

// Filter to 2026 festival events: created in 2026 OR title doesn't reference 2024/2025
function isFestival2026(ev) {
  const title = (ev.title || '').toUpperCase();
  if (title.includes('2024') || title.includes('2025')) return false;
  const created = ev.created || '';
  if (created.startsWith('2026')) return true;
  // Fall back: scheduleTbdMessage mentions May 2026
  const msg = (ev.scheduling?.config?.scheduleTbdMessage || ev.scheduling?.formatted || '').toLowerCase();
  if (msg.includes('2026')) return true;
  // No date hints + no 2024/2025 in title — include for now
  return !created || created.startsWith('2026');
}

const festivalEvents = events.filter(isFestival2026);
console.log(`=== Event summary (filtered to ~2026: ${festivalEvents.length} of ${events.length}) ===`);
for (const ev of festivalEvents) {
  const id = ev.id || ev._id;
  const title = ev.title || '(no title)';
  const when = ev.scheduling?.config?.scheduleTbdMessage
    || ev.scheduling?.formatted
    || ev.scheduling?.config?.startDate
    || ev.created
    || '?';
  const ticketing = ev.registration?.ticketing;
  const priceRange = ticketing
    ? `${ticketing.lowestPriceFormatted || ticketing.lowestPrice} - ${ticketing.highestPriceFormatted || ticketing.highestPrice}`
    : '(no ticketing)';
  const soldOut = ticketing?.soldOut ? ' SOLD OUT' : '';
  console.log(`  • ${title}`);
  console.log(`    id:     ${id}`);
  console.log(`    when:   ${when}`);
  console.log(`    price:  ${priceRange}${soldOut}`);
}

// Pick a real 2026 festival event to drill into.
// Prefer SOLD OUT (most likely to show real sold counts), then any with ticketing.
const target =
  festivalEvents.find((e) => e.registration?.ticketing?.soldOut) ||
  festivalEvents.find((e) => e.registration?.ticketing) ||
  events[0];
const targetId = target.id || target._id;
console.log(`\n=== 2) Drill into: ${target.title} ===`);
console.log(`  id: ${targetId}\n`);

// Confirmed endpoint per Wix V3 docs:
// POST /events-ticket-definitions/v3/ticket-definitions/query
// salesDetails (sold counts) requires fields: ['SALES_DETAILS'] in the body.
// Wix V3 requires the filter+paging wrapped in a `query` object.
const drillCalls = [
  {
    label: 'Ticket Definitions V3 (all known field flags)',
    path: '/events-ticket-definitions/v3/ticket-definitions/query',
    method: 'POST',
    body: {
      query: {
        filter: { eventId: targetId },
        paging: { limit: 100 }
      },
      fields: ['SALES_DETAILS', 'SEATING_DETAILS', 'PRICING_DETAILS', 'POLICIES']
    }
  }
];

const drillResponses = {};

// Orders V1 — confirmed by docs:
//   GET https://www.wixapis.com/events/v1/orders?eventId=<id>
//   Each Order has `ticketsQuantity` (int) + `tickets[]` array.
//   Sum ticketsQuantity across orders → total tickets sold for that event.
drillCalls.push({
  label: 'Orders V1 (GET, eventId filter)',
  path: `/events/v1/orders?eventId=${encodeURIComponent(targetId)}&limit=100`,
  method: 'GET'
});

for (const c of drillCalls) {
  const r = await call(c.path, c.method || 'GET', c.body || null);
  drillResponses[c.label] = r.data;
  console.log(`[${c.label}]`);
  console.log(`  ${c.method || 'GET'} ${c.path}`);
  console.log(`  HTTP ${r.status}`);
  if (r.ok) {
    const sample = JSON.stringify(r.data, null, 2).slice(0, 2500);
    console.log(`  Body (first 2500):`);
    console.log(sample.split('\n').map((l) => `    ${l}`).join('\n'));

    // Pull every distinct salesDetails shape we see
    const defs = r.data.ticketDefinitions || [];
    const salesShapes = new Set();
    for (const d of defs) {
      if (d.salesDetails) salesShapes.add(JSON.stringify(d.salesDetails));
    }
    if (defs.length) {
      console.log(`\n  Distinct salesDetails shapes seen across ${defs.length} ticket types:`);
      for (const s of salesShapes) console.log(`    ${s}`);
    }
    // For Orders V1: roll up ticketsQuantity to a sold count
    const orders = r.data.orders || [];
    if (orders.length || c.label.startsWith('Orders V1')) {
      const totalTickets = orders.reduce((sum, o) => sum + (o.ticketsQuantity || 0), 0);
      console.log(`\n  → Orders returned: ${orders.length}`);
      console.log(`  → Total ticketsQuantity summed: ${totalTickets}`);
      // Show a sample order's keys so we know what's available
      if (orders[0]) {
        console.log(`  → First order keys: ${Object.keys(orders[0]).join(', ')}`);
      }
    }
  } else {
    const errStr = typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
    console.log(`  Error: ${errStr.slice(0, 200)}`);
  }
  console.log();
}


// THE REAL TEST: per-screening online ticket counts for all 2026 events.
// This is exactly what would feed screenings.online_sold in the box office DB.
console.log('=== 3) Online tickets sold per festival screening ===');
console.log('   (calling /events/v1/orders?eventId=... for each event)\n');

const ONLY_PAID_STATUSES = new Set(['PAID', 'INITIATED', 'PENDING', 'OFFLINE_PENDING', 'FREE']);
// Wix order statuses we consider "real" online sales. Treat archived/refunded
// separately; ticketsQuantity is set on confirmed orders.

// Run a few in parallel so we don't take forever.
async function ordersForEvent(ev) {
  const id = ev.id || ev._id;
  let allOrders = [];
  let offset = 0;
  while (true) {
    const r = await call(`/events/v1/orders?eventId=${encodeURIComponent(id)}&limit=100&offset=${offset}`, 'GET');
    if (!r.ok) return { ev, error: r.status, orders: [] };
    const batch = r.data.orders || [];
    allOrders = allOrders.concat(batch);
    if (batch.length < 100) break;
    offset += 100;
    if (offset > 1000) break; // safety
  }
  return { ev, orders: allOrders };
}

const results = [];
for (const ev of festivalEvents) {
  results.push(await ordersForEvent(ev));
}

// First, see what statuses ACTUALLY exist + raw ticketsQuantity totals,
// no filter at all.
console.log(' raw_tix · orders · statuses · channels  event');
console.log(' ─────── · ────── · ──────── · ────────  ─────');
let grandTotalRaw = 0;
for (const { ev, orders, error } of results) {
  const title = ev.title || '(no title)';
  if (error) {
    console.log(`  ERR HTTP ${error}                     ${title}`);
    continue;
  }
  const rawTix = orders.reduce((s, o) => s + (o.ticketsQuantity || 0), 0);
  grandTotalRaw += rawTix;
  const statuses = [...new Set(orders.map((o) => o.status))].join(',') || '-';
  const channels = [...new Set(orders.map((o) => o.channel))].join(',') || '-';
  if (orders.length === 0) continue; // skip noise rows
  console.log(`  ${String(rawTix).padStart(7)} · ${String(orders.length).padStart(6)} · ${statuses.padEnd(8)} · ${channels.padEnd(8)}  ${title}`);
}
console.log(`\n  GRAND TOTAL ticketsQuantity across all orders: ${grandTotalRaw}`);

// Now dump one real order from the busiest event so we can see its actual shape
const busiest = [...results].sort((a, b) => (b.orders?.length || 0) - (a.orders?.length || 0))[0];
if (busiest && busiest.orders.length) {
  console.log(`\n--- Sample real order from: ${busiest.ev.title} ---`);
  // Take the first order with ticketsQuantity > 0 if any, else just the first
  const sample = busiest.orders.find((o) => o.ticketsQuantity > 0) || busiest.orders[0];
  console.log(JSON.stringify(sample, null, 2).slice(0, 2500));

  // Count how many orders have ticketsQuantity > 0 vs 0
  const withTix = busiest.orders.filter((o) => (o.ticketsQuantity || 0) > 0).length;
  const archivedCount = busiest.orders.filter((o) => o.archived).length;
  console.log(`\nOf ${busiest.orders.length} orders for "${busiest.ev.title}":`);
  console.log(`  - with ticketsQuantity > 0: ${withTix}`);
  console.log(`  - archived = true:          ${archivedCount}`);
  console.log(`  - statuses present:         ${[...new Set(busiest.orders.map((o) => o.status))].join(', ')}`);
}

// Save the per-event order data for reference
drillResponses['Orders V1 (per festival event)'] = results.map((r) => ({
  eventId: r.ev.id,
  title: r.ev.title,
  orderCount: r.orders.length,
  ticketsTotal: r.orders.reduce((s, o) => s + (o.ticketsQuantity || 0), 0),
  statuses: [...new Set(r.orders.map((o) => o.status))],
  channels: [...new Set(r.orders.map((o) => o.channel))]
}));
console.log();

// Save raw event list for inspection
const fs = await import('node:fs/promises');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = `scripts/wix-probe-output-${stamp}`;
await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(`${outDir}/events.json`, JSON.stringify(listRes.data, null, 2));
await fs.writeFile(`${outDir}/drill-responses.json`, JSON.stringify(drillResponses, null, 2));
console.log(`\nRaw responses saved to: ${outDir}/`);
console.log(`  - events.json`);
console.log(`  - drill-responses.json`);
