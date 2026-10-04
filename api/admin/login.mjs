import { makeSessionCookie, checkPassword, clearCookie } from './_session.mjs';

// Sign-in, and sign-out via ?logout=1 (/api/admin/logout rewrites here,
// which keeps the project under the Hobby 12-function cap).
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  if (req.query.logout) {
    res.setHeader('Set-Cookie', clearCookie());
    return res.status(200).json({ success: true });
  }
  const { password } = req.body || {};
  const acct = checkPassword(password);
  if (!acct) return res.status(401).json({ error: 'invalid password' });
  res.setHeader('Set-Cookie', makeSessionCookie(acct.role, acct.name));
  return res.status(200).json({ success: true, role: acct.role });
}
