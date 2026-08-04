import { requireAuth } from '../_session.mjs';
import {
  getQuote, updateQuote, deleteQuote, fetchAppointmentsByLeadIds,
  fetchRemindersByLeadIds, appendNote,
} from '../_db.mjs';

const REVIEW_LINK = 'https://g.page/r/CULm9CaG1nsvEAI/review';

// When a move is marked completed, thank the customer and ask for a Google
// review. Sent once per lead (the admin note is the dedupe marker); any
// failure here must never block the status update itself.
async function sendReviewRequest(quote) {
  const first = (quote.name || 'there').split(' ')[0];
  const text = [
    `Hi ${first},`,
    '',
    'Thank you for choosing Medway and Kent Removals for your move. It was a pleasure to help you, and we hope you are settling in well in your new home.',
    '',
    'If you have two minutes, a quick Google review would mean a great deal to our small team. It is the best way to help other families in Kent find us:',
    '',
    REVIEW_LINK,
    '',
    'Just tap the stars and write a line or two, then press Post. Google may ask a few extra questions about price, and you can skip those completely.',
    '',
    'If anything was not perfect, please reply to this email instead and we will put it right.',
    '',
    'Thanks again,',
    'Medway and Kent Removals',
    '01634 971005',
  ].join('\n');
  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#222;line-height:1.6">
    <p>Hi ${esc(first)},</p>
    <p>Thank you for choosing Medway and Kent Removals for your move. It was a pleasure to help you, and we hope you are settling in well in your new home.</p>
    <p>If you have two minutes, a quick Google review would mean a great deal to our small team. It is the best way to help other families in Kent find us:</p>
    <p style="margin:22px 0"><a href="${REVIEW_LINK}" style="background:#E04E1B;color:#fff;text-decoration:none;font-weight:700;padding:12px 26px;border-radius:8px;display:inline-block">Leave us a Google review</a></p>
    <p style="color:#555;font-size:13.5px">Just tap the stars and write a line or two, then press Post. Google may ask a few extra questions about price, and you can skip those completely.</p>
    <p>If anything was not perfect, please reply to this email instead and we will put it right.</p>
    <p>Thanks again,<br>Medway and Kent Removals<br>01634 971005</p>
  </div>`;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    body: JSON.stringify({
      from: 'Medway & Kent Removals <quotes@medwaykentremovals.co.uk>',
      to: [quote.email],
      bcc: ['info@medwaykentremovals.co.uk'],
      reply_to: 'info@medwaykentremovals.co.uk',
      subject: 'Thank you from Medway and Kent Removals',
      text, html,
    }),
  });
  if (!r.ok) throw new Error(`resend ${r.status}: ${await r.text()}`);
}

export default async function handler(req, res) {
  const role = requireAuth(req, res);
  if (!role) return;

  // Defensive: strip any ".html" the rewrite/cleanUrls layer might leave on.
  let id = req.query.id;
  if (typeof id === 'string') id = id.replace(/\.html$/, '');

  try {
    if (req.method === 'GET') {
      const quote = await getQuote(id);
      if (!quote) return res.status(404).json({ error: 'not found' });
      const appointments = await fetchAppointmentsByLeadIds([id]);
      const reminders = await fetchRemindersByLeadIds([id]);
      // Staff sessions never receive money fields — stripped server-side.
      if (role === 'staff') delete quote.value;
      return res.status(200).json({ quote, appointments, reminders, role, staff_name: role === 'staff' ? (req._staffName || process.env.STAFF_NAME || 'Staff') : undefined });
    }

    if (req.method === 'PATCH') {
      const b = req.body || {};

      // Manual (re)send of the review request from the lead page button —
      // no dedupe here, the admin explicitly asked for it.
      if (b.resend_review === true) {
        const q = await getQuote(id);
        if (!q) return res.status(404).json({ error: 'not found' });
        if (!q.email) return res.status(400).json({ error: 'no email on this lead' });
        try {
          await sendReviewRequest(q);
          await appendNote(id, `Review request emailed to ${q.email}`);
          if (role === 'staff') delete q.value;
          return res.status(200).json({ quote: q, review_request: 'sent', role });
        } catch (e) {
          console.error('review resend', e);
          return res.status(502).json({ error: String(e.message || e) });
        }
      }

      const fields = { updated_at: new Date().toISOString() };

      // Editable lead details — empty string clears the column to null.
      const editable = [
        'name', 'phone', 'email', 'service', 'from_postcode',
        'to_postcode', 'property_size', 'move_date', 'notes', 'address',
      ];
      editable.forEach((k) => {
        if (b[k] !== undefined) fields[k] = b[k] === '' ? null : b[k];
      });

      if (b.status !== undefined) fields.status = b.status;
      if (b.value !== undefined && role !== 'staff') {
        fields.value = b.value === '' || b.value === null ? null : Number(b.value);
      }

      // Review request is sent only when the admin explicitly confirmed it
      // (send_review flag from the lead page prompt) — never automatically.
      let prev = null;
      if (b.status === 'won' && b.send_review === true) { try { prev = await getQuote(id); } catch {} }

      const quote = await updateQuote(id, fields);

      let review_request = null;
      if (b.status === 'won' && b.send_review === true && prev && prev.status !== 'won') {
        const alreadyAsked = Array.isArray(prev.admin_notes)
          && prev.admin_notes.some((n) => String(n && n.text).includes('Review request emailed'));
        if (!alreadyAsked && prev.email) {
          try {
            await sendReviewRequest(prev);
            await appendNote(id, `Review request emailed to ${prev.email}`);
            review_request = 'sent';
          } catch (e) {
            console.error('review request', e);
            review_request = 'failed';
          }
        }
      }
      if (role === 'staff') delete quote.value;
      return res.status(200).json({ quote, review_request, role });
    }

    if (req.method === 'DELETE') {
      await deleteQuote(id);
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    console.error('quote/[id].js', e);
    return res.status(500).json({ error: String(e.message || e) });
  }
}
