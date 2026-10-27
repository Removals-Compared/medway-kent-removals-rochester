// GET /api/admin/all-moves — booked moves across all four companies.
// Queries each company's Neon database directly (read-only) and returns a
// single labelled, date-sorted list so the next move is visible without
// logging in to four admins. Companies whose connection string env var is
// missing are reported as "not connected" rather than failing the call.
// Staff sessions never receive values (move_booked is outside the statuses
// staff may see money for).
import { requireAuth } from './_session.mjs';
import { neon } from '@neondatabase/serverless';

const COMPANIES = [
  {
    key: 'mkr', label: 'MKR', env: 'DATABASE_URL',
    admin: 'https://www.medwaykentremovals.co.uk/admin/quote/',
    sql: `select id, name, phone, service, from_postcode as from_loc, to_postcode as to_loc,
                 property_size as property, move_date::text as move_date, value
            from quote_requests
           where status = 'move_booked'
           order by move_date asc nulls last limit 200`,
  },
  {
    key: 'relokates', label: 'Relokates', env: 'RELOKATES_DATABASE_URL',
    admin: 'https://www.relokates.co.uk/admin/quote/',
    sql: `select id, name, phone, service, move_from as from_loc, move_to as to_loc,
                 property, move_date::text as move_date, value
            from relokates_quote_request
           where status = 'move_booked'
           order by move_date asc nulls last limit 200`,
  },
  {
    key: 'tlr', label: 'Top London', env: 'TLR_DATABASE_URL',
    admin: 'https://top-london-removals.com/admin/quote/',
    sql: `select id, name, phone, service, move_from as from_loc, move_to as to_loc,
                 property, move_date::text as move_date, value
            from tlr_quote_request
           where status = 'move booked'
           order by move_date asc nulls last limit 200`,
  },
  {
    key: 'cer', label: 'CER', env: 'CER_DATABASE_URL',
    admin: 'https://chelmsford-essex-removals.vercel.app/admin/lead?id=',
    sql: `select id, name, phone, service, from_postcode as from_loc, to_postcode as to_loc,
                 property_size as property, move_date::text as move_date, value
            from leads
           where status = 'move_booked' and deleted_at is null
           order by move_date asc nulls last limit 200`,
  },
];

// move_date columns vary (date / text) across the four schemas, so parsing
// happens here, not in SQL. Returns 'YYYY-MM-DD' or null.
function isoDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); // dd/mm/yyyy
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export default async function handler(req, res) {
  const role = requireAuth(req, res);
  if (!role) return;
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const results = await Promise.allSettled(COMPANIES.map(async (c) => {
    const url = process.env[c.env];
    if (!url) return { company: c.key, connected: false, moves: [] };
    const sql = neon(url);
    const rows = await sql.query(c.sql, []);
    return {
      company: c.key,
      connected: true,
      moves: rows.map((r) => ({
        company: c.key,
        label: c.label,
        id: r.id,
        name: r.name || '',
        phone: r.phone || '',
        service: r.service || '',
        from_loc: r.from_loc || '',
        to_loc: r.to_loc || '',
        property: r.property || '',
        move_date: isoDate(r.move_date),
        value: role === 'admin' && r.value != null && r.value !== '' ? Number(r.value) : null,
        link: c.admin + r.id,
      })),
    };
  }));

  const companies = {};
  let moves = [];
  results.forEach((r, i) => {
    const key = COMPANIES[i].key;
    if (r.status === 'fulfilled') {
      companies[key] = { connected: r.value.connected, error: false };
      moves = moves.concat(r.value.moves);
    } else {
      console.error('all-moves ' + key + ' failed', r.reason);
      companies[key] = { connected: true, error: true };
    }
  });

  // Soonest first; dated moves before undated; drop anything finished more
  // than 2 days ago so a slipped status change doesn't hide today's move.
  const cutoff = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
  moves = moves.filter((m) => !m.move_date || m.move_date >= cutoff);
  moves.sort((a, b) => {
    if (!a.move_date && !b.move_date) return 0;
    if (!a.move_date) return 1;
    if (!b.move_date) return -1;
    return a.move_date < b.move_date ? -1 : a.move_date > b.move_date ? 1 : 0;
  });

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ role, companies, moves });
}
