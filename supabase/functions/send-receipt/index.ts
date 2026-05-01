// Supabase Edge Function — send-receipt
// Sends a branded HTML + plain-text receipt via Gmail SMTP (app password).
// info@aflfc.org is always BCC'd on every receipt.
//
// Required secrets (Supabase dashboard → Edge Functions → Secrets):
//   GMAIL_USER          sending Gmail address, e.g. hffny@gmail.com
//   GMAIL_APP_PASSWORD  16-char app password from Google Account → Security
//
// Optional secrets (add to show logos in the email):
//   HFFNY_LOGO_URL      publicly accessible PNG/JPG URL for the HFFNY logo
//   AFLFC_LOGO_URL      publicly accessible PNG/JPG URL for the AFLFC logo

import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BCC = 'info@aflfc.org';

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
    } = await req.json();

    if (!to || !to.includes('@')) {
      return new Response(JSON.stringify({ error: 'Invalid email address' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const gmailUser = Deno.env.get('GMAIL_USER');
    const gmailPass = Deno.env.get('GMAIL_APP_PASSWORD');
    const hffnyLogo = Deno.env.get('HFFNY_LOGO_URL') ?? '';
    const aflLogo   = Deno.env.get('AFLFC_LOGO_URL') ?? '';

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

    const payLine = payMethod === 'external' && cardBrand
      ? `${cardBrand} (card on file)`
      : 'Cash';

    // ── Plain text ────────────────────────────────────────────────────────────
    const textItems = (items as Item[]).map((i) =>
      `  ${i.screeningTitle}\n  ${i.label} x${i.qty}  ${fmt(i.qty * i.unitPriceCents)}`
    ).join('\n\n');

    const text = [
      'HEARTLAND FILM FESTIVAL NEW YORK',
      'Presented by AFLFC',
      'Box Office Receipt',
      '─────────────────────────────────',
      now,
      orderRef ? `Receipt #${orderRef}` : '',
      '',
      textItems,
      '',
      '─────────────────────────────────',
      `TOTAL   ${fmt(totalCents)}`,
      `Payment: ${payLine}`,
      '',
      'Thank you for attending!',
      'heartlandfilm.org  |  aflfc.org',
    ].filter(Boolean).join('\n');

    // ── HTML ─────────────────────────────────────────────────────────────────
    const logoBlock = (hffnyLogo || aflLogo) ? `
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
        <tr>
          ${hffnyLogo ? `<td style="text-align:${aflLogo ? 'left' : 'center'}; vertical-align:middle; padding-right:12px;">
            <img src="${hffnyLogo}" alt="Heartland Film Festival NY" height="48" style="max-height:48px;width:auto;display:block;">
          </td>` : ''}
          ${aflLogo ? `<td style="text-align:${hffnyLogo ? 'right' : 'center'}; vertical-align:middle;">
            <img src="${aflLogo}" alt="AFLFC" height="48" style="max-height:48px;width:auto;display:block;${hffnyLogo ? 'margin-left:auto;' : 'margin:0 auto;'}">
          </td>` : ''}
        </tr>
      </table>` : '';

    const rowsHtml = (items as Item[]).map((i) => `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #e8e8e8;">
          <div style="font-weight:600;color:#111;font-size:14px;line-height:1.3;">${i.screeningTitle}</div>
          <div style="color:#666;font-size:12px;margin-top:2px;">${i.label}&nbsp;&times;&nbsp;${i.qty}</div>
        </td>
        <td style="padding:10px 0;border-bottom:1px solid #e8e8e8;text-align:right;font-weight:600;color:#111;font-size:14px;white-space:nowrap;vertical-align:top;">
          ${fmt(i.qty * i.unitPriceCents)}
        </td>
      </tr>`
    ).join('');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>HFFNY Receipt</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">

  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:32px 16px;">
    <tr>
      <td>
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

          <!-- Header band -->
          <tr>
            <td style="background:#1a1a2e;padding:24px 32px;">
              ${logoBlock}
              <div style="font-size:11px;letter-spacing:2px;color:#888;text-transform:uppercase;margin-bottom:4px;">Box Office Receipt</div>
              <div style="font-size:13px;color:#aaa;">${now}${orderRef ? `&nbsp;&nbsp;·&nbsp;&nbsp;#${orderRef}` : ''}</div>
            </td>
          </tr>

          <!-- Items -->
          <tr>
            <td style="padding:24px 32px 0;">
              <table width="100%" cellpadding="0" cellspacing="0">
                ${rowsHtml}
                <!-- Total row -->
                <tr>
                  <td style="padding:16px 0 0;font-size:16px;font-weight:700;color:#111;">Total</td>
                  <td style="padding:16px 0 0;text-align:right;font-size:20px;font-weight:700;color:#111;">${fmt(totalCents)}</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Payment method -->
          <tr>
            <td style="padding:8px 32px 24px;">
              <span style="display:inline-block;background:#f0f0f0;border-radius:20px;padding:4px 12px;font-size:12px;color:#555;">
                ${payLine}
              </span>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:0 32px;"><hr style="border:none;border-top:1px solid #eee;margin:0;"></td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px 28px;text-align:center;">
              <div style="font-size:13px;color:#444;font-weight:600;margin-bottom:4px;">
                Heartland Film Festival New York
              </div>
              <div style="font-size:12px;color:#888;margin-bottom:12px;">
                Presented by the American Film and Literary Festival Corporation
              </div>
              <div style="font-size:12px;">
                <a href="https://heartlandfilm.org" style="color:#555;text-decoration:none;">heartlandfilm.org</a>
                &nbsp;&nbsp;|&nbsp;&nbsp;
                <a href="https://aflfc.org" style="color:#555;text-decoration:none;">aflfc.org</a>
              </div>
            </td>
          </tr>

        </table>

        <!-- Fine print -->
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:12px auto 0;">
          <tr>
            <td style="text-align:center;font-size:11px;color:#aaa;padding:0 16px;">
              This receipt was sent from the HFFNY box office. Questions? Reply to this email or contact info@aflfc.org.
            </td>
          </tr>
        </table>

      </td>
    </tr>
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
      bcc: BCC,
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
