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
import { confirmationEmail } from './_email-confirmation.mjs';
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
  const option = b.pay === 'klarna' ? 'klarna' : (b.pay === 'full' ? 'full' : 'deposit');   // deposit | full (by card) | klarna (full)
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
  if (option === 'klarna' && total > PRICES.klarnaMax) {
    return res.status(400).json({ error: `Klarna is available for moves up to £${PRICES.klarnaMax.toLocaleString('en-GB')}. Please choose the deposit option, or call 01634 971005.` });
  }
  let amountPence = option === 'deposit' ? Math.round(total * 100 * PRICES.depositRate) : total * 100;

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
            name: option === 'klarna' ? 'Removal, paid in full with Klarna' : (option === 'full' ? 'Removal, paid in full' : 'Removal booking deposit (10%)'),
            description: detail,
          },
        },
      }],
      payment_intent_data: { description: `MKR ${option === 'deposit' ? 'deposit' : 'full payment'}: ${detail}` },
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
    const fullPay = option === 'klarna' || option === 'full';
    const what = option === 'klarna' ? `paid in full with Klarna (${gbp(paid)})` : fullPay ? `paid in full by card (${gbp(paid)})` : `deposit paid by card (${gbp(paid)}), balance ${gbp(total - paid)} on the day`;
    try { await appendNote(leadId, `Online payment received: ${what}. Stripe session ${s.id}`); } catch {}
    await logActivity({ actor: q.name || 'Customer', action: 'paid online', lead_id: leadId, lead_name: q.name, detail: what });

    const fmtDate = (iso) => {
      const d = new Date(`${iso}T12:00:00Z`);
      return Number.isNaN(d.getTime()) ? String(iso || '') : d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' });
    };
    const vansMatch = /(\d)\s*van/.exec(q.notes || '');
    const data = {
      name: q.name, firstName: (q.name || '').split(' ')[0], phone: q.phone, email: q.email,
      ref: `MKR-${String(leadId).padStart(5, '0')}`,
      issued: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' }),
      moveDate: fmtDate(q.move_date), size: q.property_size, vans: vansMatch ? Number(vansMatch[1]) : 0,
      from: q.address || q.from_postcode, to: q.to_address || q.to_postcode,
      price: gbp(total), paid: gbp(paid),
      paidLabel: option === 'klarna' ? 'Paid today with Klarna' : fullPay ? 'Paid in full by card' : 'Deposit paid (10%)',
      balance: fullPay ? '£0' : gbp(total - paid),
      balanceNote: fullPay ? 'Paid in full, nothing to pay on the day' : 'Payable to the crew on moving day',
      packing: /Packing: customer/.test(q.notes || ''),
    };
    await Promise.allSettled([
      sendEmail({ to: OFFICE, subject: `PAID online: ${q.name} (${gbp(paid)})`, html: confirmationEmail({ ...data, audience: 'office' }), replyTo: q.email }),
      q.email ? sendEmail({ to: q.email, subject: 'Your removal is booked: Medway & Kent Removals', html: confirmationEmail({ ...data, audience: 'customer' }), replyTo: OFFICE }) : null,
    ].filter(Boolean));
  } catch (e) {
    console.error('webhook processing failed', e);
    return res.status(500).json({ error: 'processing failed' });   // Stripe retries
  }
  return res.status(200).json({ received: true });
}

export default async function handler(req, res) {
  // The page asks for the PUBLIC (publishable) key so Stripe's Klarna message can show.
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).json({ pk: process.env.STRIPE_PUBLISHABLE_KEY || null });
  }
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  const raw = await rawBody(req);
  return req.headers['stripe-signature'] ? handleWebhook(req, res, raw) : createCheckout(req, res, raw);
}
