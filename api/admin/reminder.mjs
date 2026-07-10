import { requireAuth } from './_session.mjs';
import {
  createReminder, updateReminder, deleteReminder, fetchReminder, getQuote,
} from './_db.mjs';
import { createReminderEvent, deleteEvent } from './_gcal.mjs';

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  try {
    if (req.method === 'POST') {
      const { lead_id, remind_on, remind_time, note } = req.body || {};
      if (!lead_id || !remind_on) {
        return res.status(400).json({ error: 'lead_id and remind_on are required' });
      }
      const time = (remind_time && /^\d{2}:\d{2}$/.test(remind_time)) ? remind_time : '09:30';

      let reminder = await createReminder({
        lead_id: Number(lead_id),
        remind_on,                       // YYYY-MM-DD
        remind_time: time,               // HH:MM
        note: (note || '').trim() || null,
        sent: false,
      });

      // Put a "Call <name>" event on Google Calendar; Google alerts at the
      // chosen time. Tolerate failure — the cron backup will email instead.
      const errors = [];
      try {
        const quote = await getQuote(lead_id);
        const eventId = await createReminderEvent({ quote, date: remind_on, time, note });
        if (eventId) reminder = await updateReminder(reminder.id, { gcal_event_id: eventId });
      } catch (e) {
        errors.push({ step: 'gcal', message: String(e.message || e) });
      }

      return res.status(201).json({ reminder, errors });
    }

    if (req.method === 'DELETE') {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: 'id required' });
      // Remove the calendar event too, if there is one.
      try {
        const existing = await fetchReminder(id);
        if (existing && existing.gcal_event_id) await deleteEvent(existing.gcal_event_id);
      } catch (e) {
        console.error('reminder delete gcal', e);
      }
      await deleteReminder(id);
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    console.error('reminder.mjs', e);
    return res.status(500).json({ error: String(e.message || e) });
  }
}
