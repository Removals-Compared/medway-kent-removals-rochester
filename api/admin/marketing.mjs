// ════════════════════════════════════════════════════════════
//  Marketing tab: sold-STC leaflet drop list.
//   GET              → recent Sold STC / Under offer homes, newest STC first
//   GET  ?run=1      → refresh from Rightmove + Zoopla alerts. Vercel Cron
//                      calls this every Monday (Bearer CRON_SECRET); an admin
//                      session can trigger it too ("Refresh now").
//   POST {id, done}  → tick / untick a door as delivered
//  One function for all three keeps the project under the Hobby
//  12-function cap.
// ════════════════════════════════════════════════════════════
import { requireAuth, verifySession } from './_session.mjs';
import { listDrops, setDone, refresh } from './_marketing.mjs';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET' && req.query.run) {
      const secret = process.env.CRON_SECRET;
      const isCron = secret && (req.headers.authorization || '') === `Bearer ${secret}`;
      if (!isCron && !verifySession(req)) return res.status(401).json({ error: 'unauthorized' });
      return res.status(200).json(await refresh());
    }

    const role = requireAuth(req, res);
    if (!role) return;

    if (req.method === 'GET') {
      const days = Math.min(Math.max(Number(req.query.days) || 56, 7), 180);
      return res.status(200).json(await listDrops({ days }));
    }
    if (req.method === 'POST') {
      const { id, done } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id required' });
      const row = await setDone(String(id), !!done, req._staffName || role);
      return res.status(200).json({ row });
    }
    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    console.error('marketing', e);
    return res.status(500).json({ error: String(e.message || e) });
  }
}
