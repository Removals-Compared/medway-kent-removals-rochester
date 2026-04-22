// ════════════════════════════════════════════════════════════
//  Medway & Kent Removals — Quote Handler
//  Vercel Serverless Function  /api/quote
//
//  Handles three things on every form submission:
//  1. Sends an email alert to you via Resend
//  2. Creates a Contact + Deal in HubSpot CRM
//  3. Inserts the lead into Supabase for your records
//
//  Environment variables required in Vercel (never in code):
//    RESEND_API_KEY
//    HUBSPOT_TOKEN
//    SUPABASE_URL
//    SUPABASE_KEY
// ════════════════════════════════════════════════════════════

export default async function handler(req, res) {

  // ── Only accept POST requests ──
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Pull environment variables ──
  const RESEND_API_KEY  = process.env.RESEND_API_KEY;
  const HUBSPOT_TOKEN   = process.env.HUBSPOT_TOKEN;
  const SUPABASE_URL    = process.env.SUPABASE_URL;
  const SUPABASE_KEY    = process.env.SUPABASE_KEY;

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

  const fullName  = `${fname} ${lname}`.trim();
  const moveLabel = move_date || 'Not specified';
  const notesText = notes    || 'None provided';
  const accessText= access   || 'None specified';

  // ════════════════════════════════════════════════════════
  //  1. RESEND — Email alert to info@medwaykentremovals.co.uk
  // ════════════════════════════════════════════════════════
  const resendPromise = fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: 'MKR Quotes <quotes@medwaykentremovals.co.uk>',
      to:   ['info@medwaykentremovals.co.uk'],
      subject: `New quote request — ${fullName} — ${service}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
          <div style="background:#0d1f3c;padding:24px 32px;border-radius:8px 8px 0 0">
            <h1 style="color:#ffffff;font-size:20px;margin:0">New Quote Request</h1>
            <p style="color:#ff9a75;margin:6px 0 0;font-size:14px">Medway &amp; Kent Removals</p>
          </div>
          <div style="background:#f8f8f8;padding:28px 32px;border-radius:0 0 8px 8px;border:1px solid #e0e0e0">

            <table style="width:100%;border-collapse:collapse;font-size:15px">
              <tr><td style="padding:10px 0;border-bottom:1px solid #e8e8e8;color:#666;width:40%">Name</td>
                  <td style="padding:10px 0;border-bottom:1px solid #e8e8e8;font-weight:600;color:#111">${fullName}</td></tr>
              <tr><td style="padding:10px 0;border-bottom:1px solid #e8e8e8;color:#666">Phone</td>
                  <td style="padding:10px 0;border-bottom:1px solid #e8e8e8;font-weight:600;color:#111">
                    <a href="tel:${phone}" style="color:#e04e1b">${phone}</a></td></tr>
              <tr><td style="padding:10px 0;border-bottom:1px solid #e8e8e8;color:#666">Email</td>
                  <td style="padding:10px 0;border-bottom:1px solid #e8e8e8;font-weight:600;color:#111">
                    <a href="mailto:${email}" style="color:#e04e1b">${email}</a></td></tr>
              <tr><td style="padding:10px 0;border-bottom:1px solid #e8e8e8;color:#666">Service</td>
                  <td style="padding:10px 0;border-bottom:1px solid #e8e8e8;font-weight:600;color:#111">${service}</td></tr>
              <tr><td style="padding:10px 0;border-bottom:1px solid #e8e8e8;color:#666">Moving from</td>
                  <td style="padding:10px 0;border-bottom:1px solid #e8e8e8;font-weight:600;color:#111">${from_postcode}</td></tr>
              <tr><td style="padding:10px 0;border-bottom:1px solid #e8e8e8;color:#666">Moving to</td>
                  <td style="padding:10px 0;border-bottom:1px solid #e8e8e8;font-weight:600;color:#111">${to_postcode}</td></tr>
              <tr><td style="padding:10px 0;border-bottom:1px solid #e8e8e8;color:#666">Property size</td>
                  <td style="padding:10px 0;border-bottom:1px solid #e8e8e8;font-weight:600;color:#111">${property_size || 'Not specified'}</td></tr>
              <tr><td style="padding:10px 0;border-bottom:1px solid #e8e8e8;color:#666">Preferred date</td>
                  <td style="padding:10px 0;border-bottom:1px solid #e8e8e8;font-weight:600;color:#111">${moveLabel}</td></tr>
              <tr><td style="padding:10px 0;border-bottom:1px solid #e8e8e8;color:#666">Access issues</td>
                  <td style="padding:10px 0;border-bottom:1px solid #e8e8e8;font-weight:600;color:#111">${accessText}</td></tr>
              <tr><td style="padding:10px 0;color:#666;vertical-align:top">Notes</td>
                  <td style="padding:10px 0;font-weight:600;color:#111">${notesText}</td></tr>
            </table>

            <div style="margin-top:28px;display:flex;gap:12px">
              <a href="tel:${phone}"
                 style="display:inline-block;background:#e04e1b;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px">
                Call ${fullName}
              </a>
              <a href="mailto:${email}"
                 style="display:inline-block;background:#0d1f3c;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px">
                Email ${fname}
              </a>
            </div>

            <p style="margin-top:24px;font-size:12px;color:#999">
              Submitted via medwaykentremovals.co.uk contact form &bull;
              ${new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' })}
            </p>
          </div>
        </div>
      `,
    }),
  });

  // ════════════════════════════════════════════════════════
  //  2. HUBSPOT — Create Contact then attach a Deal
  // ════════════════════════════════════════════════════════
  const hubspotPromise = fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${HUBSPOT_TOKEN}`,
    },
    body: JSON.stringify({
      properties: {
        firstname:       fname,
        lastname:        lname,
        phone:           phone,
        email:           email,
        hs_lead_status:  'NEW',
        lifecyclestage:  'lead',
        message: [
          `Service: ${service}`,
          `From: ${from_postcode}`,
          `To: ${to_postcode}`,
          `Property: ${property_size || 'Not specified'}`,
          `Date: ${moveLabel}`,
          `Access: ${accessText}`,
          `Notes: ${notesText}`,
        ].join(' | '),
      },
    }),
  })
  .then(r => r.json())
  .then(async contact => {
    if (!contact || !contact.id) return;

    // Attach a Deal to the Contact
    await fetch('https://api.hubapi.com/crm/v3/objects/deals', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${HUBSPOT_TOKEN}`,
      },
      body: JSON.stringify({
        properties: {
          dealname:    `Quote — ${fullName} (${service})`,
          dealstage:   'appointmentscheduled',
          pipeline:    'default',
          closedate:   move_date ? new Date(move_date).getTime().toString() : '',
          description: [
            `From ${from_postcode} to ${to_postcode}`,
            `Property: ${property_size || 'Not specified'}`,
            `Access: ${accessText}`,
            `Notes: ${notesText}`,
          ].join(' | '),
        },
        associations: [{
          to:    { id: contact.id },
          types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }],
        }],
      }),
    });
  });

  // ════════════════════════════════════════════════════════
  //  3. SUPABASE — Insert row into quote_requests
  // ════════════════════════════════════════════════════════
  const supabasePromise = fetch(`${SUPABASE_URL}/rest/v1/quote_requests`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer':        'return=minimal',
    },
    body: JSON.stringify({
      name:          fullName,
      phone:         phone,
      email:         email,
      service:       service,
      from_postcode: from_postcode,
      to_postcode:   to_postcode,
      property_size: property_size || '',
      move_date:     move_date     || '',
      notes:         `Access: ${accessText} | ${notesText}`,
    }),
  });

  // ════════════════════════════════════════════════════════
  //  Run all three in parallel — don't let one block another
  // ════════════════════════════════════════════════════════
  const results = await Promise.allSettled([
    resendPromise,
    hubspotPromise,
    supabasePromise,
  ]);

  // Log any failures server-side (visible in Vercel logs)
  results.forEach((result, i) => {
    const label = ['Resend', 'HubSpot', 'Supabase'][i];
    if (result.status === 'rejected') {
      console.error(`${label} failed:`, result.reason);
    }
  });

  // Always return success to the customer — failures are logged not shown
  return res.status(200).json({ success: true });
}
