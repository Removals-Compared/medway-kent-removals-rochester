// ════════════════════════════════════════════════════════════
//  Admin auth — HMAC-signed session cookie. No JWT, no 3rd-party auth.
//  Cookie value: "<ms-timestamp>.<hmac-sha256(timestamp, SECRET) hex>"
// ════════════════════════════════════════════════════════════
import crypto from 'crypto';

const COOKIE = 'admin_session';
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SECRET = process.env.ADMIN_SESSION_SECRET || '';

function sign(ts) {
  return crypto.createHmac('sha256', SECRET).update(String(ts)).digest('hex');
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

const b64u = (s) => Buffer.from(String(s), 'utf8').toString('base64url');
const unb64u = (s) => { try { return Buffer.from(String(s), 'base64url').toString('utf8'); } catch { return ''; } };

// Sessions carry a role: "admin" (full access) or "staff" (no money).
// Staff cookies also carry the staff member's name so each login is personal.
export function makeSessionCookie(role = 'admin', name = '') {
  const ts = Date.now();
  const value = role === 'staff' && name
    ? `${ts}.staff.${b64u(name)}.${sign(ts + '.staff.' + b64u(name))}`
    : `${ts}.${role}.${sign(ts + '.' + role)}`;
  const expires = new Date(ts + TTL_MS).toUTCString();
  return `${COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Expires=${expires}`;
}

export function clearCookie() {
  return `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

// Returns the session role ("admin" | "staff") or false, and stashes the
// staff member's name on req._staffName for personalised responses.
// Legacy two-part cookies (issued before roles existed) count as admin.
export function verifySession(req) {
  if (!SECRET) return false;
  const raw = parseCookies(req)[COOKIE];
  if (!raw) return false;
  const parts = raw.split('.');
  if (parts.length === 4) {
    const [ts, role, nameB64, mac] = parts;
    if (role !== 'staff') return false;
    if (!safeEqual(mac, sign(ts + '.staff.' + nameB64))) return false;
    if (Date.now() - Number(ts) > TTL_MS) return false;
    req._staffName = unb64u(nameB64);
    return 'staff';
  }
  if (parts.length === 3) {
    const [ts, role, mac] = parts;
    if (!['admin', 'staff'].includes(role)) return false;
    if (!safeEqual(mac, sign(ts + '.' + role))) return false;
    if (Date.now() - Number(ts) > TTL_MS) return false;
    return role;
  }
  if (parts.length === 2) {
    const [ts, mac] = parts;
    if (!safeEqual(mac, sign(ts))) return false;
    if (Date.now() - Number(ts) > TTL_MS) return false;
    return 'admin';
  }
  return false;
}

// Truthy return is the role string, so existing
// `if (!requireAuth(req, res)) return;` call sites keep working.
export function requireAuth(req, res) {
  const role = verifySession(req);
  if (!role) {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  return role;
}

// Staff accounts come from STAFF_ACCOUNTS: "Name:password;Name:password".
// The older single STAFF_PASS (+ STAFF_NAME) still works as a fallback.
function staffAccounts() {
  const out = [];
  (process.env.STAFF_ACCOUNTS || '').split(';').forEach((pair) => {
    const i = pair.indexOf(':');
    if (i > 0) out.push({ name: pair.slice(0, i).trim(), pass: pair.slice(i + 1) });
  });
  if (process.env.STAFF_PASS) {
    out.push({ name: process.env.STAFF_NAME || 'Staff', pass: process.env.STAFF_PASS });
  }
  return out;
}

// Which account does this password belong to?
// Returns { role, name } or false for a wrong password.
export function checkPassword(input) {
  const admin = process.env.ADMIN_PASS || '';
  if (admin && safeEqual(input || '', admin)) return { role: 'admin', name: '' };
  for (const a of staffAccounts()) {
    if (a.pass && safeEqual(input || '', a.pass)) return { role: 'staff', name: a.name };
  }
  return false;
}
