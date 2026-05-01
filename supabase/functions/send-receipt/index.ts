// Supabase Edge Function — send-receipt
// Sends a plain-text + HTML receipt email via Gmail SMTP (app password).
//
// Required secrets (set in Supabase dashboard → Edge Functions → Secrets):
//   GMAIL_USER          your Gmail address, e.g. hffny@gmail.com
//   GMAIL_APP_PASSWORD  16-char app password from Google Account → Security

import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: CORS });
  }

  try {
    const {
      to,           // string — recipient email
      orderRef,     // string | null — receipt / order #
      cashierName,  // string
      items,        // { label: string; screeningTitle: string; qty: number; unitPriceCents: number }[]
      totalCents,   // number
      payMethod,    // 'cash' | 'external'
      cardBrand,    // string | null
    } = await req.json();

    if (!to || !to.includes('@')) {
      return new Response(JSON.stringify({ error: 'Invalid email address' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const fmt = (cents: number) =>
      '$' + (cents / 100).toFixed(2);

    const now = new Date().toLocaleString('en-US', {
      timeZone: 'America/New_York',
      dateStyle: 'medium',
      timeStyle: 'short',
    });

    // ── Plain text ──────────────────────────────────────────────────────────
    const itemLines = items.map(
      (i: { label: string; screeningTitle: string; qty: number; unitPriceCents: number }) =>
        `  ${i.screeningTitle}\n  ${i.label} x${i.qty}  ${fmt(i.qty * i.unitPriceCents)}`
    ).join('\n\n');

    const payLine = payMethod === 'external' && cardBrand
      ? `Payment: ${cardBrand} (card on file)`
      : 'Payment: Cash';

    const text = [
      'HEARTLAND FILM FESTIVAL NEW YORK',
      'Box Office Receipt',
      '─────────────────────────────────',
      now,
      orderRef ? `Receipt #: ${orderRef}` : '',
      '',
      itemLines,
      '',
      '─────────────────────────────────',
      `Total:   ${fmt(totalCents)}`,
      payLine,
      '',
      'Thank you for supporting independent film!',
      'heartlandfilm.org',
    ].filter((l) => l !== null).join('\n');

    // ── HTML ────────────────────────────────────────────────────────────────
    const rowsHtml = items.map(
      (i: { label: string; screeningTitle: string; qty: number; unitPriceCents: number }) => `
        <tr>
          <td style="padding:8px 0; border-bottom:1px solid #333;">
            <div style="font-weight:600; color:#fff;">${i.screeningTitle}</div>
            <div style="color:#aaa; font-size:13px;">${i.label} &times;${i.qty}</div>
          </td>
          <td style="padding:8px 0; border-bottom:1px solid #333; text-align:right; font-weight:600; color:#fff; white-space:nowrap;">
            ${fmt(i.qty * i.unitPriceCents)}
          </td>
        </tr>`
    ).join('');

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#111;font-family:system-ui,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:32px auto;">
    <tr>
      <td style="background:#1e1e1e;border-radius:16px;padding:32px;">

        <div style="font-size:11px;letter-spacing:2px;color:#888;text-transform:uppercase;margin-bottom:4px;">
          Heartland Film Festival NY
        </div>
        <div style="font-size:22px;font-weight:700;color:#fff;margin-bottom:4px;">
          Box Office Receipt
        </div>
        <div style="font-size:13px;color:#666;margin-bottom:24px;">
          ${now}${orderRef ? ` &nbsp;·&nbsp; #${orderRef}` : ''}
        </div>

        <table width="100%" cellpadding="0" cellspacing="0">
          ${rowsHtml}
          <tr>
            <td style="padding:12px 0 0; font-size:16px; font-weight:700; color:#fff;">Total</td>
            <td style="padding:12px 0 0; text-align:right; font-size:18px; font-weight:700; color:#fff;">${fmt(totalCents)}</td>
          </tr>
        </table>

        <div style="margin-top:8px;font-size:12px;color:#666;">
          ${payMethod === 'external' && cardBrand ? cardBrand + ' (card on file)' : 'Cash'}
        </div>

        <div style="margin-top:28px;padding-top:20px;border-top:1px solid #333;font-size:13px;color:#666;text-align:center;">
          Thank you for supporting independent film!<br>
          <a href="https://heartlandfilm.org" style="color:#888;">heartlandfilm.org</a>
        </div>

      </td>
    </tr>
  </table>
</body>
</html>`;

    // ── Send via Gmail SMTP ─────────────────────────────────────────────────
    const gmailUser = Deno.env.get('GMAIL_USER');
    const gmailPass = Deno.env.get('GMAIL_APP_PASSWORD');

    if (!gmailUser || !gmailPass) {
      return new Response(
        JSON.stringify({ error: 'GMAIL_USER / GMAIL_APP_PASSWORD secrets not configured' }),
        { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

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
      subject: `Your HFFNY receipt${orderRef ? ` #${orderRef}` : ''}`,
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
