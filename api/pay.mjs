// ════════════════════════════════════════════════════════════
//  Instant quote & pay  —  /api/pay
//
//  One function does both jobs, so it costs a single serverless slot:
//    • POST from the website            → price the move on the server, save
//      the lead as "awaiting payment", create a Stripe Checkout session and
//      return { url } for the browser to redirect to.
//    • POST from Stripe (stripe-signature header) → webhook: when the session
//      is paid, mark the lead booked, note it, email the office and customer.
//
//  Env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, DATABASE_URL,
//       GMAIL_USER, GMAIL_APP_PASS (same Gmail app password as the admin emails),
//       SITE_URL (optional),
//       STRIPE_TEST_AMOUNT_PENCE (optional; forces a tiny charge, ignored on
//       production so it can never touch a real customer).
// ════════════════════════════════════════════════════════════
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { createQuote, updateQuote, getQuote, appendNote, logActivity } from './admin/_db.mjs';
import { LOGO_PNG_B64 } from './_brand.mjs';
import { PRICES, isPostcode, tidyPostcode, journeyMinutes, hoursCharged, priceFor } from './_pricing.mjs';

// Stripe needs the exact raw bytes to check its signature.
export const config = { api: { bodyParser: false } };

const SITE = 'https://www.medwaykentremovals.co.uk';
const OFFICE = 'info@medwaykentremovals.co.uk';
const isProd = () => process.env.VERCEL_ENV === 'production';
const gbp = (n) => '£' + Number(n).toLocaleString('en-GB', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function rawBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
  return Buffer.concat(chunks);
}

// ── Stripe REST helper (form-encoded, no SDK dependency) ──────
function flatten(obj, prefix = '', out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((x, i) => (typeof x === 'object' ? flatten(x, `${key}[${i}]`, out) : out.push([`${key}[${i}]`, x])));
    else if (typeof v === 'object') flatten(v, key, out);
    else out.push([key, v]);
  }
  return out;
}
async function stripe(method, path, body) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
  const r = await fetch('https://api.stripe.com/v1' + path, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body ? new URLSearchParams(flatten(body)).toString() : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json();
  if (!r.ok) throw new Error('Stripe: ' + ((j.error && j.error.message) || r.status));
  return j;
}

function verifySignature(raw, header, secret) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${raw.toString('utf8')}`).digest('hex');
  const got = String(parts.v1 || '');
  return got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

// Gmail SMTP, the same account and app password the admin confirmation emails use.
async function sendEmail({ to, subject, html, replyTo }) {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASS) return;
  const t = nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASS } });
  await t.sendMail({
    from: `Medway & Kent Removals <${process.env.GMAIL_USER}>`, to, replyTo, subject, html,
    attachments: [{ filename: 'mkr-logo.png', content: Buffer.from(LOGO_PNG_B64, 'base64'), cid: 'mkrlogo' }],
  });
}

// Branded email shell: orange header with logo and company name, then the details.
export function brandedEmail({ heading, intro, rows }) {
  const tr = rows.map(([k, v]) => `<tr><td style="padding:10px 0;border-bottom:1px solid #eee;color:#666;width:38%">${esc(k)}</td><td style="padding:10px 0;border-bottom:1px solid #eee;font-weight:600;color:#111">${esc(v)}</td></tr>`).join('');
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;background:#ffffff">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e04e1b;border-radius:10px 10px 0 0"><tr>
    <td style="padding:20px 0 20px 28px;width:116px"><img src="cid:mkrlogo" width="116" height="56" alt="Medway &amp; Kent Removals" style="display:block;border-radius:10px;border:0"></td>
    <td style="padding:20px 28px 20px 16px"><div style="color:#ffffff;font-size:22px;font-weight:700;line-height:1.2">Medway &amp; Kent Removals</div><div style="color:#ffe3d6;font-size:13px;margin-top:4px">Professional removals across Kent</div></td>
  </tr></table>
  <div style="padding:26px 28px 24px;border:1px solid #e6e1d8;border-top:none;border-radius:0 0 10px 10px">
    <h1 style="color:#16294a;font-size:22px;margin:0 0 10px">${esc(heading)}</h1>
    <p style="margin:0 0 16px;color:#333;font-size:15px;line-height:1.6">${intro}</p>
    <table style="width:100%;border-collapse:collapse;font-size:15px">${tr}</table>
    <p style="margin:20px 0 0;color:#666;font-size:13px;line-height:1.6">Free cancellation: reply to this email or call 01634 971005 and everything you paid is refunded.</p>
    <div style="text-align:center;margin:20px 0 4px">
      <a href="tel:01634971005" style="background:#e04e1b;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 22px;border-radius:9px;display:inline-block;margin:4px">Call 01634 971005</a>
      <a href="https://wa.me/447359917380" style="background:#1EBE57;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 22px;border-radius:9px;display:inline-block;margin:4px">WhatsApp us</a>
    </div>
    <p style="margin:18px 0 0;font-size:12px;color:#999;text-align:center">Medway &amp; Kent Removals · Knight Templar Way, Rochester ME2 2ZE</p>
  </div>
</div>`;
}

// ════════════════════════════════════════════════════════════
//  1. Website → create the Checkout session
// ════════════════════════════════════════════════════════════
async function createCheckout(req, res, raw) {
  let b;
  try { b = JSON.parse(raw.toString('utf8') || '{}'); } catch { return res.status(400).json({ error: 'Bad request' }); }

  const size = Number(b.size), vans = Number(b.vans);
  if (!Number.isInteger(size) || size < 0 || size > 5 || !Number.isInteger(vans) || vans < 1 || vans > 4) {
    return res.status(400).json({ error: 'Please choose the size of your move and the number of vans.' });
  }
  if (!isPostcode(b.from_postcode) || !isPostcode(b.to_postcode)) {
    return res.status(400).json({ error: 'Please enter two valid UK postcodes.' });
  }
  const name = String(b.name || '').trim().slice(0, 120);
  const email = String(b.email || '').trim().slice(0, 160);
  const phone = String(b.phone || '').trim().slice(0, 40);
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || phone.replace(/\D/g, '').length < 10) {
    return res.status(400).json({ error: 'Please check your name, email and mobile number.' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.move_date || '')) || b.move_date < new Date().toISOString().slice(0, 10)) {
    return res.status(400).json({ error: 'Please choose your move date.' });
  }
  const option = b.pay === 'klarna' ? 'klarna' : 'deposit';
  const wantsPacking = b.packing === true;
  const fromAddr = String(b.from_address || '').trim().slice(0, 220);
  const toAddr = String(b.to_address || '').trim().slice(0, 220);
  if (!fromAddr || !toAddr) return res.status(400).json({ error: 'Please pick both addresses.' });

  // Price is worked out here from the postcodes, never taken from the browser.
  const from = tidyPostcode(b.from_postcode), to = tidyPostcode(b.to_postcode);
  let mins;
  try { mins = await journeyMinutes(from, to); } catch (e) {
    console.error('journey failed', e);
    return res.status(502).json({ error: 'We could not work out the journey. Please call 01634 971005.' });
  }
  const hours = hoursCharged(mins);
  if (hours >= PRICES.longJourneyHours) {
    return res.status(422).json({ error: 'That is a long distance move. Please call 01634 971005 for a fixed quote.' });
  }
  const total = priceFor({ size, vans, hours });
  let amountPence = option === 'klarna' ? total * 100 : Math.round(total * 100 * PRICES.depositRate);

  // Test hook: preview/dev only, never production.
  const testPence = Number(process.env.STRIPE_TEST_AMOUNT_PENCE);
  if (!isProd() && testPence >= 50) amountPence = testPence;

  const sizeLabel = size === 0 ? 'Studio' : `${size} bed`;
  const detail = `${sizeLabel}, ${vans} van${vans > 1 ? 's' : ''}, ${from} to ${to}, ${b.move_date}`;

  // Save the lead first so nobody is lost if they abandon at Stripe.
  let lead = null;
  try {
    lead = await createQuote({
      name, phone, email, service: 'House removal', from_postcode: from, to_postcode: to,
      property_size: sizeLabel, move_date: b.move_date, source: 'website', value: total,
      notes: `Instant quote & pay | ${vans} van(s) | ${mins} min drive (${hours} hr charged)` +
             (wantsPacking ? ' | Packing: customer wants to discuss packing, call after survey' : '') +
             ` | Delivery address: ${toAddr}`,
    });
  } catch (e) {
    console.error('lead save failed', e);
    return res.status(503).json({ error: 'Sorry, we could not save your booking. Please call 01634 971005.' });
  }
  const leadId = lead && lead.id;

  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  const base = process.env.SITE_URL || (isProd() ? SITE : `${/localhost|127\.0\.0\.1/.test(host) ? 'http' : 'https'}://${host}`);
  const back = String(b.return_path || '/').startsWith('/') ? String(b.return_path || '/').slice(0, 120) : '/';

  let session;
  try {
    session = await stripe('POST', '/checkout/sessions', {
      mode: 'payment',
      // Methods come from the Stripe dashboard (dynamic payment methods).
      // Keep Klarna off the small deposit, and card off the Klarna option.
      excluded_payment_method_types: [option === 'klarna' ? 'card' : 'klarna'],
      customer_email: email,
      client_reference_id: String(leadId),
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'gbp', unit_amount: amountPence,
          product_data: {
            name: option === 'klarna' ? 'Removal, paid in full (Pay in 3 with Klarna)' : 'Removal booking deposit (10%)',
            description: detail,
          },
        },
      }],
      payment_intent_data: { description: `MKR ${option === 'klarna' ? 'full payment' : 'deposit'}: ${detail}` },
      metadata: { lead_id: String(leadId), option, total_pounds: String(total) },
      success_url: `${base}/booking-confirmed?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}${back}?cancelled=1`,
    });
  } catch (e) {
    console.error('checkout failed', e);
    return res.status(502).json({ error: 'Payment could not be started. Please try again or call 01634 971005.' });
  }

  // Record the payment details; failure here must not block payment.
  try {
    await updateQuote(leadId, {
      address: fromAddr, to_address: toAddr, payment_status: 'awaiting', payment_option: option,
      stripe_session_id: session.id, status: 'awaiting_payment', updated_at: new Date().toISOString(),
    });
  } catch (e) { console.error('lead payment fields failed (has PAYMENTS.sql been run?)', e); }

  return res.status(200).json({ url: session.url, total, amount: amountPence / 100, hours, minutes: mins });
}

// ════════════════════════════════════════════════════════════
//  2. Stripe → webhook
// ════════════════════════════════════════════════════════════
async function handleWebhook(req, res, raw) {
  if (!verifySignature(raw, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET)) {
    return res.status(400).json({ error: 'Bad signature' });
  }
  const event = JSON.parse(raw.toString('utf8'));
  const s = event.data && event.data.object;
  const ok = (event.type === 'checkout.session.completed' && s.payment_status === 'paid')
          || event.type === 'checkout.session.async_payment_succeeded';
  if (!ok) return res.status(200).json({ received: true });

  const leadId = s.metadata && s.metadata.lead_id;
  if (!leadId) return res.status(200).json({ received: true });

  try {
    const q = await getQuote(leadId);
    if (!q) return res.status(200).json({ received: true });
    if (q.payment_status === 'paid') return res.status(200).json({ received: true });   // already handled

    const paid = (s.amount_total || 0) / 100;
    const option = s.metadata.option;
    // Ask Stripe how they actually paid; fall back to the option chosen.
    let method = option === 'klarna' ? 'klarna' : 'card';
    try {
      const full = await stripe('GET', `/checkout/sessions/${s.id}?expand[]=payment_intent.latest_charge`);
      const t = full.payment_intent && full.payment_intent.latest_charge && full.payment_intent.latest_charge.payment_method_details;
      if (t && t.type) method = t.type;
    } catch (e) { console.error('method lookup failed', e); }
    await updateQuote(leadId, {
      payment_status: 'paid', amount_paid: paid, payment_method: method, paid_at: new Date().toISOString(),
      stripe_session_id: s.id, status: 'move_booked', updated_at: new Date().toISOString(),
    });
    const total = Number(s.metadata.total_pounds) || Number(q.value) || paid;
    const what = option === 'klarna' ? `paid in full with Klarna (${gbp(paid)})` : `deposit paid by card (${gbp(paid)}), balance ${gbp(total - paid)} on the day`;
    try { await appendNote(leadId, `Online payment received: ${what}. Stripe session ${s.id}`); } catch {}
    await logActivity({ actor: q.name || 'Customer', action: 'paid online', lead_id: leadId, lead_name: q.name, detail: what });

    const summaryRows = [
      ['Move date', q.move_date], ['From', q.address || q.from_postcode], ['To', q.to_address || q.to_postcode],
      ['Size', q.property_size], ['Move price', gbp(total)],
      [option === 'klarna' ? 'Paid today (Klarna)' : 'Deposit paid', gbp(paid)],
      option === 'klarna' ? ['Balance due', '£0, nothing to pay on the day'] : ['Balance due on the day', gbp(total - paid)],
    ];
    if (/Packing: customer/.test(q.notes || '')) summaryRows.push(['Packing', 'We will call you to discuss it after your survey']);
    const wrap = (heading, intro) => brandedEmail({ heading, intro, rows: summaryRows });
    await Promise.allSettled([
      sendEmail({ to: OFFICE, subject: `PAID online: ${q.name} (${gbp(paid)})`, html: wrap('New paid booking', `${esc(q.name)} paid online. Phone ${esc(q.phone)}.`), replyTo: q.email }),
      q.email ? sendEmail({ to: q.email, subject: 'Your removal is booked: Medway & Kent Removals', html: wrap('You are booked in', `Thank you ${esc((q.name || '').split(' ')[0])}, your payment has gone through and your move is booked.`), replyTo: OFFICE }) : null,
    ].filter(Boolean));
  } catch (e) {
    console.error('webhook processing failed', e);
    return res.status(500).json({ error: 'processing failed' });   // Stripe retries
  }
  return res.status(200).json({ received: true });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  const raw = await rawBody(req);
  return req.headers['stripe-signature'] ? handleWebhook(req, res, raw) : createCheckout(req, res, raw);
}
