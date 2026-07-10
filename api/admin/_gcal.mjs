// ════════════════════════════════════════════════════════════
//  Google Calendar via OAuth refresh-token flow (no service account).
//  Env: GCAL_CLIENT_ID, GCAL_CLIENT_SECRET, GCAL_REFRESH_TOKEN,
//       GCAL_CALENDAR_ID (defaults to "primary")
// ════════════════════════════════════════════════════════════
const TIMEZONE = 'Europe/London';
// Google's event API only exposes 11 colours (not the 24 calendar colours,
// which include a true "Avocado"). "2" = Sage, the closest yellow-green.
const DEFAULT_COLOR_ID = '2';

async function getAccessToken() {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GCAL_CLIENT_ID,
      client_secret: process.env.GCAL_CLIENT_SECRET,
      refresh_token: process.env.GCAL_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  if (!r.ok) throw new Error(`gcal token ${r.status}: ${await r.text()}`);
  const j = await r.json();
  if (!j.access_token) throw new Error('gcal token: no access_token returned');
  return j.access_token;
}

export async function createEvent({ quote, type, startISO, duration = 60, address, notes }) {
  const calId = process.env.GCAL_CALENDAR_ID || 'primary';
  const token = await getAccessToken();

  const start = new Date(startISO);
  const end = new Date(start.getTime() + Number(duration) * 60000);
  const name = (quote && quote.name) || 'Customer';
  const summary = type === 'survey' ? `Survey — ${name}` : `Move — ${name}`;

  const desc = [];
  if (quote) {
    if (quote.phone) desc.push(`Phone: ${quote.phone}`);
    if (quote.email) desc.push(`Email: ${quote.email}`);
    if (quote.service) desc.push(`Service: ${quote.service}`);
    if (quote.from_postcode || quote.to_postcode)
      desc.push(`From: ${quote.from_postcode || '—'}  →  To: ${quote.to_postcode || '—'}`);
  }
  if (notes) desc.push(`Notes: ${notes}`);

  const body = {
    summary,
    description: desc.join('\n'),
    location: address || (quote && quote.from_postcode) || '',
    colorId: DEFAULT_COLOR_ID,
    start: { dateTime: start.toISOString(), timeZone: TIMEZONE },
    end: { dateTime: end.toISOString(), timeZone: TIMEZONE },
  };
  if (quote && quote.email) body.attendees = [{ email: quote.email }];

  const r = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?sendUpdates=all`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }
  );
  if (!r.ok) throw new Error(`gcal create ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return j.id;
}

// Add 30 minutes to a "HH:MM" wall-clock string (no tz maths / rollover cap).
function plus30(time) {
  const [h, m] = String(time).split(':').map(Number);
  let em = (m || 0) + 30, eh = (h || 0) + Math.floor(em / 60);
  em %= 60; if (eh > 23) { eh = 23; em = 59; }
  return `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`;
}

// A "Call <name>" reminder on the calendar at a chosen local date + time.
// Google fires a popup + email alert AT the start time, so you're notified
// exactly when you asked — no fixed daily cron needed.
export async function createReminderEvent({ quote, date, time, note }) {
  const calId = process.env.GCAL_CALENDAR_ID || 'primary';
  const token = await getAccessToken();
  const name = (quote && quote.name) || 'Customer';

  const desc = [];
  if (quote) {
    if (quote.phone) desc.push(`Phone: ${quote.phone}`);
    if (quote.email) desc.push(`Email: ${quote.email}`);
    if (quote.service) desc.push(`Service: ${quote.service}`);
  }
  if (note) desc.push(`Note: ${note}`);

  const body = {
    summary: `Call ${name}`,
    description: desc.join('\n'),
    colorId: DEFAULT_COLOR_ID,
    // Local wall-clock time (no "Z") + timeZone so 14:00 means 14:00 UK.
    start: { dateTime: `${date}T${time}:00`, timeZone: TIMEZONE },
    end: { dateTime: `${date}T${plus30(time)}:00`, timeZone: TIMEZONE },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 0 },
        { method: 'email', minutes: 0 },
      ],
    },
  };

  const r = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }
  );
  if (!r.ok) throw new Error(`gcal reminder ${r.status}: ${await r.text()}`);
  return (await r.json()).id;
}

export async function deleteEvent(eventId) {
  if (!eventId) return true;
  const calId = process.env.GCAL_CALENDAR_ID || 'primary';
  const token = await getAccessToken();
  const r = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(eventId)}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
  );
  // 410 = already deleted; treat as success.
  if (!r.ok && r.status !== 410 && r.status !== 404) {
    throw new Error(`gcal delete ${r.status}: ${await r.text()}`);
  }
  return true;
}

export async function updateEvent(eventId, patch) {
  const calId = process.env.GCAL_CALENDAR_ID || 'primary';
  const token = await getAccessToken();
  const r = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(patch),
    }
  );
  if (!r.ok) throw new Error(`gcal update ${r.status}: ${await r.text()}`);
  return (await r.json()).id;
}
