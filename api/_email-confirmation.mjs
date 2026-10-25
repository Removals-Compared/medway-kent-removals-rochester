// ════════════════════════════════════════════════════════════
//  Booking confirmation email: company letterhead, then clearly separated
//  blocks (move details, collection and delivery, payment, next steps).
//  Pure function: returns an HTML string. The logo is attached by cid
//  (see sendEmail in pay.mjs). Table layout with inline styles so it holds
//  up in Gmail, Outlook and Apple Mail. The leading underscore keeps this
//  file from being deployed as its own serverless function.
// ════════════════════════════════════════════════════════════
const ORANGE = '#e04e1b';
const NAVY = '#16294a';
const INK = '#1d2433';
const MUTED = '#667085';
const LINE = '#e8e2d6';
const PAPER = '#faf7f2';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const COMPANY = {
  name: 'Medway & Kent Removals',
  tagline: 'Professional removals across Kent',
  address: 'Knight Templar Way, Rochester, Kent ME2 2ZE',
  phone: '01634 971005',
  whatsapp: '07359 917380',
  whatsappLink: 'https://wa.me/447359917380',
  email: 'info@medwaykentremovals.co.uk',
  web: 'www.medwaykentremovals.co.uk',
  companyNo: '17190871',
};

const label = (t) => `<div style="font-size:11px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:${ORANGE};margin:0 0 8px">${esc(t)}</div>`;

const section = (title, inner) => `
    <tr><td style="padding:22px 32px 0">
      ${label(title)}
      ${inner}
    </td></tr>`;

const kvTable = (rows) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:15px">${
  rows.filter((r) => r && r[1]).map(([k, v], i, a) => `
      <tr>
        <td style="padding:10px 0;color:${MUTED};width:42%;vertical-align:top;${i < a.length - 1 ? `border-bottom:1px solid ${LINE};` : ''}">${esc(k)}</td>
        <td style="padding:10px 0;color:${INK};font-weight:600;vertical-align:top;${i < a.length - 1 ? `border-bottom:1px solid ${LINE};` : ''}">${esc(v)}</td>
      </tr>`).join('')}</table>`;

// "13 Road, Town, ME2 2ZE" -> one part per line, postcode last and bold
function addressBlock(title, addr) {
  const parts = String(addr || '').split(',').map((p) => p.trim()).filter(Boolean);
  const lines = parts.map((p, i) => (i === parts.length - 1
    ? `<strong style="color:${INK}">${esc(p)}</strong>`
    : esc(p))).join('<br>');
  return `<td width="48%" valign="top" style="background:${PAPER};border:1px solid ${LINE};border-radius:10px;padding:14px 16px">
        <div style="font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:${MUTED};margin-bottom:6px">${esc(title)}</div>
        <div style="font-size:14.5px;line-height:1.55;color:${INK}">${lines || '-'}</div>
      </td>`;
}

const step = (n, text) => `
      <tr>
        <td width="30" valign="top" style="padding:7px 0"><div style="width:22px;height:22px;border-radius:11px;background:${ORANGE};color:#fff;font-size:12px;font-weight:700;line-height:22px;text-align:center">${n}</div></td>
        <td style="padding:7px 0 7px 6px;font-size:14.5px;line-height:1.55;color:${INK}">${text}</td>
      </tr>`;

/**
 * data: {
 *   audience: 'customer' | 'office',
 *   firstName, name, phone, email,
 *   ref, issued, moveDate, size, vans,
 *   from, to,
 *   price, paid, paidLabel, balance, balanceNote,
 *   packing (bool)
 * }
 */
export function confirmationEmail(d) {
  const office = d.audience === 'office';
  const heading = office ? 'New paid booking' : 'You are booked in';
  const intro = office
    ? `${esc(d.name)} has just paid online. The details are below.`
    : `Thank you ${esc(d.firstName || 'for booking')}, your payment has gone through and your move is booked. This is your confirmation: please keep it for your records.`;

  const moveRows = [
    ['Move date', d.moveDate],
    ['Property', d.size],
    ['Vehicles', d.vans ? `${d.vans} van${d.vans > 1 ? 's' : ''} with crew` : ''],
    ['Packing', d.packing ? 'We will call you to discuss it after your survey' : ''],
  ];

  const payRows = `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:15px">
        <tr><td style="padding:10px 0;color:${MUTED};border-bottom:1px solid ${LINE}">Move price (fixed, no VAT)</td><td align="right" style="padding:10px 0;color:${INK};font-weight:600;border-bottom:1px solid ${LINE}">${esc(d.price)}</td></tr>
        <tr><td style="padding:10px 0;color:${MUTED};border-bottom:1px solid ${LINE}">${esc(d.paidLabel)}</td><td align="right" style="padding:10px 0;color:#1b7a46;font-weight:700;border-bottom:1px solid ${LINE}">${esc(d.paid)}</td></tr>
        <tr><td colspan="2" style="padding:12px 0 0">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${NAVY};border-radius:10px"><tr>
            <td style="padding:14px 16px;color:#cfd8ea;font-size:13px;line-height:1.4">Balance due on the day<br><span style="color:#9fb0cc;font-size:12px">${esc(d.balanceNote)}</span></td>
            <td align="right" style="padding:14px 16px;color:#ffffff;font-size:22px;font-weight:700">${esc(d.balance)}</td>
          </tr></table>
        </td></tr>
      </table>`;

  const next = office
    ? [
      `Call ${esc(d.name)} on <a href="tel:${esc(String(d.phone || '').replace(/[^\d+]/g, ''))}" style="color:${ORANGE};font-weight:700;text-decoration:none">${esc(d.phone || '')}</a> to confirm the arrival time.`,
      d.packing ? 'The customer wants to discuss packing: arrange a free survey.' : 'No packing requested.',
      d.balance && d.balance !== '£0' ? `Collect the balance of <strong>${esc(d.balance)}</strong> on the day.` : 'Nothing to collect on the day: paid in full.',
    ]
    : [
      'We will call you shortly before moving day to confirm your arrival time.',
      d.packing ? 'Because you asked about packing, we will call to arrange a free survey and discuss it.' : 'Need packing or anything else? Just reply to this email or call us.',
      d.balance && d.balance !== '£0' ? `Pay the remaining <strong>${esc(d.balance)}</strong> to the crew on the day by card, bank transfer or cash.` : 'You have paid in full, so there is nothing to pay on the day.',
    ];

  const customerBlock = office
    ? section('Customer', kvTable([['Name', d.name], ['Phone', d.phone], ['Email', d.email]]))
    : '';

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(heading)}</title></head>
<body style="margin:0;padding:0;background:#f1ede4">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1ede4"><tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:12px;font-family:Arial,Helvetica,sans-serif;color:${INK}">

    <!-- Letterhead -->
    <tr><td style="background:${ORANGE};border-radius:12px 12px 0 0">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="padding:22px 0 22px 28px;width:116px" valign="middle"><img src="cid:mkrlogo" width="116" height="56" alt="${esc(COMPANY.name)}" style="display:block;border:0;border-radius:10px"></td>
        <td style="padding:22px 12px 22px 16px" valign="middle">
          <div style="color:#fff;font-size:21px;font-weight:700;line-height:1.2">${esc(COMPANY.name)}</div>
          <div style="color:#ffe3d6;font-size:12.5px;margin-top:3px">${esc(COMPANY.tagline)}</div>
        </td>
        <td align="right" style="padding:22px 28px 22px 0" valign="middle">
          <div style="color:#ffe3d6;font-size:10.5px;font-weight:700;letter-spacing:1.6px">BOOKING CONFIRMATION</div>
          <div style="color:#fff;font-size:15px;font-weight:700;margin-top:3px">${esc(d.ref)}</div>
          <div style="color:#ffe3d6;font-size:12px;margin-top:2px">${esc(d.issued)}</div>
        </td>
      </tr></table>
    </td></tr>
    <tr><td style="background:${NAVY};height:4px;line-height:4px;font-size:0">&nbsp;</td></tr>

    <!-- Greeting -->
    <tr><td style="padding:28px 32px 0">
      <h1 style="margin:0 0 10px;font-size:24px;line-height:1.25;color:${NAVY}">${esc(heading)}</h1>
      <p style="margin:0;font-size:15px;line-height:1.65;color:${INK}">${intro}</p>
    </td></tr>

    ${section('Move details', kvTable(moveRows))}

    ${section('Collection and delivery', `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        ${addressBlock('Collection', d.from)}
        <td width="4%" style="font-size:0;line-height:0">&nbsp;</td>
        ${addressBlock('Delivery', d.to)}
      </tr></table>`)}

    ${section('Payment summary', payRows)}

    ${customerBlock}

    ${section(office ? 'To do' : 'What happens next', `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${next.map((t, i) => step(i + 1, t)).join('')}</table>`)}

    <tr><td style="padding:22px 32px 0">
      <p style="margin:0;font-size:13px;line-height:1.6;color:${MUTED}">Free cancellation: reply to this email or call ${esc(COMPANY.phone)} and everything you paid is refunded.</p>
    </td></tr>

    <!-- Contact buttons -->
    <tr><td align="center" style="padding:22px 32px 6px">
      <a href="tel:${COMPANY.phone.replace(/\s/g, '')}" style="background:${ORANGE};color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 24px;border-radius:9px;display:inline-block;margin:4px">Call ${esc(COMPANY.phone)}</a>
      <a href="${COMPANY.whatsappLink}" style="background:#1EBE57;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 24px;border-radius:9px;display:inline-block;margin:4px">WhatsApp us</a>
    </td></tr>

    <!-- Letterhead footer -->
    <tr><td style="padding:26px 32px 28px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:2px solid ${ORANGE}"><tr><td style="padding-top:16px;text-align:center;font-size:12px;line-height:1.7;color:${MUTED}">
        <strong style="color:${NAVY};font-size:13px">${esc(COMPANY.name)}</strong><br>
        ${esc(COMPANY.address)}<br>
        Tel ${esc(COMPANY.phone)} &nbsp;·&nbsp; WhatsApp ${esc(COMPANY.whatsapp)}<br>
        ${esc(COMPANY.email)} &nbsp;·&nbsp; ${esc(COMPANY.web)}<br>
        <span style="color:#98a2b3">Registered in England and Wales, company number ${esc(COMPANY.companyNo)}. Fully insured: goods in transit and public liability.</span>
      </td></tr></table>
    </td></tr>

  </table>
</td></tr></table>
</body></html>`;
}
