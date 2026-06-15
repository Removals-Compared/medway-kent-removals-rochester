// ════════════════════════════════════════════════════════════
//  Supabase PostgREST wrapper for the admin dashboard.
//  SUPABASE_KEY is the ANON key — RLS must stay OFF on these tables.
// ════════════════════════════════════════════════════════════
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const TABLE = 'quote_requests';
const APPT = 'appointments';

const base = () => `${SUPABASE_URL}/rest/v1`;

function headers(extra = {}) {
  return {
    'Content-Type': 'application/json',
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    ...extra,
  };
}

// ── Leads ──────────────────────────────────────────────────
export async function listQuotes({ status, search, limit = 200 } = {}) {
  const p = new URLSearchParams();
  p.set('select', '*');
  p.set('order', 'created_at.desc');
  p.set('limit', String(limit || 200));
  if (status && status !== 'all') p.set('status', `eq.${status}`);
  if (search && search.trim()) {
    // strip PostgREST-significant chars so the filter can't be broken
    const t = search.replace(/[(),*]/g, ' ').trim();
    if (t) p.set('or', `(name.ilike.*${t}*,email.ilike.*${t}*,phone.ilike.*${t}*)`);
  }
  const r = await fetch(`${base()}/${TABLE}?${p}`, { headers: headers() });
  if (!r.ok) throw new Error(`listQuotes ${r.status}: ${await r.text()}`);
  return r.json();
}

export async function getQuote(id) {
  const r = await fetch(
    `${base()}/${TABLE}?id=eq.${encodeURIComponent(id)}&select=*&limit=1`,
    { headers: headers() }
  );
  if (!r.ok) throw new Error(`getQuote ${r.status}: ${await r.text()}`);
  const rows = await r.json();
  return rows[0] || null;
}

export async function updateQuote(id, fields) {
  const r = await fetch(`${base()}/${TABLE}?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: headers({ Prefer: 'return=representation' }),
    body: JSON.stringify(fields),
  });
  if (!r.ok) throw new Error(`updateQuote ${r.status}: ${await r.text()}`);
  const rows = await r.json();
  return rows[0] || null;
}

export async function deleteQuote(id) {
  const r = await fetch(`${base()}/${TABLE}?id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: headers(),
  });
  if (!r.ok) throw new Error(`deleteQuote ${r.status}: ${await r.text()}`);
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
    if (input[k] !== undefined && input[k] !== null) row[k] = input[k];
  });
  const r = await fetch(`${base()}/${TABLE}`, {
    method: 'POST',
    headers: headers({ Prefer: 'return=representation' }),
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error(`createQuote ${r.status}: ${await r.text()}`);
  const rows = await r.json();
  return rows[0] || null;
}

// Internal staff notes live in the jsonb "admin_notes" column so they do
// NOT collide with the customer's text "notes" column from the public form.
export async function appendNote(id, text) {
  const q = await getQuote(id);
  const notes = Array.isArray(q && q.admin_notes) ? q.admin_notes : [];
  notes.push({ text, at: new Date().toISOString() });
  return updateQuote(id, { admin_notes: notes, updated_at: new Date().toISOString() });
}

// ── Appointments ───────────────────────────────────────────
export async function createAppointment(row) {
  const r = await fetch(`${base()}/${APPT}`, {
    method: 'POST',
    headers: headers({ Prefer: 'return=representation' }),
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error(`createAppointment ${r.status}: ${await r.text()}`);
  const rows = await r.json();
  return rows[0] || null;
}

export async function updateAppointment(id, fields) {
  const r = await fetch(`${base()}/${APPT}?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: headers({ Prefer: 'return=representation' }),
    body: JSON.stringify(fields),
  });
  if (!r.ok) throw new Error(`updateAppointment ${r.status}: ${await r.text()}`);
  const rows = await r.json();
  return rows[0] || null;
}

// Swallow errors: on a fresh schema (appointments not created yet) the page
// must still load. Returns [] on any failure rather than throwing.
export async function fetchAppointmentsByLeadIds(ids) {
  try {
    if (!ids || !ids.length) return [];
    const list = ids.map((i) => Number(i)).filter((n) => !Number.isNaN(n)).join(',');
    if (!list) return [];
    const r = await fetch(
      `${base()}/${APPT}?lead_id=in.(${list})&select=*&order=scheduled_for.asc`,
      { headers: headers() }
    );
    if (!r.ok) return [];
    return r.json();
  } catch {
    return [];
  }
}
