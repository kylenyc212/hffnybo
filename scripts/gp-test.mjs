#!/usr/bin/env node
// One-off: exchange GP UCP app_id + app_key for a bearer token, then pull
// the last 24 hours of transactions and dump the raw JSON so we can see
// what the `description` / `reference` fields actually contain for a
// Heartland Mobile Payments transaction.
//
// Usage (from project root):
//   GP_APP_ID='your-app-id' GP_APP_KEY='your-app-key' GP_ENV=production node scripts/gp-test.mjs
//
// GP_ENV is 'production' (default) or 'sandbox'. If your creds are for sandbox,
// run your test transaction through Heartland sandbox; otherwise a real $1
// card you can void afterwards works.

import crypto from 'node:crypto';

const APP_ID = process.env.GP_APP_ID;
const APP_KEY = process.env.GP_APP_KEY;
const ENV = (process.env.GP_ENV || 'production').toLowerCase();
const BASE = ENV === 'sandbox'
  ? 'https://apis.sandbox.globalpay.com/ucp'
  : 'https://apis.globalpay.com/ucp';

if (!APP_ID || !APP_KEY) {
  console.error('❌ Missing GP_APP_ID or GP_APP_KEY env vars.');
  console.error("   Run like: GP_APP_ID='...' GP_APP_KEY='...' node scripts/gp-test.mjs");
  process.exit(1);
}

console.log(`→ Environment: ${ENV}`);
console.log(`→ Base URL:    ${BASE}`);

// Step 1: exchange credentials for bearer access token.
// GP UCP auth: secret = SHA512(nonce + app_key), hex-encoded.
const nonce = crypto.randomBytes(16).toString('hex');
const secret = crypto.createHash('sha512').update(nonce + APP_KEY).digest('hex');

console.log('\n→ Exchanging credentials for access token…');
const tokenRes = await fetch(`${BASE}/accesstoken`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-GP-Version': '2021-03-22'
  },
  body: JSON.stringify({
    app_id: APP_ID,
    nonce,
    secret,
    grant_type: 'client_credentials'
  })
});

if (!tokenRes.ok) {
  console.error(`❌ Token exchange failed: HTTP ${tokenRes.status}`);
  console.error(await tokenRes.text());
  process.exit(1);
}
const tokenJson = await tokenRes.json();
const token = tokenJson.token || tokenJson.access_token;
if (!token) {
  console.error('❌ No token field in response:');
  console.error(JSON.stringify(tokenJson, null, 2));
  process.exit(1);
}
console.log(`✓ Got access token (${token.slice(0, 8)}…)`);

// Step 2: pull recent transactions.
const toDate = new Date();
const fromDate = new Date(Date.now() - 24 * 3600 * 1000);
const fmt = (d) => d.toISOString().slice(0, 10);

const params = new URLSearchParams({
  from_time_created: fmt(fromDate),
  to_time_created: fmt(toDate),
  page: '1',
  page_size: '25',
  order: 'DESC',
  order_by: 'TIME_CREATED'
});

console.log(`\n→ Pulling transactions ${fmt(fromDate)} → ${fmt(toDate)}…`);
const txRes = await fetch(`${BASE}/transactions?${params}`, {
  headers: {
    Authorization: `Bearer ${token}`,
    'X-GP-Version': '2021-03-22',
    Accept: 'application/json'
  }
});

if (!txRes.ok) {
  console.error(`❌ Transactions fetch failed: HTTP ${txRes.status}`);
  console.error(await txRes.text());
  process.exit(1);
}
const data = await txRes.json();
const txns = data.transactions || [];
console.log(`✓ ${txns.length} transaction(s) in window`);

// Pretty summary of what matters for us.
if (txns.length > 0) {
  console.log('\n--- Summary (matching-relevant fields) ---');
  for (const t of txns) {
    console.log({
      id: t.id,
      time_created: t.time_created,
      amount: t.amount,
      currency: t.currency,
      reference: t.reference,
      channel: t.channel,
      status: t.status,
      card_brand: t.payment_method?.card?.brand,
      card_last4: t.payment_method?.card?.masked_number_last4
    });
  }

  // Deep-dive the most recent transaction for description/order details.
  const latest = txns[0];
  console.log(`\n--- GET /transactions/${latest.id} (full detail) ---`);
  const detailRes = await fetch(`${BASE}/transactions/${latest.id}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-GP-Version': '2021-03-22',
      Accept: 'application/json'
    }
  });
  if (detailRes.ok) {
    const detail = await detailRes.json();
    // Flag the fields that would drive auto-matching.
    console.log('description:   ', JSON.stringify(detail.description));
    console.log('reference:     ', JSON.stringify(detail.reference));
    console.log('order_reference:', JSON.stringify(detail.order_reference));
    console.log('\nFull JSON:');
    console.log(JSON.stringify(detail, null, 2));
  } else {
    console.error(`(detail fetch failed: HTTP ${detailRes.status})`);
  }
}

console.log('\n--- RAW LIST RESPONSE ---');
console.log(JSON.stringify(data, null, 2));
