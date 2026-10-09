// ════════════════════════════════════════════════════════════
//  Neon Postgres access (HTTP driver — no TCP pool, serverless-safe).
//  Needs one env var: DATABASE_URL (Neon pooled connection string).
//  Type parsers keep row shapes identical to the old PostgREST output:
//  bigint/numeric → Number, date → 'YYYY-MM-DD', timestamptz → ISO string.
// ════════════════════════════════════════════════════════════
import { neon, types } from '@neondatabase/serverless';

const parsers = {
  20: (v) => Number(v),                     // int8
  1700: (v) => Number(v),                   // numeric
  1082: (v) => v,                           // date stays a plain string
  1184: (v) => new Date(v).toISOString(),   // timestamptz
};
const typeConfig = {
  getTypeParser: (oid, fmt) => parsers[oid] || types.getTypeParser(oid, fmt),
};

let _sql;
function client() {
  if (!_sql) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
    _sql = neon(process.env.DATABASE_URL);
  }
  return _sql;
}

// q('select * from t where id = $1', [id]) → array of row objects
// async so a missing DATABASE_URL becomes a rejected promise, not a sync throw
export const q = async (text, params = []) => client().query(text, params, { types: typeConfig });

// Build "UPDATE … SET a=$1,b=$2 WHERE id=$n" from a plain object. Column
// names come only from server code, never from user input keys directly:
// they are still validated against a strict identifier pattern.
export function setClause(fields, startAt = 1) {
  const keys = Object.keys(fields);
  keys.forEach((k) => { if (!/^[a-z_][a-z0-9_]*$/.test(k)) throw new Error(`bad column ${k}`); });
  return {
    sql: keys.map((k, i) => `${k} = $${startAt + i}`).join(', '),
    values: keys.map((k) => jsonify(fields[k])),
    next: startAt + keys.length,
  };
}

// jsonb values must be sent as JSON text; the driver would otherwise
// serialise arrays as Postgres arrays.
export function jsonify(v) {
  return v !== null && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v;
}
