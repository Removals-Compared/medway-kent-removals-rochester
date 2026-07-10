import { requireAuth } from './_session.mjs';
import { createReminder, deleteReminder } from './_db.mjs';

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  try {
    if (req.method === 'POST') {
      const { lead_id, remind_on, note } = req.body || {};
      if (!lead_id || !remind_on) {
        return res.status(400).json({ error: 'lead_id and remind_on are required' });
      }
      const reminder = await createReminder({
        lead_id: Number(lead_id),
        remind_on,                       // YYYY-MM-DD
        note: (note || '').trim() || null,
        sent: false,
      });
      return res.status(201).json({ reminder });
    }

    if (req.method === 'DELETE') {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: 'id required' });
      await deleteReminder(id);
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    console.error('reminder.mjs', e);
    return res.status(500).json({ error: String(e.message || e) });
  }
}
