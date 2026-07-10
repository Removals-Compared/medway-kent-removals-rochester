// ════════════════════════════════════════════════════════════
//  Cron endpoint — runs daily (see vercel.json "crons").
//  Emails a call reminder for every reminder whose date has arrived.
//  Secured by CRON_SECRET: Vercel adds "Authorization: Bearer <CRON_SECRET>"
//  to cron requests when that env var is set. Set CRON_SECRET in Vercel.
// ════════════════════════════════════════════════════════════
import { fetchDueReminders, markReminderSent, getQuote } from './_db.mjs';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const TO = 'info@medwaykentremovals.co.uk';
const SITE = 'https://www.medwaykentremovals.co.uk';

const esc = (s) => String(s || '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function emailHtml(lead, reminder) {
  const name = (lead && lead.name) || 'Customer';
  const phone = (lead && lead.phone) || '';
  const phoneClean = phone.replace(/[^\d+]/g, '');
  const note = reminder.note || 'Follow up with this customer.';
  const link = `${SITE}/admin/quote/${reminder.lead_id}`;
  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#0d1f3c;padding:24px 32px;border-radius:8px 8px 0 0">
        <h1 style="color:#fff;font-size:20px;margin:0">&#128222; Call reminder</h1>
        <p style="color:#ff9a75;margin:6px 0 0;font-size:14px">Medway &amp; Kent Removals</p>
      </div>
      <div style="background:#f8f8f8;padding:28px 32px;border:1px solid #e0e0e0;border-top:none;border-radius:0 0 8px 8px">
        <p style="font-size:16px;color:#111;margin:0 0 16px">Time to call <strong>${esc(name)}</strong>.</p>
        <table style="width:100%;border-collapse:collapse;font-size:15px">
          <tr><td style="padding:8px 0;color:#666;width:34%">Phone</td>
              <td style="padding:8px 0;font-weight:600">${phone ? `<a href="tel:${esc(phoneClean)}" style="color:#e04e1b">${esc(phone)}</a>` : '&mdash;'}</td></tr>
          <tr><td style="padding:8px 0;color:#666">Service</td>
              <td style="padding:8px 0;font-weight:600">${esc((lead && lead.service) || '&mdash;')}</td></tr>
          <tr><td style="padding:8px 0;color:#666;vertical-align:top">Reminder note</td>
              <td style="padding:8px 0;font-weight:600">${esc(note)}</td></tr>
        </table>
        <p style="margin-top:24px">
          <a href="${link}" style="display:inline-block;background:#e04e1b;color:#fff;padding:13px 26px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px">Open this lead</a>
        </p>
      </div>
    </div>`;
}

export default async function handler(req, res) {
  // ── Auth: only allow Vercel Cron (or a matching bearer token) ──
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.authorization || '';
  if (!secret || auth !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  const results = { checked: 0, sent: 0, errors: [] };

  try {
    const due = await fetchDueReminders(today);
    results.checked = due.length;

    for (const rem of due) {
      try {
        const lead = await getQuote(rem.lead_id);
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${RESEND_API_KEY}`,
          },
          body: JSON.stringify({
            from: 'MKR Reminders <quotes@medwaykentremovals.co.uk>',
            to: [TO],
            subject: `Call reminder: ${(lead && lead.name) || 'Customer'}${rem.note ? ' — ' + rem.note : ''}`,
            html: emailHtml(lead, rem),
          }),
        });
        if (!r.ok) throw new Error(`resend ${r.status}: ${await r.text()}`);
        await markReminderSent(rem.id);
        results.sent += 1;
      } catch (e) {
        results.errors.push({ id: rem.id, message: String(e.message || e) });
      }
    }

    return res.status(200).json({ ok: true, ...results });
  } catch (e) {
    console.error('reminders-run', e);
    return res.status(500).json({ ok: false, error: String(e.message || e), ...results });
  }
}
