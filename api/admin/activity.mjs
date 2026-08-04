// ════════════════════════════════════════════════════════════
//  Recent team activity for the Insights page: who added,
//  updated or deleted which lead. Read-only.
// ════════════════════════════════════════════════════════════
import { requireAuth } from './_session.mjs';
import { fetchActivity } from './_db.mjs';

export default async function handler(req, res) {
  const role = requireAuth(req, res);
  if (!role) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });
  try {
    const activity = await fetchActivity(Number(req.query.limit) || 25);
    return res.status(200).json({ activity });
  } catch (e) {
    console.error('activity', e);
    return res.status(200).json({ activity: [] });
  }
}
