// ════════════════════════════════════════════════════════════
//  Customer confirmation emails via Gmail SMTP (nodemailer).
//  Env: GMAIL_USER, GMAIL_APP_PASS (a Gmail *App Password*, not the
//  account password — requires 2FA on the Gmail account).
//  If sends fail with 535-5.7.8, regenerate the App Password in Google
//  and update GMAIL_APP_PASS in Vercel, then redeploy.
// ════════════════════════════════════════════════════════════
import nodemailer from 'nodemailer';

const BRAND = 'Medway & Kent Removals';
const PHONE = '01634 971005';
const NAVY = '#0d1f3c';
const ORANGE = '#e04e1b';

function transport() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASS },
  });
}

function fmtDate(iso) {
  return new Date(iso).toLocaleString('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}
function fmtTime(iso) {
  return new Date(iso).toLocaleString('en-GB', {
    timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit',
  });
}

function shell(heading, introLine, rows) {
  const rowsHtml = rows
    .filter((r) => r[1])
    .map(
      ([k, v]) => `
      <tr>
        <td style="padding:9px 0;border-bottom:1px solid #eee;color:#666;width:38%">${k}</td>
        <td style="padding:9px 0;border-bottom:1px solid #eee;font-weight:600;color:#111">${v}</td>
      </tr>`
    )
    .join('');

  return `
  <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
    <div style="background:${NAVY};padding:24px 32px;border-radius:8px 8px 0 0">
      <h1 style="color:#fff;font-size:20px;margin:0">${heading}</h1>
      <p style="color:#ff9a75;margin:6px 0 0;font-size:14px">${BRAND}</p>
    </div>
    <div style="background:#f8f8f8;padding:28px 32px;border:1px solid #e0e0e0;border-top:none;border-radius:0 0 8px 8px">
      <p style="font-size:15px;color:#222;margin:0 0 18px">${introLine}</p>
      <table style="width:100%;border-collapse:collapse;font-size:15px">${rowsHtml}</table>
      <p style="margin-top:22px;font-size:14px;color:#444;line-height:1.6">
        If anything needs to change, just reply to this email or call us on
        <a href="tel:${PHONE.replace(/\s/g, '')}" style="color:${ORANGE};font-weight:700">${PHONE}</a>.
      </p>
      <p style="margin-top:18px;font-size:12px;color:#999">${BRAND} · ${PHONE}</p>
    </div>
  </div>`;
}

function textVersion(title, rows) {
  const lines = rows.filter((r) => r[1]).map(([k, v]) => `${k}: ${v}`);
  return [title, '', ...lines, '', `Questions? Call us on ${PHONE}.`, BRAND].join('\n');
}

export async function sendSurveyConfirmation(quote, appt) {
  const rows = [
    ['Date', fmtDate(appt.scheduled_for)],
    ['Time', fmtTime(appt.scheduled_for)],
    ['Address', appt.address || quote.from_postcode],
    ['Service', quote.service],
  ];
  const heading = 'Your pre-move survey is booked';
  const intro = `Hi ${quote.name || 'there'}, thanks for choosing ${BRAND}. We've booked your free pre-move survey — here are the details:`;
  await transport().sendMail({
    from: `${BRAND} <${process.env.GMAIL_USER}>`,
    to: quote.email,
    subject: `Survey confirmed — ${fmtDate(appt.scheduled_for)}`,
    text: textVersion(heading, rows),
    html: shell(heading, intro, rows),
  });
}

export async function sendMoveConfirmation(quote, appt) {
  const rows = [
    ['Moving date', fmtDate(appt.scheduled_for)],
    ['Start time', fmtTime(appt.scheduled_for)],
    ['Moving from', quote.from_postcode],
    ['Moving to', quote.to_postcode],
    ['Service', quote.service],
  ];
  const heading = 'Your moving date is confirmed';
  const intro = `Hi ${quote.name || 'there'}, your move with ${BRAND} is all booked in. Here's a summary:`;
  await transport().sendMail({
    from: `${BRAND} <${process.env.GMAIL_USER}>`,
    to: quote.email,
    subject: `Moving date confirmed — ${fmtDate(appt.scheduled_for)}`,
    text: textVersion(heading, rows),
    html: shell(heading, intro, rows),
  });
}
