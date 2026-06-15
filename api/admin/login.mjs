import { makeSessionCookie, checkPassword } from './_session.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  const { password } = req.body || {};
  if (!checkPassword(password)) return res.status(401).json({ error: 'invalid password' });
  res.setHeader('Set-Cookie', makeSessionCookie());
  return res.status(200).json({ success: true });
}
