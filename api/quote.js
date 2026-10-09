// ════════════════════════════════════════════════════════════
//  Medway & Kent Removals — Quote Handler
//  Vercel Serverless Function  /api/quote
//
//  Handles two things on every form submission:
//  1. Sends an email alert to you via Resend
//  2. Inserts the lead into Neon Postgres for your records
//
//  Environment variables required in Vercel (never in code):
//    RESEND_API_KEY
//    DATABASE_URL  (Neon connection string)
// ════════════════════════════════════════════════════════════

export default async function handler(req, res) {

  // ── Only accept POST requests ──
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Pull environment variables ──
  const RESEND_API_KEY  = process.env.RESEND_API_KEY;

  // ── Destructure form data from request body ──
  const {
    fname,
    lname,
    phone,
    email,
    service,
    from_postcode,
    to_postcode,
    property_size,
    move_date,
    access,
    notes,
  } = req.body;

  const fullName  = `${fname || ''} ${lname || ''}`.trim() || 'Customer';
  const moveLabel = move_date || 'Not specified';
  const notesText = notes    || 'None provided';
  const accessText= access   || 'None specified';

  // ── Sanitize phone for tel: link (strip spaces, brackets, dashes; keep + and digits) ──
  // This is THE fix for the broken "Call Customer" button — tel: URLs reject spaces/brackets.
  const phoneClean    = (phone || '').replace(/[^\d+]/g, '');
  const phoneDisplay  = phone || '(no phone provided)';
  const emailDisplay  = email || '(no email provided)';
  const emailClean    = (email || '').trim();

  // ── Escape HTML to prevent injection in email ──
  const esc = (s) => String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

  // ════════════════════════════════════════════════════════
  //  1. RESEND — Email alert to info@medwaykentremovals.co.uk
  // ════════════════════════════════════════════════════════
  const emailHtml = `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
          <div style="background:#0d1f3c;padding:24px 32px;border-radius:8px 8px 0 0">
            <h1 style="color:#ffffff;font-size:20px;margin:0">New Quote Request</h1>
            <p style="color:#ff9a75;margin:6px 0 0;font-size:14px">Medway &amp; Kent Removals</p>
          </div>
          <div style="background:#f8f8f8;padding:28px 32px;border-radius:0 0 8px 8px;border:1px solid #e0e0e0">

            <table style="width:100%;border-collapse:collapse;font-size:15px">
              <tr><td style="padding:10px 0;border-bottom:1px solid #e8e8e8;color:#666;width:40%">Name</td>
                  <td style="padding:10px 0;border-bottom:1px solid #e8e8e8;font-weight:600;color:#111">${esc(fullName)}</td></tr>
              <tr><td style="padding:10px 0;border-bottom:1px solid #e8e8e8;color:#666">Phone</td>
                  <td style="padding:10px 0;border-bottom:1px solid #e8e8e8;font-weight:600;color:#111">
                    <a href="tel:${esc(phoneClean)}" style="color:#e04e1b;text-decoration:underline">${esc(phoneDisplay)}</a></td></tr>
              <tr><td style="padding:10px 0;border-bottom:1px solid #e8e8e8;color:#666">Email</td>
                  <td style="padding:10px 0;border-bottom:1px solid #e8e8e8;font-weight:600;color:#111">
                    <a href="mailto:${esc(emailClean)}" style="color:#e04e1b;text-decoration:underline">${esc(emailDisplay)}</a></td></tr>
              <tr><td style="padding:10px 0;border-bottom:1px solid #e8e8e8;color:#666">Service</td>
                  <td style="padding:10px 0;border-bottom:1px solid #e8e8e8;font-weight:600;color:#111">${esc(service)}</td></tr>
              <tr><td style="padding:10px 0;border-bottom:1px solid #e8e8e8;color:#666">Moving from</td>
                  <td style="padding:10px 0;border-bottom:1px solid #e8e8e8;font-weight:600;color:#111">${esc(from_postcode)}</td></tr>
              <tr><td style="padding:10px 0;border-bottom:1px solid #e8e8e8;color:#666">Moving to</td>
                  <td style="padding:10px 0;border-bottom:1px solid #e8e8e8;font-weight:600;color:#111">${esc(to_postcode)}</td></tr>
              <tr><td style="padding:10px 0;border-bottom:1px solid #e8e8e8;color:#666">Property size</td>
                  <td style="padding:10px 0;border-bottom:1px solid #e8e8e8;font-weight:600;color:#111">${esc(property_size || 'Not specified')}</td></tr>
              <tr><td style="padding:10px 0;border-bottom:1px solid #e8e8e8;color:#666">Preferred date</td>
                  <td style="padding:10px 0;border-bottom:1px solid #e8e8e8;font-weight:600;color:#111">${esc(moveLabel)}</td></tr>
              <tr><td style="padding:10px 0;border-bottom:1px solid #e8e8e8;color:#666">Access issues</td>
                  <td style="padding:10px 0;border-bottom:1px solid #e8e8e8;font-weight:600;color:#111">${esc(accessText)}</td></tr>
              <tr><td style="padding:10px 0;color:#666;vertical-align:top">Notes</td>
                  <td style="padding:10px 0;font-weight:600;color:#111">${esc(notesText)}</td></tr>
            </table>

            <!--
              Email-safe button block.
              Using a TABLE (not flexbox) because Gmail, Outlook desktop and
              several mobile clients strip display:flex which can collapse
              the buttons or render them on top of each other.
              Each button is a real <a> anchor so the tap-to-call link works
              in every email app.
            -->
            <table cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin-top:28px">
              <tr>
                <td style="padding-right:10px">
                  <a href="tel:${esc(phoneClean)}"
                     style="display:inline-block;background:#e04e1b;color:#ffffff;padding:14px 26px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px;line-height:1;mso-padding-alt:0">
                    &#128222; Call ${esc(fullName)}
                  </a>
                </td>
                <td style="padding-right:10px">
                  <a href="mailto:${esc(emailClean)}?subject=${encodeURIComponent('Re: Your removal quote enquiry')}"
                     style="display:inline-block;background:#0d1f3c;color:#ffffff;padding:14px 26px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px;line-height:1;mso-padding-alt:0">
                    &#9993; Email ${esc(fname || 'Customer')}
                  </a>
                </td>
                <td>
                  <a href="https://wa.me/${esc(phoneClean.replace(/^\+/, ''))}"
                     style="display:inline-block;background:#25d366;color:#ffffff;padding:14px 22px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px;line-height:1;mso-padding-alt:0">
                    WhatsApp
                  </a>
                </td>
              </tr>
            </table>

            <p style="margin-top:18px;font-size:12px;color:#999;line-height:1.5">
              <strong>Tip:</strong> on iPhone or Android the Call button dials directly. On Mac
              you'll need FaceTime, your iPhone within range (Continuity Call), or another
              phone-handler app set as the default for tel: links.
            </p>

            <p style="margin-top:14px;font-size:12px;color:#999">
              Submitted via medwaykentremovals.co.uk contact form &bull;
              ${esc(new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' }))}
            </p>
          </div>
        </div>
      `;

  const resendPromise = fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: 'MKR Quotes <quotes@medwaykentremovals.co.uk>',
      to:   ['info@medwaykentremovals.co.uk'],
      reply_to: emailClean || undefined,
      subject: `New quote request — ${fullName} — ${service || 'Removal'}`,
      html: emailHtml,
    }),
  });

  // ════════════════════════════════════════════════════════
  //  2. NEON — Insert row into quote_requests
  // ════════════════════════════════════════════════════════
  // quote.js is CommonJS-style, so the ES-module DB helper must be loaded with a
  // dynamic import (a static import fails with ERR_REQUIRE_ESM on Vercel).
  const dbPromise = import('./admin/_sql.mjs').then(({ q }) => q(
    `INSERT INTO quote_requests
       (name, phone, email, service, from_postcode, to_postcode, property_size, move_date, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [fullName, phone, email, service, from_postcode, to_postcode,
     property_size || '', move_date || '', `Access: ${accessText} | ${notesText}`],
  ));

  // ════════════════════════════════════════════════════════
  //  Run both in parallel — don't let one block another
  // ════════════════════════════════════════════════════════
  const results = await Promise.allSettled([
    resendPromise,
    dbPromise,
  ]);

  // Log any failures server-side (visible in Vercel logs)
  results.forEach((result, i) => {
    const label = ['Resend', 'Database'][i];
    if (result.status === 'rejected') {
      console.error(`${label} failed:`, result.reason);
    }
  });

  // Always return success to the customer — failures are logged not shown
  return res.status(200).json({ success: true });
}
