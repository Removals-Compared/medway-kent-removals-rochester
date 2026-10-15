// ════════════════════════════════════════════════════════════
//  One-time helper: sign in to Google and keep a read-only Search Console
//  refresh token. Run it on your own computer, once.
//
//    node scripts/seo-gsc-auth.mjs            reads GSC_CLIENT_ID / GSC_CLIENT_SECRET
//                                             from the environment or ./.env.gsc
//
//  It prints a Google link. Open it, sign in with the account that owns the
//  Search Console property, and press Allow. Google redirects back to this
//  script (127.0.0.1, this computer only). The refresh token is written to
//  ./.env.gsc (owner-only, git-ignored) and is never printed.
//  Scope requested: webmasters.readonly (can read Search Console, nothing else).
// ════════════════════════════════════════════════════════════
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';

const FILE = new URL('../.env.gsc', import.meta.url).pathname;
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

function readEnvFile() {
  try { return Object.fromEntries(fs.readFileSync(FILE, 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])); }
  catch { return {}; }
}
const env = { ...readEnvFile(), ...process.env };
const clientId = env.GSC_CLIENT_ID, clientSecret = env.GSC_CLIENT_SECRET;
if (!clientId || !clientSecret) { console.error('Set GSC_CLIENT_ID and GSC_CLIENT_SECRET (or put them in .env.gsc).'); process.exit(2); }
const hint = (process.argv.find((a) => a.startsWith('--login=')) || '').slice(8);

const verifier = crypto.randomBytes(32).toString('base64url');
const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
const state = crypto.randomBytes(16).toString('hex');

const server = http.createServer();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const redirect = `http://127.0.0.1:${server.address().port}`;

const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: clientId, redirect_uri: redirect, response_type: 'code', scope: SCOPE,
  access_type: 'offline', prompt: 'consent', state, code_challenge: challenge, code_challenge_method: 'S256',
  ...(hint ? { login_hint: hint } : {}),
});
console.log('Open this link, sign in, and press Allow:\n\n' + url + '\n');

const code = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Timed out after 10 minutes.')), 600000);
  server.on('request', (req, res) => {
    const u = new URL(req.url, redirect);
    if (u.pathname !== '/') { res.writeHead(404); return res.end(); }
    const err = u.searchParams.get('error');
    const ok = !err && u.searchParams.get('state') === state && u.searchParams.get('code');
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<body style="font-family:sans-serif;padding:40px"><h2>${ok ? 'Connected' : 'Not connected'}</h2><p>${ok ? 'You can close this tab and go back to Claude.' : 'Google said: ' + (err || 'something was wrong with the request') + '.'}</p></body>`);
    clearTimeout(timer);
    ok ? resolve(u.searchParams.get('code')) : reject(new Error(err || 'state mismatch'));
  });
});
server.close();

const r = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirect, grant_type: 'authorization_code', code_verifier: verifier }),
});
const j = await r.json().catch(() => ({}));
if (!r.ok || !j.refresh_token) { console.error('Google did not return a refresh token:', j.error_description || j.error || r.status); process.exit(1); }
if (!String(j.scope || '').includes('webmasters.readonly')) { console.error('Unexpected scope granted:', j.scope); process.exit(1); }

const keep = Object.entries(readEnvFile()).filter(([k]) => k !== 'GSC_REFRESH_TOKEN');
fs.writeFileSync(FILE, keep.map(([k, v]) => `${k}=${v}`).join('\n') + `\nGSC_REFRESH_TOKEN=${j.refresh_token}\n`, { mode: 0o600 });
console.log('Refresh token saved to .env.gsc (not shown). Scope granted:', j.scope);
