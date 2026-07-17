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
  if (!requireAuth(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  try {
    const { lead_id, to, subject, body, pdf_base64, filename } = req.body || {};
    if (!to || !subject || !body) {
      return res.status(400).json({ error: 'to, subject and body are required' });
    }

    const html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#222;line-height:1.6;white-space:pre-wrap">'
      + esc(body) + '</div>';

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
    if (lead_id) { try { await appendNote(lead_id, `Quote emailed to ${to}`); } catch {} }

    return res.status(200).json({ success: true });
  } catch (e) {
    console.error('send-quote', e);
    return res.status(500).json({ error: String(e.message || e) });
  }
}