import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { authMode, signServiceAccountJwt, getAccessToken, pickSite, dateWindow, fetchRows, toMetricRows, normalisePage } from '../scripts/seo-gsc-lib.mjs';

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const sa = { client_email: 'seo@proj.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };

test('auth mode follows the env vars present', () => {
  assert.equal(authMode({}), null);
  assert.equal(authMode({ GSC_SERVICE_ACCOUNT_JSON: '{}' }), 'service_account');
  assert.equal(authMode({ GSC_CLIENT_ID: 'a', GSC_CLIENT_SECRET: 'b', GSC_REFRESH_TOKEN: 'c' }), 'oauth');
  assert.equal(authMode({ GSC_CLIENT_ID: 'a', GSC_CLIENT_SECRET: 'b' }), null);
});

test('service-account JWT is correctly formed, read-only scoped and verifiably signed', () => {
  const jwt = signServiceAccountJwt(sa, 1000);
  const [h, c, s] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { alg: 'RS256', typ: 'JWT' });
  const claim = JSON.parse(Buffer.from(c, 'base64url'));
  assert.equal(claim.iss, sa.client_email);
  assert.equal(claim.scope, 'https://www.googleapis.com/auth/webmasters.readonly');
  assert.equal(claim.exp - claim.iat, 3600);
  assert.ok(crypto.createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(s, 'base64url')));
});

test('token exchange: service account JSON as text or base64, and a clear error on refusal', async () => {
  const calls = [];
  const ok = async (url, init) => { calls.push({ url, body: String(init.body) }); return { ok: true, status: 200, json: async () => ({ access_token: 'tok' }) }; };
  assert.equal(await getAccessToken({ GSC_SERVICE_ACCOUNT_JSON: JSON.stringify(sa) }, ok), 'tok');
  assert.equal(await getAccessToken({ GSC_SERVICE_ACCOUNT_JSON: Buffer.from(JSON.stringify(sa)).toString('base64') }, ok), 'tok');
  assert.match(calls[0].body, /grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer/);
  assert.equal(await getAccessToken({ GSC_CLIENT_ID: 'a', GSC_CLIENT_SECRET: 'b', GSC_REFRESH_TOKEN: 'c' }, ok), 'tok');
  assert.match(calls[2].body, /grant_type=refresh_token/);
  const bad = async () => ({ ok: false, status: 400, json: async () => ({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }) });
  await assert.rejects(getAccessToken({ GSC_CLIENT_ID: 'a', GSC_CLIENT_SECRET: 'b', GSC_REFRESH_TOKEN: 'c' }, bad), /expired or revoked.*service account avoids this/s);
  await assert.rejects(getAccessToken({}), /not connected/);
});

test('property choice prefers the domain property and explains a missing share', () => {
  const sites = [{ url: 'https://www.medwaykentremovals.co.uk/', level: 'siteOwner' }, { url: 'sc-domain:medwaykentremovals.co.uk', level: 'siteFullUser' }, { url: 'sc-domain:other.com', level: 'siteOwner' }];
  assert.equal(pickSite(sites), 'sc-domain:medwaykentremovals.co.uk');
  assert.equal(pickSite(sites.slice(0, 1)), 'https://www.medwaykentremovals.co.uk/');
  assert.equal(pickSite(sites, 'https://www.medwaykentremovals.co.uk/'), 'https://www.medwaykentremovals.co.uk/');
  assert.throws(() => pickSite([{ url: 'sc-domain:other.com', level: 'siteOwner' }]), /Users and permissions/);
  assert.throws(() => pickSite(sites, 'sc-domain:nope.com'), /not available/);
  assert.throws(() => pickSite([{ url: 'sc-domain:medwaykentremovals.co.uk', level: 'siteUnverifiedUser' }]), /No Search Console property/);
});

test('date window ends two days ago and honours a start date', () => {
  const today = new Date('2026-10-15T12:00:00Z');
  assert.deepEqual(dateWindow({ days: 90, today }), { start: '2026-07-16', end: '2026-10-13' });
  assert.deepEqual(dateWindow({ from: '2026-10-01', today }), { start: '2026-10-01', end: '2026-10-13' });
});

test('rows are fetched page by page until a short page comes back', async () => {
  const pages = [Array(3).fill({ keys: ['2026-10-01', 'q', 'https://x/'], clicks: 1, impressions: 2, position: 3 }), Array(3).fill({ keys: ['2026-10-02', 'q', 'https://x/'], clicks: 1, impressions: 2, position: 3 }), [{ keys: ['2026-10-03', 'q', 'https://x/'], clicks: 1, impressions: 2, position: 3 }]];
  const sent = [];
  const f = async (url, init) => { const b = JSON.parse(init.body); sent.push(b); return { ok: true, status: 200, json: async () => ({ rows: pages[b.startRow / 3] }) }; };
  const rows = await fetchRows('tok', 'sc-domain:x', { start: '2026-10-01', end: '2026-10-03', rowLimit: 3 }, f);
  assert.equal(rows.length, 7);
  assert.deepEqual(sent.map((s) => s.startRow), [0, 3, 6]);
  assert.deepEqual(sent[0].dimensions, ['date', 'query', 'page']);
  const err = async () => ({ ok: false, status: 403, json: async () => ({ error: { message: 'User does not have sufficient permission' } }) });
  await assert.rejects(fetchRows('tok', 's', { start: 'a', end: 'b' }, err), /403: User does not have sufficient permission/);
});

test('rows are normalised and duplicates merged with impression-weighted position', () => {
  assert.equal(normalisePage('https://www.medwaykentremovals.co.uk/storage/'), 'https://www.medwaykentremovals.co.uk/storage');
  assert.equal(normalisePage('https://www.medwaykentremovals.co.uk/'), 'https://www.medwaykentremovals.co.uk/');
  // address variants of the same page merge onto the canonical https://www form
  assert.equal(normalisePage('https://medwaykentremovals.co.uk/'), 'https://www.medwaykentremovals.co.uk/');
  assert.equal(normalisePage('http://medwaykentremovals.co.uk/storage/'), 'https://www.medwaykentremovals.co.uk/storage');
  assert.equal(normalisePage('http://www.medwaykentremovals.co.uk/storage'), 'https://www.medwaykentremovals.co.uk/storage');
  assert.equal(normalisePage('https://other.example/x/'), 'https://other.example/x');
  const out = toMetricRows([
    { keys: ['2026-10-01', 'storage', 'https://www.medwaykentremovals.co.uk/storage/'], clicks: 1, impressions: 10, position: 4 },
    { keys: ['2026-10-01', 'storage', 'http://medwaykentremovals.co.uk/storage'], clicks: 0, impressions: 30, position: 8 },
  ]);
  assert.equal(out.length, 1);
  assert.deepEqual([out[0].clicks, out[0].impressions, out[0].position, out[0].ctr], [1, 40, 7, 0.025]);
});
