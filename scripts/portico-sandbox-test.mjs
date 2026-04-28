#!/usr/bin/env node
// Read-only Portico sandbox smoke test: authenticates with your Secret Key
// and calls FindTransactions to see what comes back. Does NOT push any
// transactions. Pure observation.
//
// Usage (from project root):
//   PORTICO_SECRET_KEY='skapi_cert_...' node scripts/portico-sandbox-test.mjs
//
// If your key is for production, flip to the production endpoint by
// prefixing PORTICO_ENV=production.

const SECRET_KEY = process.env.PORTICO_SECRET_KEY;
const ENV = (process.env.PORTICO_ENV || 'sandbox').toLowerCase();

if (!SECRET_KEY) {
  console.error('❌ Missing PORTICO_SECRET_KEY env var.');
  console.error("   Run: PORTICO_SECRET_KEY='skapi_cert_...' node scripts/portico-sandbox-test.mjs");
  process.exit(1);
}

const ENDPOINT = ENV === 'production'
  ? 'https://api2.heartlandportico.com/Hps.Exchange.PosGateway/PosGatewayService.asmx'
  : 'https://cert.api2.heartlandportico.com/Hps.Exchange.PosGateway/PosGatewayService.asmx';

console.log(`→ Environment: ${ENV}`);
console.log(`→ Endpoint:    ${ENDPOINT}`);
console.log(`→ Key prefix:  ${SECRET_KEY.slice(0, 12)}…`);

// ---------- helpers ----------
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function extract(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return m ? m[1].trim() : null;
}
function extractAll(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'g');
  return [...xml.matchAll(re)].map((m) => m[1].trim());
}

async function soapCall(innerXml, label) {
  const envelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <PosRequest xmlns="http://Hps.Exchange.PosGateway">
      <Ver1.0>
        <Header>
          <SecretAPIKey>${esc(SECRET_KEY)}</SecretAPIKey>
        </Header>
        <Transaction>
${innerXml}
        </Transaction>
      </Ver1.0>
    </PosRequest>
  </soap:Body>
</soap:Envelope>`;

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': 'http://Hps.Exchange.PosGateway/DoTransaction'
    },
    body: envelope
  });

  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

// ---------- 1) TestCredentials — cheapest auth check ----------
console.log('\n=== 1) TestCredentials (auth sanity check) ===');
const testCredsRsp = await soapCall('          <TestCredentials/>', 'TestCredentials');
console.log(`HTTP ${testCredsRsp.status} ${testCredsRsp.ok ? 'OK' : 'FAIL'}`);
const gwCode = extract(testCredsRsp.text, 'GatewayRspCode');
const gwMsg = extract(testCredsRsp.text, 'GatewayRspMsg');
if (gwCode !== null) {
  console.log(`GatewayRspCode: ${gwCode}  (${gwMsg || 'no message'})`);
  if (gwCode === '0') {
    console.log('✓ Credentials accepted by gateway.\n');
  } else {
    console.log('✗ Gateway rejected the credentials. Full response below.\n');
    console.log(testCredsRsp.text);
    process.exit(1);
  }
} else {
  console.log('⚠ No GatewayRspCode in response. Probably a transport/SOAP-level error.');
  console.log('Response body:');
  console.log(testCredsRsp.text);
  process.exit(1);
}

// ---------- 2) FindTransactions — widest possible window (90 days) ----------
console.log('=== 2) FindTransactions (last 90 days, the full retention window) ===');
const now = new Date();
const start = new Date(Date.now() - 90 * 24 * 3600 * 1000);
const fmt = (d) => d.toISOString().split('.')[0]; // strip ms, keep 'Z'

const findInner = `
          <FindTransactions>
            <Criteria>
              <StartUtcDT>${fmt(start)}</StartUtcDT>
              <EndUtcDT>${fmt(now)}</EndUtcDT>
            </Criteria>
          </FindTransactions>`;

const findRsp = await soapCall(findInner, 'FindTransactions');
console.log(`HTTP ${findRsp.status} ${findRsp.ok ? 'OK' : 'FAIL'}`);
const findCode = extract(findRsp.text, 'GatewayRspCode');
const findMsg = extract(findRsp.text, 'GatewayRspMsg');
console.log(`GatewayRspCode: ${findCode}  (${findMsg || ''})`);

if (findCode !== '0') {
  console.log('\n✗ FindTransactions returned non-zero. Full response:\n');
  console.log(findRsp.text);
  process.exit(1);
}

// The response's top-level <Header> has its own GatewayTxnId (the envelope
// tracking ID) — do NOT count that. Only count <Transactions> child elements
// inside the <FindTransactions> response block.
const findBlock = extract(findRsp.text, 'FindTransactions') || '';
const txnBlocks = extractAll(findBlock, 'Transactions');
console.log(`\nTransactions found in window: ${txnBlocks.length}`);

if (txnBlocks.length === 0) {
  console.log('\n(Empty sandbox, as expected for a new account.)');
  console.log('What this confirms:');
  console.log('  ✓ Your Secret Key authenticates correctly against Portico');
  console.log('  ✓ FindTransactions is reachable');
  console.log('  ✓ The SOAP envelope + SecretAPIKey header is the right shape');
  console.log('\nWhat we still cannot know without real Heartland Mobile Payments data:');
  console.log('  ? Whether Heartland Mobile populates AdditionalTxnFields.Description');
  console.log('    with the item name when a cashier taps a catalog item on the tablet.');
  console.log('  → To learn that, we need production creds OR you ring some test sales');
  console.log('    on a Heartland Mobile device connected to this sandbox.');
} else {
  console.log('\n--- Per-transaction summary ---');
  txnBlocks.forEach((block, i) => {
    const id = extract(block, 'GatewayTxnId');
    const svc = extract(block, 'ServiceName');
    const amt = extract(block, 'Amt');
    const desc = extract(block, 'Description');
    const inv = extract(block, 'InvoiceNbr');
    const cust = extract(block, 'CustomerID');
    const status = extract(block, 'TxnStatus');
    const card = extract(block, 'MaskedCardNbr');
    console.log(`  [${i}] TxnId=${id} ${svc} $${amt} ${status || ''} ${card || ''}`);
    if (desc || inv || cust) {
      console.log(`       AdditionalTxnFields:`);
      if (desc) console.log(`         Description = ${JSON.stringify(desc)}`);
      if (inv)  console.log(`         InvoiceNbr  = ${JSON.stringify(inv)}`);
      if (cust) console.log(`         CustomerID  = ${JSON.stringify(cust)}`);
    } else {
      console.log(`       (no AdditionalTxnFields)`);
    }
  });

  // Bulk view: count how many transactions actually carry each field
  const withDesc = txnBlocks.filter((b) => extract(b, 'Description')).length;
  const withInv = txnBlocks.filter((b) => extract(b, 'InvoiceNbr')).length;
  const withCust = txnBlocks.filter((b) => extract(b, 'CustomerID')).length;

  console.log('\n--- Field population rates ---');
  console.log(`  Description populated: ${withDesc} / ${txnBlocks.length}`);
  console.log(`  InvoiceNbr populated:  ${withInv} / ${txnBlocks.length}`);
  console.log(`  CustomerID populated:  ${withCust} / ${txnBlocks.length}`);

  console.log('\n--- Verdict for auto-match ---');
  if (withDesc > 0 || withInv > 0) {
    console.log('✓ At least some transactions carry Description or InvoiceNbr.');
    console.log('  Sample the values above — if they look like item names or SKUs,');
    console.log('  auto-match is feasible.');
  } else {
    console.log('✗ None of the visible transactions have Description or InvoiceNbr.');
    console.log('  Either the sandbox creator of these txns did not populate them,');
    console.log('  OR Heartland Mobile Payments does not fill them automatically.');
    console.log('  Manual-match (External CC button) is the safer bet.');
  }
}

// Save the raw response for later inspection.
const fs = await import('node:fs/promises');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = `scripts/portico-test-output-${stamp}`;
await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(`${outDir}/test-credentials.xml`, testCredsRsp.text);
await fs.writeFile(`${outDir}/find-transactions.xml`, findRsp.text);
console.log(`\nRaw XML saved to: ${outDir}/`);
