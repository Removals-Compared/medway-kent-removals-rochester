// ════════════════════════════════════════════════════════════
//  Neon Postgres data layer for the admin dashboard.
//  Same exported functions and row shapes as the old PostgREST wrapper.
// ════════════════════════════════════════════════════════════
import { q, setClause, jsonify } from './_sql.mjs';

const TABLE = 'quote_requests';
const APPT = 'appointments';
const REMIND = 'reminders';

// Run an UPDATE … RETURNING * for a table by id.
async function updateById(table, id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return null;
  const s = setClause(fields);
  const rows = await q(`UPDATE ${table} SET ${s.sql} WHERE id = $${s.next} RETURNING *`, [...s.values, id]);
  return rows[0] || null;
}

// INSERT one row (object) … RETURNING *.
async function insertRow(table, row) {
  const keys = Object.keys(row);
  keys.forEach((k) => { if (!/^[a-z_][a-z0-9_]*$/.test(k)) throw new Error(`bad column ${k}`); });
  const rows = await q(
    `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
    keys.map((k) => jsonify(row[k])),
  );
  return rows[0] || null;
}

// ── Leads ──────────────────────────────────────────────────
export async function listQuotes({ status, search, limit = 200 } = {}) {
  const where = [];
  const params = [];
  if (status && status !== 'all') { params.push(status); where.push(`status = $${params.length}`); }
  else where.push(`status IS DISTINCT FROM 'deleted'`); // recycled leads never show in normal views
  if (search && search.trim()) {
    const t = search.replace(/[%_\\]/g, ' ').trim();
    if (t) {
      params.push(`%${t}%`);
      const n = params.length;
      where.push('(' + ['name', 'email', 'phone', 'from_postcode', 'to_postcode', 'address']
        .map((c) => `${c} ILIKE $${n}`).join(' OR ') + ')');
    }
  }
  params.push(Number(limit) || 200);
  return q(`SELECT * FROM ${TABLE} WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT $${params.length}`, params);
}

export async function getQuote(id) {
  const rows = await q(`SELECT * FROM ${TABLE} WHERE id = $1 LIMIT 1`, [id]);
  return rows[0] || null;
}

export const updateQuote = (id, fields) => updateById(TABLE, id, fields);

export async function deleteQuote(id) {
  await q(`DELETE FROM ${TABLE} WHERE id = $1`, [id]);
  return true;
}

// Insert a lead from the admin "+ Add customer" modal. Only known
// public-form columns are accepted, plus status='new'.
export async function createQuote(input = {}) {
  const allowed = [
    'name', 'phone', 'email', 'service', 'from_postcode',
    'to_postcode', 'property_size', 'move_date', 'notes',
  ];
  const row = { status: 'new' };
  allowed.forEach((k) => {
    if (input[k] !== undefined && input[k] !== null && input[k] !== '') row[k] = input[k];
  });
  // Quoted value maps to the numeric "value" column (added by the migration).
  if (input.value !== undefined && input.value !== null && input.value !== '') {
    const n = Number(input.value);
    if (!Number.isNaN(n)) row.value = n;
  }
  return insertRow(TABLE, row);
}

// Internal staff notes live in the jsonb "admin_notes" column so they do
// NOT collide with the customer's text "notes" column from the public form.
export async function appendNote(id, text) {
  const q0 = await getQuote(id);
  const notes = Array.isArray(q0 && q0.admin_notes) ? q0.admin_notes : [];
  notes.push({ text, at: new Date().toISOString() });
  return updateQuote(id, { admin_notes: notes, updated_at: new Date().toISOString() });
}

// ── Appointments ───────────────────────────────────────────
export const createAppointment = (row) => insertRow(APPT, row);
export const updateAppointment = (id, fields) => updateById(APPT, id, fields);

// Swallow errors: on a fresh schema (appointments not created yet) the page
// must still load. Returns [] on any failure rather than throwing.
export async function fetchAppointmentsByLeadIds(ids) {
  try {
    const list = (ids || []).map(Number).filter((n) => !Number.isNaN(n));
    if (!list.length) return [];
    return await q(`SELECT * FROM ${APPT} WHERE lead_id = ANY($1::bigint[]) ORDER BY scheduled_for ASC`, [list]);
  } catch {
    return [];
  }
}

// ── Reminders ──────────────────────────────────────────────
export const createReminder = (row) => insertRow(REMIND, row);
export const updateReminder = (id, fields) => updateById(REMIND, id, fields);

export async function fetchReminder(id) {
  const rows = await q(`SELECT * FROM ${REMIND} WHERE id = $1 LIMIT 1`, [id]);
  return rows[0] || null;
}

export async function deleteReminder(id) {
  await q(`DELETE FROM ${REMIND} WHERE id = $1`, [id]);
  return true;
}

// Swallow errors so the lead page still loads on a fresh schema.
export async function fetchRemindersByLeadIds(ids) {
  try {
    const list = (ids || []).map(Number).filter((n) => !Number.isNaN(n));
    if (!list.length) return [];
    return await q(`SELECT * FROM ${REMIND} WHERE lead_id = ANY($1::bigint[]) ORDER BY remind_on ASC`, [list]);
  } catch {
    return [];
  }
}

// All un-sent reminders (for the dashboard 🔔 indicator). Errors → [].
export async function fetchPendingReminders() {
  try {
    return await q(`SELECT lead_id, remind_on, remind_time, note FROM ${REMIND} WHERE sent = false ORDER BY remind_on ASC`);
  } catch {
    return [];
  }
}

// Cron backup: reminders due on/before `today` that haven't been sent AND
// never made it onto Google Calendar (gcal_event_id is null). When the
// calendar event exists, Google itself notifies at the chosen time, so the
// cron skips it to avoid a duplicate alert.
export async function fetchDueReminders(today) {
  return q(
    `SELECT * FROM ${REMIND} WHERE sent = false AND gcal_event_id IS NULL AND remind_on <= $1 ORDER BY remind_on ASC`,
    [today],
  );
}

export async function markReminderSent(id) {
  await q(`UPDATE ${REMIND} SET sent = true, sent_at = $2 WHERE id = $1`, [id, new Date().toISOString()]);
  return true;
}

// ── Activity log ───────────────────────────────────────────
// Who added / updated / deleted what. Best-effort by design: if the
// activity_log table does not exist yet, logging fails silently and
// nothing else is affected.
export async function logActivity({ actor, action, lead_id, lead_name, detail }) {
  try {
    await q(
      'INSERT INTO activity_log (actor, action, lead_id, lead_name, detail) VALUES ($1, $2, $3, $4, $5)',
      [actor || 'unknown', action || '', lead_id == null ? null : String(lead_id), lead_name || '', detail || ''],
    );
  } catch {}
}

export async function fetchActivity(limit = 30) {
  try {
    return await q('SELECT * FROM activity_log ORDER BY at DESC LIMIT $1', [Number(limit) || 30]);
  } catch { return []; }
}


// Recycle bin: recycled leads older than this are purged by the daily cron.
export async function fetchExpiredDeleted(days = 30) {
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  try {
    return await q(`SELECT id, name FROM ${TABLE} WHERE status = 'deleted' AND updated_at < $1`, [cutoff]);
  } catch { return []; }
}


// Possible duplicates of a lead: another live lead sharing its phone or email.
export async function fetchDuplicates(id, phone, email) {
  const params = [id];
  const parts = [];
  if (phone && String(phone).trim()) { params.push(String(phone).trim()); parts.push(`phone = $${params.length}`); }
  if (email && String(email).trim()) { params.push(String(email).trim().toLowerCase()); parts.push(`email = $${params.length}`); }
  if (!parts.length) return [];
  try {
    return await q(
      `SELECT id, name, status, created_at FROM ${TABLE}
       WHERE (${parts.join(' OR ')}) AND id <> $1 AND status IS DISTINCT FROM 'deleted' LIMIT 5`,
      params,
    );
  } catch { return []; }
}

// Other move bookings on the same calendar day — for double-booking warnings.
export async function fetchMovesOnDate(dayISO, excludeLeadId) {
  const from = `${dayISO}T00:00:00Z`;
  const next = new Date(new Date(from).getTime() + 86400000).toISOString();
  try {
    const rows = await q(
      `SELECT lead_id, scheduled_for FROM ${APPT} WHERE type = 'move' AND scheduled_for >= $1 AND scheduled_for < $2`,
      [from, next],
    );
    return rows.filter((a) => String(a.lead_id) !== String(excludeLeadId));
  } catch { return []; }
}
