#!/usr/bin/env node
// Broad read-only probe of Portico sandbox. Hits every endpoint that might
// plausibly surface line-item data or settings that relate to Heartland Mobile
// Pay's item catalog. Pure observation — no writes.
//
// Usage:
//   PORTICO_SECRET_KEY='skapi_cert_...' node scripts/portico-broad-probe.mjs

const SECRET_KEY = process.env.PORTICO_SECRET_KEY;
const ENV = (process.env.PORTICO_ENV || 'sandbox').toLowerCase();
if (!SECRET_KEY) {
  console.error('Missing PORTICO_SECRET_KEY env var.');
  process.exit(1);
}
const ENDPOINT = ENV === 'production'
  ? 'https://api2.heartlandportico.com/Hps.Exchange.PosGateway/PosGatewayService.asmx'
  : 'https://cert.api2.heartlandportico.com/Hps.Exchange.PosGateway/PosGatewayService.asmx';

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function extract(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return m ? m[1].trim() : null;
}
function extractAll(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'g');
  return [...xml.matchAll(re)].map((m) => m[1].trim());
}

async function call(inner, label) {
  const env = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <PosRequest xmlns="http://Hps.Exchange.PosGateway">
      <Ver1.0>
        <Header><SecretAPIKey>${esc(SECRET_KEY)}</SecretAPIKey></Header>
        <Transaction>${inner}</Transaction>
      </Ver1.0>
    </PosRequest>
  </soap:Body>
</soap:Envelope>`;
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': 'http://Hps.Exchange.PosGateway/DoTransaction' },
    body: env
  });
  const text = await res.text();
  const code = extract(text, 'GatewayRspCode');
  const msg = extract(text, 'GatewayRspMsg');
  const bodyInside = extract(text, label) || '';
  const significantChildren = bodyInside.trim() && bodyInside.trim() !== ''
    ? bodyInside.replace(/\s+/g, ' ').slice(0, 300)
    : '(empty)';
  console.log(`\n[${label}] HTTP ${res.status} · GatewayRspCode=${code} (${msg})`);
  console.log(`  Body preview: ${significantChildren}`);
  return { text, code, msg };
}

const now = new Date();
const start = new Date(Date.now() - 90 * 24 * 3600 * 1000);
const fmt = (d) => d.toISOString().split('.')[0];
const dateRange = `<StartUtcDT>${fmt(start)}</StartUtcDT><EndUtcDT>${fmt(now)}</EndUtcDT>`;

console.log(`→ ${ENV} · ${ENDPOINT}\n`);

// Every endpoint that might carry item-level data for a POS-style merchant
await call('<TestCredentials/>', 'TestCredentials');
await call(`<FindTransactions><Criteria>${dateRange}</Criteria></FindTransactions>`, 'FindTransactions');
await call(`<ReportBatchHistory><OnlyOpen>N</OnlyOpen>${dateRange.replace(/UtcDT/g, 'Utc')}</ReportBatchHistory>`, 'ReportBatchHistory');
await call('<ReportOpenAuths/>', 'ReportOpenAuths');
await call(`<ReportSearch><UtcStart>${fmt(start)}</UtcStart><UtcEnd>${fmt(now)}</UtcEnd></ReportSearch>`, 'ReportSearch');
await call(`<ReportActivity><UtcStart>${fmt(start)}</UtcStart><UtcEnd>${fmt(now)}</UtcEnd></ReportActivity>`, 'ReportActivity');

console.log('\n--- Done ---');
console.log('If every endpoint returned empty bodies, the sandbox has no data at all.');
console.log('If any returned transaction/batch data, the next step is inspecting');
console.log('whether those records carry AdditionalTxnFields / Invoice / Product.');
