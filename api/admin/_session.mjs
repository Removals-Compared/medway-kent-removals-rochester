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

// Sessions carry a role: "admin" (full access) or "staff" (no money).
export function makeSessionCookie(role = 'admin') {
  const ts = Date.now();
  const value = `${ts}.${role}.${sign(ts + '.' + role)}`;
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

// Returns the session role ("admin" | "staff") or false.
// Legacy two-part cookies (issued before roles existed) count as admin.
export function verifySession(req) {
  if (!SECRET) return false;
  const raw = parseCookies(req)[COOKIE];
  if (!raw) return false;
  const parts = raw.split('.');
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

// Which role does this password belong to? false = wrong password.
export function checkPassword(input) {
  const admin = process.env.ADMIN_PASS || '';
  const staff = process.env.STAFF_PASS || '';
  if (admin && safeEqual(input || '', admin)) return 'admin';
  if (staff && safeEqual(input || '', staff)) return 'staff';
  return false;
}
