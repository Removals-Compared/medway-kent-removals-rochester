import { requireAuth } from './_session.mjs';
import { getQuote, createAppointment, updateAppointment, fetchMovesOnDate } from './_db.mjs';
import { createEvent } from './_gcal.mjs';
import { sendSurveyConfirmation, sendMoveConfirmation, sendPackingConfirmation } from './_email.mjs';

// Crew names as stored on an appointment: trimmed, non-empty, capped.
const cleanCrew = (crew) =>
  Array.isArray(crew) ? crew.map((n) => String(n).trim()).filter(Boolean).slice(0, 20) : [];

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;

  // PATCH: reassign the crew on an existing booking. Crew is internal only —
  // it never reaches the customer confirmation emails.
  if (req.method === 'PATCH') {
    try {
      const { id, crew } = req.body || {};
      if (!id || !Array.isArray(crew)) return res.status(400).json({ error: 'id and crew[] are required' });
      const appt = await updateAppointment(id, { crew: cleanCrew(crew) });
      if (!appt) return res.status(404).json({ error: 'appointment not found' });
      return res.status(200).json({ ok: true, appointment: appt });
    } catch (e) {
      console.error('appointment.js PATCH', e);
      return res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  const errors = [];
  try {
    const { lead_id, type, scheduled_for, duration_minutes, address, notes, crew, send_email } = req.body || {};
    if (!lead_id || !type || !scheduled_for) {
      return res.status(400).json({ error: 'lead_id, type and scheduled_for are required' });
    }
    if (!['survey', 'move', 'packing'].includes(type)) {
      return res.status(400).json({ error: 'type must be survey, move or packing' });
    }

    // Always store UTC ISO 8601 so Supabase is consistent.
    const iso = new Date(scheduled_for).toISOString();
    const duration = Number(duration_minutes) || 60;

    const quote = await getQuote(lead_id);

    // Double-booking check: other moves already in the diary that day.
    let conflicts = [];
    if (type === 'move') {
      try {
        const clash = await fetchMovesOnDate(iso.slice(0, 10), lead_id);
        for (const c of clash) {
          const other = await getQuote(c.lead_id).catch(() => null);
          conflicts.push((other && other.name) || 'another customer');
        }
      } catch {}
    }

    // 1. Save the appointment first — this must never be blocked by GCal/email.
    let appt = await createAppointment({
      lead_id: Number(lead_id),
      type,
      scheduled_for: iso,
      duration_minutes: duration,
      address: address || null,
      notes: notes || null,
      crew: cleanCrew(crew),
    });

    // 2. Google Calendar — tolerate failure.
    try {
      const eventId = await createEvent({ quote, type, startISO: iso, duration, address, notes });
      if (eventId) appt = await updateAppointment(appt.id, { gcal_event_id: eventId });
    } catch (e) {
      errors.push({ step: 'gcal', message: String(e.message || e) });
    }

    // 3. Customer confirmation email — only with the booker's permission
    //    (the form's checkbox), and tolerate failure. The templates carry
    //    date/time/address/service only; crew names are never included.
    try {
      if (send_email === false) {
        // Staff chose not to email the customer; email_sent stays false.
      } else if (quote && quote.email) {
        if (type === 'survey') await sendSurveyConfirmation(quote, appt);
        else if (type === 'packing') await sendPackingConfirmation(quote, appt);
        else await sendMoveConfirmation(quote, appt);
        appt = await updateAppointment(appt.id, { email_sent: true });
      } else {
        errors.push({ step: 'email', message: 'no customer email on file' });
      }
    } catch (e) {
      errors.push({ step: 'email', message: String(e.message || e) });
    }

    return res.status(200).json({ ok: true, appointment: appt, errors, conflicts });
  } catch (e) {
    console.error('appointment.js', e);
    return res.status(500).json({ ok: false, error: String(e.message || e), errors });
  }
}
