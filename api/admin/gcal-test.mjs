// ════════════════════════════════════════════════════════════
//  Diagnostic — visit /api/admin/gcal-test (while logged in) to see
//  exactly why Google Calendar booking is failing. Returns JSON:
//    env   -> which GCAL_* vars are set / missing
//    token -> result of the OAuth refresh-token exchange (the usual
//             culprit: invalid_grant = expired/revoked refresh token)
//    cal   -> whether the calendar is reachable with that token
//             (403 here usually = Calendar API not enabled; 404 = wrong
//             calendar id)
//  Read-only: it does NOT create any events.
// ════════════════════════════════════════════════════════════
import { requireAuth } from './_session.mjs';

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;

  const out = { env: {}, token: null, cal: null };
  ['GCAL_CLIENT_ID', 'GCAL_CLIENT_SECRET', 'GCAL_REFRESH_TOKEN', 'GCAL_CALENDAR_ID'].forEach((k) => {
    out.env[k] = process.env[k] ? 'set' : 'MISSING';
  });

  try {
    const tr = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GCAL_CLIENT_ID || '',
        client_secret: process.env.GCAL_CLIENT_SECRET || '',
        refresh_token: process.env.GCAL_REFRESH_TOKEN || '',
        grant_type: 'refresh_token',
      }),
    });
    const tj = await tr.json().catch(() => ({}));
    out.token = {
      status: tr.status,
      ok: tr.ok,
      error: tj.error || null,
      error_description: tj.error_description || null,
    };
    if (!tr.ok) return res.status(200).json(out);

    const cal = process.env.GCAL_CALENDAR_ID || 'primary';
    const cr = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal)}`,
      { headers: { Authorization: `Bearer ${tj.access_token}` } }
    );
    const body = await cr.text();
    out.cal = { calendar_id: cal, status: cr.status, ok: cr.ok, body: body.slice(0, 600) };
    return res.status(200).json(out);
  } catch (e) {
    out.exception = String(e.message || e);
    return res.status(200).json(out);
  }
}
