// Supabase Edge Function — send-receipt
// Sends a branded HTML + plain-text receipt via Gmail SMTP (app password).
// info@aflfc.org is always CC'd on every receipt.
//
// Required secrets (Supabase dashboard → Edge Functions → Secrets):
//   GMAIL_USER          sending Gmail address
//   GMAIL_APP_PASSWORD  16-char app password from Google Account → Security

import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CC_ADDRESS = 'info@aflfc.org';

const HFFNY_ICON   = 'https://static.wixstatic.com/media/8bb682_2ce114da8b7e4202b36d278a883e2673~mv2.png';
const AFLFC_LOGO   = 'https://static.wixstatic.com/media/8bb682_4403114a69e54b93bfc43ae019afa42b~mv2.png';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: CORS });
  }

  try {
    const {
      to,           // string
      orderRef,     // string | null
      cashierName,  // string
      items,        // { label, screeningTitle, qty, unitPriceCents }[]
      totalCents,   // number
      payMethod,    // 'cash' | 'external'
      cardBrand,    // string | null
      cardLast4,    // string | null
    } = await req.json();

    if (!to || !to.includes('@')) {
      return new Response(JSON.stringify({ error: 'Invalid email address' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const gmailUser = Deno.env.get('GMAIL_USER');
    const gmailPass = Deno.env.get('GMAIL_APP_PASSWORD');
    if (!gmailUser || !gmailPass) {
      return new Response(
        JSON.stringify({ error: 'GMAIL_USER / GMAIL_APP_PASSWORD secrets not configured' }),
        { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    type Item = { label: string; screeningTitle: string; qty: number; unitPriceCents: number };
    const fmt = (cents: number) => '$' + (cents / 100).toFixed(2);

    const now = new Date().toLocaleString('en-US', {
      timeZone: 'America/New_York',
      dateStyle: 'long',
      timeStyle: 'short',
    });

    const payLabel = payMethod === 'external'
      ? `${cardBrand ?? 'Card'}${cardLast4 ? ` ···· ${cardLast4}` : ''}`
      : 'Cash';

    const payEmoji = payMethod === 'external' ? '💳' : '💵';

    // ── Plain text ────────────────────────────────────────────────────────────
    const textItems = (items as Item[]).map((i) =>
      `  ${i.screeningTitle}\n  ${i.label} x${i.qty}   ${fmt(i.qty * i.unitPriceCents)}`
    ).join('\n\n');

    const text = [
      'HAVANA FILM FESTIVAL NEW YORK',
      'Celebrating Latin American Cinema since 2000',
      '─────────────────────────────────────',
      `Box Office Receipt`,
      now,
      orderRef ? `Receipt #${orderRef}` : '',
      '',
      textItems,
      '',
      '─────────────────────────────────────',
      `TOTAL   ${fmt(totalCents)}`,
      `Payment: ${payEmoji} ${payLabel}`,
      '',
      'Thank you for attending!',
      'hffny.com  ·  aflfc.org',
    ].filter(Boolean).join('\n');

    // ── Item rows HTML ────────────────────────────────────────────────────────
    const rowsHtml = (items as Item[]).map((i) => `
      <tr>
        <td style="padding:9px 0;border-bottom:1px solid #f0f0f0;">
          <div style="font-weight:700;color:#111;font-size:14px;line-height:1.3;">${i.screeningTitle}</div>
          <div style="color:#888;font-size:12px;margin-top:2px;">${i.label}&nbsp;&times;&nbsp;${i.qty}</div>
        </td>
        <td style="padding:9px 0;border-bottom:1px solid #f0f0f0;text-align:right;
                   font-weight:700;color:#111;font-size:14px;vertical-align:top;white-space:nowrap;">
          ${fmt(i.qty * i.unitPriceCents)}
        </td>
      </tr>`
    ).join('');

    const payPillStyle = payMethod === 'external'
      ? 'background:#1a1a1a;border-radius:20px;padding:5px 14px;font-size:12px;font-weight:600;color:#F6C000;'
      : 'background:#F6F6F6;border:1px solid #e8e8e8;border-radius:20px;padding:5px 14px;font-size:12px;font-weight:600;color:#444;';

    // ── Full HTML ─────────────────────────────────────────────────────────────
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>HFFNY Receipt</title>
</head>
<body style="margin:0;padding:0;background:#e8e8e8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">

<table width="100%" cellpadding="0" cellspacing="0" style="background:#e8e8e8;padding:32px 16px;">
<tr><td>
<table width="100%" cellpadding="0" cellspacing="0"
       style="max-width:520px;margin:0 auto;border-radius:16px;overflow:hidden;
              box-shadow:0 4px 20px rgba(0,0,0,0.18);">

  <!-- ── WHITE HEADER ── -->
  <tr>
    <td style="background:#ffffff;padding:24px 28px 18px;border-bottom:4px solid #F6C000;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <!-- HFFNY mascot icon -->
          <td style="vertical-align:middle;width:52px;">
            <img src="${HFFNY_ICON}" alt="HFFNY" width="48" height="48"
                 style="width:48px;height:48px;object-fit:contain;display:block;">
          </td>
          <td style="width:12px;"></td>
          <!-- Festival name -->
          <td style="vertical-align:middle;">
            <div style="font-size:17px;font-weight:900;line-height:1.2;letter-spacing:-0.3px;">
              <span style="color:#E8175A;">H</span><span style="color:#CC1B8C;">av</span><span
                    style="color:#F05A28;">an</span><span style="color:#E03A1C;">a</span>
              <span style="color:#111;"> Film Festival</span>
            </div>
            <div style="font-size:17px;font-weight:900;color:#111;line-height:1.2;">New York</div>
            <div style="font-size:10px;color:#999;margin-top:3px;letter-spacing:0.2px;">
              Celebrating Latin American Cinema since 2000
            </div>
          </td>
          <!-- AFLFC logo -->
          <td style="vertical-align:middle;text-align:right;padding-left:12px;">
            <img src="${AFLFC_LOGO}" alt="AFLFC" height="36"
                 style="max-height:36px;width:auto;display:block;margin-left:auto;">
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- ── YELLOW RECEIPT LABEL ── -->
  <tr>
    <td style="background:#F6C000;padding:8px 28px;">
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="font-size:10px;font-weight:800;letter-spacing:2.5px;text-transform:uppercase;color:#1a1a1a;">
          Box Office Receipt
        </td>
        <td style="font-size:10px;color:#7a5800;text-align:right;white-space:nowrap;">
          ${now}${orderRef ? `&nbsp;&nbsp;·&nbsp;&nbsp;#${orderRef}` : ''}
        </td>
      </tr></table>
    </td>
  </tr>

  <!-- ── ITEMS ── -->
  <tr>
    <td style="background:#fff;padding:20px 28px 0;">
      <table width="100%" cellpadding="0" cellspacing="0">
        ${rowsHtml}
        <!-- Last item border override -->
        <tr>
          <td colspan="2" style="padding:0;border-bottom:2px solid #111;font-size:0;">&nbsp;</td>
        </tr>
        <!-- Total -->
        <tr>
          <td style="padding:14px 0 6px;">
            <span style="font-size:14px;font-weight:800;color:#111;text-transform:uppercase;letter-spacing:0.5px;">Total</span>
          </td>
          <td style="padding:14px 0 6px;text-align:right;">
            <span style="font-size:26px;font-weight:900;color:#E8175A;">${fmt(totalCents)}</span>
          </td>
        </tr>
      </table>
      <!-- Payment pill -->
      <div style="padding-bottom:20px;margin-top:4px;">
        <span style="display:inline-block;${payPillStyle}">
          ${payEmoji}&nbsp;${payLabel}
        </span>
      </div>
    </td>
  </tr>

  <!-- ── DARK FOOTER ── -->
  <tr>
    <td style="background:#1a1a1a;padding:18px 28px 16px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="vertical-align:top;">
            <div style="font-size:12px;font-weight:700;color:#F6C000;margin-bottom:3px;">
              Havana Film Festival New York
            </div>
            <div style="font-size:11px;color:#666;line-height:1.5;">
              Presented by the American Friends of the<br>Ludwig Foundation of Cuba (AFLFC)
            </div>
          </td>
          <td style="vertical-align:top;text-align:right;padding-left:16px;">
            <img src="${AFLFC_LOGO}" alt="AFLFC" height="30"
                 style="max-height:30px;width:auto;display:block;margin-left:auto;
                        filter:brightness(0) invert(1);opacity:0.4;">
          </td>
        </tr>
        <tr>
          <td colspan="2" style="padding-top:12px;font-size:11px;">
            <a href="https://hffny.com" style="color:#666;text-decoration:none;">hffny.com</a>
            <span style="color:#3a3a3a;">&nbsp;·&nbsp;</span>
            <a href="https://aflfc.org" style="color:#666;text-decoration:none;">aflfc.org</a>
            <span style="color:#3a3a3a;">&nbsp;·&nbsp;</span>
            <a href="mailto:info@aflfc.org" style="color:#666;text-decoration:none;">info@aflfc.org</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;

    // ── Send ─────────────────────────────────────────────────────────────────
    const client = new SMTPClient({
      connection: {
        hostname: 'smtp.gmail.com',
        port: 465,
        tls: true,
        auth: { username: gmailUser, password: gmailPass },
      },
    });

    await client.send({
      from: `HFFNY Box Office <${gmailUser}>`,
      to,
      cc: CC_ADDRESS,
      subject: `Your HFFNY receipt${orderRef ? ` — #${orderRef}` : ''}`,
      content: text,
      html,
    });

    await client.close();

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  } catch (e) {
    console.error('send-receipt error:', e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : 'Send failed' }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }
});
