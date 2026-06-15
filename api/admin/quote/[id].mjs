import { requireAuth } from '../_session.mjs';
import {
  getQuote, updateQuote, deleteQuote, fetchAppointmentsByLeadIds,
} from '../_db.mjs';

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;

  // Defensive: strip any ".html" the rewrite/cleanUrls layer might leave on.
  let id = req.query.id;
  if (typeof id === 'string') id = id.replace(/\.html$/, '');

  try {
    if (req.method === 'GET') {
      const quote = await getQuote(id);
      if (!quote) return res.status(404).json({ error: 'not found' });
      const appointments = await fetchAppointmentsByLeadIds([id]);
      return res.status(200).json({ quote, appointments });
    }

    if (req.method === 'PATCH') {
      const { status, value } = req.body || {};
      const fields = { updated_at: new Date().toISOString() };
      if (status !== undefined) fields.status = status;
      if (value !== undefined) {
        fields.value = value === '' || value === null ? null : Number(value);
      }
      const quote = await updateQuote(id, fields);
      return res.status(200).json({ quote });
    }

    if (req.method === 'DELETE') {
      await deleteQuote(id);
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    console.error('quote/[id].js', e);
    return res.status(500).json({ error: String(e.message || e) });
  }
}
