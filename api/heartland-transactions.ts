// GET /api/heartland-transactions?from=2026-05-01&to=2026-05-07
//
// Calls the Heartland Portico SOAP gateway (FindTransactions) and returns
// the transactions for the given UTC date range as JSON. Also returns the
// raw XML so we can inspect exactly what Heartland sends back and confirm
// whether item-level SKU data is present.
//
// Credentials (set as Vercel env vars):
//   HEARTLAND_SECRET_KEY   — preferred: single SecretAPIKey from developer portal
//   -- OR all five of --
//   HEARTLAND_SITE_ID, HEARTLAND_LICENSE_ID, HEARTLAND_DEVICE_ID,
//   HEARTLAND_USERNAME, HEARTLAND_PASSWORD
//
// Self-contained: no shared imports.

interface VReq { method?: string; url?: string; }
interface VRes {
  status(n: number): VRes;
  json(o: unknown): void;
  setHeader(k: string, v: string): void;
}

// Portico endpoints
const PROD_URL =
  'https://api2.heartlandportico.com/Hps.Exchange.PosGateway/PosGatewayService.asmx';
const CERT_URL =
  'https://cert.api2.heartlandportico.com/Hps.Exchange.PosGateway/PosGatewayService.asmx';

// ---------- credential helpers ----------

function buildAuthHeader(): string {
  const key = process.env.HEARTLAND_SECRET_KEY;
  if (key) return `<SecretAPIKey>${escXml(key)}</SecretAPIKey>`;

  const site = process.env.HEARTLAND_SITE_ID;
  const lic  = process.env.HEARTLAND_LICENSE_ID;
  const dev  = process.env.HEARTLAND_DEVICE_ID;
  const user = process.env.HEARTLAND_USERNAME;
  const pass = process.env.HEARTLAND_PASSWORD;
  if (site && lic && dev && user && pass) {
    return [
      `<SiteId>${escXml(site)}</SiteId>`,
      `<LicenseId>${escXml(lic)}</LicenseId>`,
      `<DeviceId>${escXml(dev)}</DeviceId>`,
      `<UserName>${escXml(user)}</UserName>`,
      `<Password>${escXml(pass)}</Password>`,
    ].join('');
  }

  throw new Error(
    'No Heartland credentials. Set HEARTLAND_SECRET_KEY, or the five ' +
    'HEARTLAND_SITE_ID / LICENSE_ID / DEVICE_ID / USERNAME / PASSWORD vars.'
  );
}

function isCertKey(): boolean {
  const key = process.env.HEARTLAND_SECRET_KEY ?? '';
  return key.startsWith('skapi_cert_');
}

function escXml(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ---------- SOAP builder ----------

function buildSoap(startUtc: string, endUtc: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope
  xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <soap:Body>
    <PosRequest xmlns="http://Hps.Exchange.PosGateway">
      <Ver1.0>
        <Header>${buildAuthHeader()}</Header>
        <Transaction>
          <FindTransactions>
            <Criteria>
              <StartUtcDT>${escXml(startUtc)}</StartUtcDT>
              <EndUtcDT>${escXml(endUtc)}</EndUtcDT>
            </Criteria>
          </FindTransactions>
        </Transaction>
      </Ver1.0>
    </PosRequest>
  </soap:Body>
</soap:Envelope>`;
}

// ---------- minimal XML extraction ----------
// No xml2js needed — we just grab text from named elements.

function allTagValues(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'g');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1].trim());
  return out;
}

function firstTagValue(xml: string, tag: string): string {
  return allTagValues(xml, tag)[0] ?? '';
}

function extractTransactions(xml: string): object[] {
  // Each transaction lives inside <TxnHeader>...</TxnHeader>
  const txnRe = /<TxnHeader>([\s\S]*?)<\/TxnHeader>/g;
  const txns: object[] = [];
  let m: RegExpExecArray | null;
  while ((m = txnRe.exec(xml)) !== null) {
    const chunk = m[1];
    // Pull every child element as key→value (handles simple text nodes)
    const fields: Record<string, string> = {};
    const fieldRe = /<(\w+)>([^<]*)<\/\1>/g;
    let f: RegExpExecArray | null;
    while ((f = fieldRe.exec(chunk)) !== null) {
      fields[f[1]] = f[2].trim();
    }
    txns.push(fields);
  }
  return txns;
}

// ---------- handler ----------

export default async function handler(req: VReq, res: VRes) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Parse query params from URL
  const url = new URL(req.url ?? '/', 'http://localhost');
  const from = url.searchParams.get('from') ?? '';
  const to   = url.searchParams.get('to')   ?? '';

  if (!from || !to) {
    res.status(400).json({ error: 'from and to query params required (YYYY-MM-DD)' });
    return;
  }

  // Convert YYYY-MM-DD to the ISO datetime Portico expects
  const startUtc = `${from}T00:00:00`;
  const endUtc   = `${to}T23:59:59`;

  let soap: string;
  let endpoint: string;
  try {
    soap = buildSoap(startUtc, endUtc);
    endpoint = isCertKey() ? CERT_URL : PROD_URL;
  } catch (e: unknown) {
    res.status(500).json({ error: (e instanceof Error ? e.message : 'Credential error') });
    return;
  }

  let rawXml = '';
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': '""',
      },
      body: soap,
    });
    rawXml = await response.text();
  } catch (e: unknown) {
    res.status(502).json({ error: `Network error calling Portico: ${e instanceof Error ? e.message : e}` });
    return;
  }

  // Top-level gateway response code (GatewayRspCode 0 = success)
  const gwCode = firstTagValue(rawXml, 'GatewayRspCode');
  const gwMsg  = firstTagValue(rawXml, 'GatewayRspMsg');
  const txns   = extractTransactions(rawXml);

  res.status(200).json({
    endpoint,
    range: { from, to },
    gatewayCode: gwCode,
    gatewayMsg:  gwMsg,
    transactionCount: txns.length,
    transactions: txns,
    rawXml,   // <-- include full XML so we can see every field Heartland returns
  });
}
