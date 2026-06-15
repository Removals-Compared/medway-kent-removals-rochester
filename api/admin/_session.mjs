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

export function makeSessionCookie() {
  const ts = Date.now();
  const value = `${ts}.${sign(ts)}`;
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

export function verifySession(req) {
  if (!SECRET) return false;
  const raw = parseCookies(req)[COOKIE];
  if (!raw) return false;
  const dot = raw.indexOf('.');
  if (dot < 0) return false;
  const ts = raw.slice(0, dot);
  const mac = raw.slice(dot + 1);
  if (!safeEqual(mac, sign(ts))) return false;
  if (Date.now() - Number(ts) > TTL_MS) return false;
  return true;
}

export function requireAuth(req, res) {
  if (!verifySession(req)) {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  return true;
}

export function checkPassword(input) {
  const pass = process.env.ADMIN_PASS || '';
  if (!pass) return false;
  return safeEqual(input || '', pass);
}
