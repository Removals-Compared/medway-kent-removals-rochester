import { requireAuth } from '../_session.mjs';
import {
  getQuote, updateQuote, deleteQuote, fetchAppointmentsByLeadIds,
  fetchRemindersByLeadIds,
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
      const reminders = await fetchRemindersByLeadIds([id]);
      return res.status(200).json({ quote, appointments, reminders });
    }

    if (req.method === 'PATCH') {
      const b = req.body || {};
      const fields = { updated_at: new Date().toISOString() };

      // Editable lead details — empty string clears the column to null.
      const editable = [
        'name', 'phone', 'email', 'service', 'from_postcode',
        'to_postcode', 'property_size', 'move_date', 'notes', 'address',
      ];
      editable.forEach((k) => {
        if (b[k] !== undefined) fields[k] = b[k] === '' ? null : b[k];
      });

      if (b.status !== undefined) fields.status = b.status;
      if (b.value !== undefined) {
        fields.value = b.value === '' || b.value === null ? null : Number(b.value);
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
