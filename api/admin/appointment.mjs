import { requireAuth } from './_session.mjs';
import { getQuote, createAppointment, updateAppointment } from './_db.mjs';
import { createEvent } from './_gcal.mjs';
import { sendSurveyConfirmation, sendMoveConfirmation } from './_email.mjs';

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  const errors = [];
  try {
    const { lead_id, type, scheduled_for, duration_minutes, address, notes } = req.body || {};
    if (!lead_id || !type || !scheduled_for) {
      return res.status(400).json({ error: 'lead_id, type and scheduled_for are required' });
    }
    if (type !== 'survey' && type !== 'move') {
      return res.status(400).json({ error: 'type must be survey or move' });
    }

    // Always store UTC ISO 8601 so Supabase is consistent.
    const iso = new Date(scheduled_for).toISOString();
    const duration = Number(duration_minutes) || 60;

    const quote = await getQuote(lead_id);

    // 1. Save the appointment first — this must never be blocked by GCal/email.
    let appt = await createAppointment({
      lead_id: Number(lead_id),
      type,
      scheduled_for: iso,
      duration_minutes: duration,
      address: address || null,
      notes: notes || null,
    });

    // 2. Google Calendar — tolerate failure.
    try {
      const eventId = await createEvent({ quote, type, startISO: iso, duration, address, notes });
      if (eventId) appt = await updateAppointment(appt.id, { gcal_event_id: eventId });
    } catch (e) {
      errors.push({ step: 'gcal', message: String(e.message || e) });
    }

    // 3. Customer confirmation email — tolerate failure.
    try {
      if (quote && quote.email) {
        if (type === 'survey') await sendSurveyConfirmation(quote, appt);
        else await sendMoveConfirmation(quote, appt);
        appt = await updateAppointment(appt.id, { email_sent: true });
      } else {
        errors.push({ step: 'email', message: 'no customer email on file' });
      }
    } catch (e) {
      errors.push({ step: 'email', message: String(e.message || e) });
    }

    return res.status(200).json({ ok: true, appointment: appt, errors });
  } catch (e) {
    console.error('appointment.js', e);
    return res.status(500).json({ ok: false, error: String(e.message || e), errors });
  }
}
