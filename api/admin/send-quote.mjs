// ════════════════════════════════════════════════════════════
//  Send a quote to the customer via Resend, with the PDF attached.
//  The browser generates the PDF and posts it here as base64.
// ════════════════════════════════════════════════════════════
import { requireAuth } from './_session.mjs';
import { appendNote } from './_db.mjs';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const esc = (s) => String(s || '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export default async function handler(req, res) {
  const role = requireAuth(req, res);
  if (!role) return;
  // Quote and invoice documents carry prices; staff sessions cannot send them.
  if (role === 'staff') return res.status(403).json({ error: 'not available on the staff login' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  try {
    const { lead_id, to, subject, body, pdf_base64, filename, kind } = req.body || {};
    if (!to || !subject || !body) {
      return res.status(400).json({ error: 'to, subject and body are required' });
    }

    // The plain-text body keeps the raw accept URL; in the HTML version that
    // line is rendered as a proper 3D button instead.
    const wrap = (t) => '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#222;line-height:1.6;white-space:pre-wrap">' + esc(t) + '</div>';
    const acceptMatch = String(body).match(/https:\/\/www\.medwaykentremovals\.co\.uk\/api\/accept-quote\?\S+/);
    let html;
    if (acceptMatch) {
      const [before, after] = String(body).split(acceptMatch[0]);
      html = wrap(before.trimEnd())
        + '<div style="text-align:center;margin:22px 0"><a href="' + acceptMatch[0] + '" '
        + 'style="background:linear-gradient(180deg,#22b558,#0f803a);color:#ffffff;text-decoration:none;font-weight:700;'
        + 'font-family:Arial,Helvetica,sans-serif;font-size:16px;padding:15px 36px;border-radius:10px;display:inline-block;'
        + 'box-shadow:inset 0 1px 0 rgba(255,255,255,.3), 0 3px 0 #0c6b30, 0 7px 16px rgba(22,163,74,.35)">'
        + '&#10003; Click here to accept this quote</a></div>'
        + wrap((after || '').trimStart());
    } else {
      html = wrap(body);
    }
    // Every customer email ends with both ways to reach us.
    html += '<div style="text-align:center;margin:24px 0 4px">'
      + '<a href="tel:01634971005" style="background:#e04e1b;color:#fff;text-decoration:none;font-weight:700;font-family:Arial,sans-serif;font-size:14px;padding:12px 22px;border-radius:9px;display:inline-block;margin:4px">&#128222; Call 01634 971005</a>'
      + '<a href="https://wa.me/447359917380" style="background:#1EBE57;color:#fff;text-decoration:none;font-weight:700;font-family:Arial,sans-serif;font-size:14px;padding:12px 22px;border-radius:9px;display:inline-block;margin:4px">&#128172; WhatsApp us</a>'
      + '</div>';

    const payload = {
      from: 'Medway & Kent Removals <quotes@medwaykentremovals.co.uk>',
      to: [to],
      bcc: ['info@medwaykentremovals.co.uk'],
      reply_to: 'info@medwaykentremovals.co.uk',
      subject,
      text: body,
      html,
    };
    if (pdf_base64) {
      payload.attachments = [{ filename: filename || 'MKR-Quote.pdf', content: pdf_base64 }];
    }

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const t = await r.text();
      return res.status(502).json({ error: `resend ${r.status}: ${t}` });
    }

    // Record it on the lead for your own history (best-effort).
    if (lead_id) { try { await appendNote(lead_id, `${kind || 'Quote'} emailed to ${to}`); } catch {} }

    return res.status(200).json({ success: true });
  } catch (e) {
    console.error('send-quote', e);
    return res.status(500).json({ error: String(e.message || e) });
  }
}