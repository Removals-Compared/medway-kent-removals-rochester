import { clearCookie } from './_session.mjs';

export default async function handler(req, res) {
  res.setHeader('Set-Cookie', clearCookie());
  return res.status(200).json({ success: true });
}
