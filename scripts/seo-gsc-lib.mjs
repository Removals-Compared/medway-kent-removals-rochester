// ════════════════════════════════════════════════════════════
//  Google Search Console client (read-only).
//
//  Two ways to sign in, whichever env vars are present:
//   1. Service account (recommended: never expires, no consent screen)
//        GSC_SERVICE_ACCOUNT_JSON = the key file contents (JSON text or base64)
//        and the service account's email added as a user on the Search Console property.
//   2. OAuth refresh token
//        GSC_CLIENT_ID, GSC_CLIENT_SECRET, GSC_REFRESH_TOKEN
//
//  Optional: GSC_SITE (e.g. "sc-domain:medwaykentremovals.co.uk" or
//  "https://www.medwaykentremovals.co.uk/"). If unset, the right property is
//  found from the account's site list.
// ════════════════════════════════════════════════════════════
import crypto from 'node:crypto';

const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const API = 'https://www.googleapis.com/webmasters/v3';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export function authMode(env = process.env) {
  if (env.GSC_SERVICE_ACCOUNT_JSON) return 'service_account';
  if (env.GSC_CLIENT_ID && env.GSC_CLIENT_SECRET && env.GSC_REFRESH_TOKEN) return 'oauth';
  return null;
}

function parseServiceAccount(raw) {
  const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  const j = JSON.parse(text);
  if (!j.client_email || !j.private_key) throw new Error('GSC_SERVICE_ACCOUNT_JSON is missing client_email or private_key');
  return j;
}

const b64u = (b) => Buffer.from(b).toString('base64url');

export function signServiceAccountJwt(sa, now = Math.floor(Date.now() / 1000)) {
  const header = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64u(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }));
  const sig = crypto.createSign('RSA-SHA256').update(`${header}.${claim}`).sign(sa.private_key);
  return `${header}.${claim}.${b64u(sig)}`;
}

export async function getAccessToken(env = process.env, fetchFn = fetch) {
  const mode = authMode(env);
  if (!mode) throw new Error('Search Console is not connected (no GSC_SERVICE_ACCOUNT_JSON or GSC_REFRESH_TOKEN).');
  const body = mode === 'service_account'
    ? new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: signServiceAccountJwt(parseServiceAccount(env.GSC_SERVICE_ACCOUNT_JSON)) })
    : new URLSearchParams({ client_id: env.GSC_CLIENT_ID, client_secret: env.GSC_CLIENT_SECRET, refresh_token: env.GSC_REFRESH_TOKEN, grant_type: 'refresh_token' });
  const r = await fetchFn(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    const why = j.error_description || j.error || r.status;
    throw new Error(`Google sign-in failed (${mode}): ${why}${j.error === 'invalid_grant' && mode === 'oauth' ? '. The refresh token may have expired; a service account avoids this.' : ''}`);
  }
  return j.access_token;
}

async function gsc(token, path, init = {}, fetchFn = fetch) {
  const r = await fetchFn(API + path, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Search Console API ${r.status}: ${(j.error && (j.error.message || j.error.status)) || 'request failed'}`);
  return j;
}

export async function listSites(token, fetchFn = fetch) {
  const j = await gsc(token, '/sites', {}, fetchFn);
  return (j.siteEntry || []).map((s) => ({ url: s.siteUrl, level: s.permissionLevel }));
}

// Prefer the whole-domain property, then the www URL-prefix property.
export function pickSite(sites, preferred, host = 'medwaykentremovals.co.uk') {
  const usable = sites.filter((s) => s.level !== 'siteUnverifiedUser');
  if (preferred) {
    const hit = usable.find((s) => s.url === preferred);
    if (!hit) throw new Error(`Property ${preferred} is not available to this account. Available: ${usable.map((s) => s.url).join(', ') || 'none'}`);
    return hit.url;
  }
  const order = [`sc-domain:${host}`, `https://www.${host}/`, `https://${host}/`, `http://www.${host}/`, `http://${host}/`];
  for (const o of order) { const hit = usable.find((s) => s.url === o); if (hit) return hit.url; }
  throw new Error(`No Search Console property for ${host} is shared with this account. Add the account as a user in Search Console > Settings > Users and permissions. Available: ${usable.map((s) => s.url).join(', ') || 'none'}`);
}

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 864e5);

// Search Console data lags by about two days, so the window ends 2 days ago.
export function dateWindow({ days = 90, lag = 2, from = null, today = new Date() } = {}) {
  const end = addDays(new Date(iso(today) + 'T00:00:00Z'), -lag);
  const start = from ? new Date(from + 'T00:00:00Z') : addDays(end, -(days - 1));
  return { start: iso(start), end: iso(end) };
}

export async function fetchRows(token, site, { start, end, dimensions = ['date', 'query', 'page'], rowLimit = 25000, maxRows = 500000 }, fetchFn = fetch) {
  const out = [];
  for (let startRow = 0; startRow < maxRows; startRow += rowLimit) {
    const j = await gsc(token, `/sites/${encodeURIComponent(site)}/searchAnalytics/query`, {
      method: 'POST',
      body: JSON.stringify({ startDate: start, endDate: end, dimensions, rowLimit, startRow, dataState: 'final' }),
    }, fetchFn);
    const rows = j.rows || [];
    out.push(...rows);
    if (rows.length < rowLimit) break;
  }
  return out;
}

export function normalisePage(u) {
  if (!u) return '';
  try {
    const x = new URL(u);
    const p = x.pathname.replace(/\/+$/, '') || '/';
    return `${x.protocol}//${x.host}${p === '/' ? '/' : p}`;
  } catch { return String(u); }
}

// API rows [date, query, page] -> table rows. Merges rows that normalise to the same key.
export function toMetricRows(apiRows) {
  const map = new Map();
  for (const r of apiRows) {
    const [date, query, page] = r.keys;
    const key = `${date}\u0000${query}\u0000${normalisePage(page)}`;
    const cur = map.get(key);
    if (cur) {
      const impr = cur.impressions + r.impressions;
      cur.position = impr ? (cur.position * cur.impressions + r.position * r.impressions) / impr : cur.position;
      cur.clicks += r.clicks; cur.impressions = impr;
    } else {
      map.set(key, { date, query, page: normalisePage(page), clicks: r.clicks, impressions: r.impressions, position: r.position });
    }
  }
  return [...map.values()].map((m) => ({ ...m, ctr: m.impressions ? +(m.clicks / m.impressions).toFixed(5) : 0, position: +m.position.toFixed(2) }));
}
