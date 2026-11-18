// Token for the "pay your balance / deposit" link the office sends a customer.
// It is tied to the lead id AND its current job value, so if the price is changed
// in the admin, old links stop working. Forging one needs ADMIN_SESSION_SECRET.
import crypto from 'crypto';

export function payToken(id, value) {
  return crypto.createHmac('sha256', process.env.ADMIN_SESSION_SECRET || '')
    .update(`paylink.${String(id)}.${Math.round(Number(value) || 0)}`).digest('hex').slice(0, 24);
}

export function payTokenOk(id, value, given) {
  const want = payToken(id, value), got = String(given || '');
  return !!process.env.ADMIN_SESSION_SECRET && got.length === want.length
    && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}
