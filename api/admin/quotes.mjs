import { requireAuth } from './_session.mjs';
import { listQuotes, createQuote, fetchPendingReminders } from './_db.mjs';

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  try {
    if (req.method === 'GET') {
      const { status, search, limit } = req.query || {};
      const quotes = await listQuotes({
        status,
        search,
        limit: limit ? Number(limit) : 200,
      });
      // Attach the earliest pending reminder to each lead for the 🔔 indicator.
      const pending = await fetchPendingReminders();
      const map = {};
      for (const p of pending) { if (!map[p.lead_id]) map[p.lead_id] = p; }
      quotes.forEach((q) => { if (map[q.id]) q.reminder = map[q.id]; });
      return res.status(200).json({ quotes });
    }
    if (req.method === 'POST') {
      const quote = await createQuote(req.body || {});
      return res.status(201).json({ quote });
    }
    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    console.error('quotes.js', e);
    return res.status(500).json({ error: String(e.message || e) });
  }
}
