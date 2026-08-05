// ════════════════════════════════════════════════════════════
//  Public quote-acceptance endpoint. The link in the quote email
//  carries an HMAC token, so only genuine recipients can accept.
//  Accepting flips the lead to "accepted", notes it, logs it and
//  emails the office — then shows the customer a branded page.
// ════════════════════════════════════════════════════════════
import crypto from 'crypto';
import { getQuote, updateQuote, appendNote, logActivity } from './admin/_db.mjs';

const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function token(id) {
  return crypto.createHmac('sha256', process.env.ADMIN_SESSION_SECRET || '')
    .update('accept.' + String(id)).digest('hex').slice(0, 32);
}

function page(title, body) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow"><title>${esc(title)} — Medway &amp; Kent Removals</title>
<style>body{margin:0;font-family:'DM Sans',-apple-system,Arial,sans-serif;background:#f6f0e4;color:#16294a;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px;box-sizing:border-box}
.card{background:#fff;border-radius:16px;max-width:480px;width:100%;padding:40px 34px;text-align:center;box-shadow:0 18px 50px rgba(13,31,60,.15)}
.tick{width:64px;height:64px;border-radius:50%;background:linear-gradient(160deg,#22b558,#0f803a);color:#fff;font-size:32px;line-height:64px;margin:0 auto 18px;box-shadow:0 4px 14px rgba(22,163,74,.4)}
h1{font-size:23px;margin:0 0 10px}p{font-size:15px;color:#3a4763;line-height:1.7;margin:0 0 12px}
.phone{display:inline-block;margin-top:14px;background:#c94d1e;color:#fff;text-decoration:none;font-weight:700;padding:13px 28px;border-radius:9px;box-shadow:inset 0 1px 0 rgba(255,255,255,.25), 0 3px 0 #9c3a14, 0 6px 14px rgba(201,77,30,.35)}.wa{display:inline-flex;align-items:center;gap:8px;margin:14px 6px 0;background:#1EBE57;color:#fff;text-decoration:none;font-weight:700;padding:13px 24px;border-radius:9px;box-shadow:inset 0 1px 0 rgba(255,255,255,.3), 0 3px 0 #128a3e, 0 6px 14px rgba(30,190,87,.35)}.wa svg{width:18px;height:18px}
.small{font-size:12.5px;color:#8894ab;margin-top:18px}</style></head><body><div class="card">${body}</div></body></html>`;
}

export default async function handler(req, res) {
  const { id, t } = req.query || {};
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  const fail = () => res.status(400).send(page('Link not valid',
    `<h1>This link is not valid</h1>
     <p>The acceptance link looks incomplete or expired. No problem at all, you can confirm your move with one quick call or message.</p>
     <a class="phone" href="tel:01634971005">Call 01634 971005</a>
     <a class="wa" href="https://wa.me/447359917380?text=Hi%2C%20I%20would%20like%20to%20accept%20my%20removals%20quote" target="_blank" rel="noopener"><svg viewBox="0 0 32 32" fill="#fff" aria-hidden="true"><path d="M16 .5C7.4.5.5 7.4.5 16c0 2.8.7 5.4 2 7.8L.4 31.6l8-2.1c2.3 1.3 4.9 1.9 7.6 1.9 8.6 0 15.5-6.9 15.5-15.5S24.6.5 16 .5zm0 28.3c-2.4 0-4.7-.6-6.7-1.8l-.5-.3-4.8 1.3 1.3-4.6-.3-.5c-1.3-2.1-2-4.5-2-7C3 8.9 8.9 3 16 3s13 5.9 13 13-5.9 12.8-13 12.8zm7.1-9.6c-.4-.2-2.3-1.1-2.6-1.3-.4-.1-.6-.2-.9.2-.3.4-1 1.3-1.2 1.5-.2.2-.4.3-.8.1-.4-.2-1.6-.6-3.1-1.9-1.1-1-1.9-2.3-2.1-2.7-.2-.4 0-.6.2-.8.2-.2.4-.4.6-.7.2-.2.3-.4.4-.7.1-.3 0-.5 0-.7-.1-.2-.9-2.1-1.2-2.9-.3-.8-.6-.7-.9-.7h-.8c-.3 0-.7.1-1 .5-.4.4-1.3 1.3-1.3 3.1s1.4 3.6 1.5 3.9c.2.3 2.7 4.1 6.5 5.8.9.4 1.6.6 2.2.8.9.3 1.7.2 2.4.1.7-.1 2.3-.9 2.6-1.8.3-.9.3-1.6.2-1.8-.1-.2-.3-.3-.7-.5z"/></svg>WhatsApp us</a>`));

  try {
    if (!id || !t || t !== token(id)) return fail();
    const q = await getQuote(id);
    if (!q || q.status === 'deleted') return fail();

    const first = esc((q.name || 'there').split(' ')[0]);
    const already = q.status === 'accepted' || q.status === 'move_booked' || q.status === 'won';

    if (!already) {
      await updateQuote(id, { status: 'accepted', updated_at: new Date().toISOString() });
      try { await appendNote(id, 'Quote accepted by the customer (email link)'); } catch {}
      await logActivity({ actor: q.name || 'Customer', action: 'accepted quote', lead_id: id, lead_name: q.name });
      // Tell the office straight away.
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
          body: JSON.stringify({
            from: 'MKR Admin <quotes@medwaykentremovals.co.uk>',
            to: ['info@medwaykentremovals.co.uk'],
            subject: `Quote ACCEPTED: ${q.name || 'Customer'}`,
            text: `${q.name || 'A customer'} has accepted their quote via the email link.\n\nPhone: ${q.phone || ''}\nEmail: ${q.email || ''}\nMove date: ${q.move_date || 'not set'}\n\nOpen the lead: https://www.medwaykentremovals.co.uk/admin/quote/${id}\n\nNext step: call to confirm the date and take the £50 deposit.`,
          }),
        });
      } catch (e) { console.error('accept notify', e); }
    }

    return res.status(200).send(page('Quote accepted',
      `<div class="tick">&#10003;</div>
       <h1>Thank you, ${first}!</h1>
       <p>Your quote is accepted and your move is now with our booking team. We will call you shortly to confirm your date and take the small deposit that secures it.</p>
       <p>Need us sooner? We are 7 days a week.</p>
       <a class="phone" href="tel:01634971005">Call 01634 971005</a>
       <a class="wa" href="https://wa.me/447359917380?text=Hi%2C%20I%20just%20accepted%20my%20removals%20quote" target="_blank" rel="noopener"><svg viewBox="0 0 32 32" fill="#fff" aria-hidden="true"><path d="M16 .5C7.4.5.5 7.4.5 16c0 2.8.7 5.4 2 7.8L.4 31.6l8-2.1c2.3 1.3 4.9 1.9 7.6 1.9 8.6 0 15.5-6.9 15.5-15.5S24.6.5 16 .5zm0 28.3c-2.4 0-4.7-.6-6.7-1.8l-.5-.3-4.8 1.3 1.3-4.6-.3-.5c-1.3-2.1-2-4.5-2-7C3 8.9 8.9 3 16 3s13 5.9 13 13-5.9 12.8-13 12.8zm7.1-9.6c-.4-.2-2.3-1.1-2.6-1.3-.4-.1-.6-.2-.9.2-.3.4-1 1.3-1.2 1.5-.2.2-.4.3-.8.1-.4-.2-1.6-.6-3.1-1.9-1.1-1-1.9-2.3-2.1-2.7-.2-.4 0-.6.2-.8.2-.2.4-.4.6-.7.2-.2.3-.4.4-.7.1-.3 0-.5 0-.7-.1-.2-.9-2.1-1.2-2.9-.3-.8-.6-.7-.9-.7h-.8c-.3 0-.7.1-1 .5-.4.4-1.3 1.3-1.3 3.1s1.4 3.6 1.5 3.9c.2.3 2.7 4.1 6.5 5.8.9.4 1.6.6 2.2.8.9.3 1.7.2 2.4.1.7-.1 2.3-.9 2.6-1.8.3-.9.3-1.6.2-1.8-.1-.2-.3-.3-.7-.5z"/></svg>WhatsApp us</a>
       <p class="small">Medway &amp; Kent Removals &bull; Fixed prices, no hidden charges &bull; Rochester based</p>`));
  } catch (e) {
    console.error('accept-quote', e);
    return fail();
  }
}
