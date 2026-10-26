// ════════════════════════════════════════════════════════════
//  Cron endpoint — runs daily (see vercel.json "crons").
//  Emails a call reminder for every reminder whose date has arrived.
//  Secured by CRON_SECRET: Vercel adds "Authorization: Bearer <CRON_SECRET>"
//  to cron requests when that env var is set. Set CRON_SECRET in Vercel.
// ════════════════════════════════════════════════════════════
import { fetchDueReminders, markReminderSent, getQuote, fetchExpiredDeleted, deleteQuote, logActivity, appendNote } from './_db.mjs';
import { q } from './_sql.mjs';
import { sendMail } from './_email.mjs';

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

  // ── ?welcome=1 (cron, every 5 minutes): the automatic "we will be in
  //    touch shortly" email to fresh website leads. Sent once per lead,
  //    5 to 60 minutes after the enquiry, while it is still status new;
  //    the "Welcome email sent" note is the dedupe marker. ──
  if (req.query && req.query.welcome) {
    const out = { checked: 0, sent: 0, errors: [] };
    try {
      const fresh = await q(
        `SELECT * FROM quote_requests
          WHERE created_at <= now() - interval '5 minutes'
            AND created_at >  now() - interval '60 minutes'
            AND email IS NOT NULL AND email <> ''
            AND source = 'website'
            AND (status IS NULL OR status = 'new')
          ORDER BY created_at ASC LIMIT 20`,
      );
      for (const lead of fresh) {
        out.checked++;
        const notes = Array.isArray(lead.admin_notes) ? lead.admin_notes : [];
        if (notes.some((n) => /^Welcome email sent/.test(String(n && n.text)))) continue;
        const first = (lead.name || 'there').split(' ')[0];
        const waText = `Hi, it's ${lead.name || 'a customer'} about my removals enquiry.`;
        const waHref = 'https://wa.me/447359917380?text=' + encodeURIComponent(waText);
        const lines = [
          `Hi ${first},`, '',
          `Thanks for your ${lead.service || 'removals'} enquiry with Medway and Kent Removals. It has landed safely with the team and one of us will be in touch with you shortly.`, '',
          'If it is easier, you can start a WhatsApp chat with us right away using the green button below, or call us on 01634 971005.', '',
          'Best regards,', 'Medway and Kent Removals', '01634 971005 | WhatsApp 07359 917380',
        ];
        const text = lines.join('\n');
        const html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#222;line-height:1.6;white-space:pre-wrap">' + esc(text) + '</div>'
          + '<div style="text-align:center;margin:22px 0 4px">'
          + '<a href="tel:01634971005" style="background:#E04E1B;color:#fff;text-decoration:none;font-weight:700;font-family:Arial,sans-serif;font-size:14px;padding:12px 22px;border-radius:9px;display:inline-block;margin:4px">&#128222; Call 01634 971005</a>'
          + '<a href="' + waHref + '" style="background:#1EBE57;color:#fff;text-decoration:none;font-weight:700;font-family:Arial,sans-serif;font-size:14px;padding:12px 22px;border-radius:9px;display:inline-block;margin:4px">&#128172; WhatsApp us</a>'
          + '</div>';
        try {
          await sendMail({
            to: [lead.email], bcc: [TO],
            subject: 'We have your removals enquiry', text, html,
          });
          await appendNote(lead.id, `Welcome email sent to ${lead.email} (automatic, 5 minutes after the enquiry)`);
          await logActivity({ actor: 'welcome-bot', action: 'sent welcome email', lead_id: lead.id, lead_name: lead.name });
          out.sent++;
        } catch (e) {
          out.errors.push({ id: lead.id, message: String(e.message || e) });
        }
      }
      return res.status(200).json(out);
    } catch (e) {
      console.error('welcome cron', e);
      return res.status(500).json({ error: String(e.message || e) });
    }
  }

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  const results = { checked: 0, sent: 0, errors: [] };

  try {
    const due = await fetchDueReminders(today);
    results.checked = due.length;

    for (const rem of due) {
      try {
        const lead = await getQuote(rem.lead_id);
        await sendMail({
          to: [TO],
          subject: `Call reminder: ${(lead && lead.name) || 'Customer'}${rem.note ? ' — ' + rem.note : ''}`,
          html: emailHtml(lead, rem),
        });
        await markReminderSent(rem.id);
        results.sent += 1;
      } catch (e) {
        results.errors.push({ id: rem.id, message: String(e.message || e) });
      }
    }

    // Recycle bin housekeeping: leads deleted more than 30 days ago are
    // purged for good. Best-effort — never fails the reminder run.
    try {
      const expired = await fetchExpiredDeleted(30);
      for (const q of expired) {
        await deleteQuote(q.id);
        await logActivity({ actor: 'System', action: 'purged', lead_id: q.id, lead_name: q.name, detail: 'recycle bin, 30 days' });
      }
      results.purged = expired.length;
    } catch (e) { results.purge_error = String(e.message || e); }

    return res.status(200).json({ ok: true, ...results });
  } catch (e) {
    console.error('reminders-run', e);
    return res.status(500).json({ ok: false, error: String(e.message || e), ...results });
  }
}
