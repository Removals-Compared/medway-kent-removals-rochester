// Access control for api/admin/seo.mjs. These requests are refused BEFORE any
// database call, so no DATABASE_URL is needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.ADMIN_SESSION_SECRET = 'test-secret-for-seo-tests';
delete process.env.DATABASE_URL;
const { default: handler } = await import('../api/admin/seo.mjs');
const { makeSessionCookie } = await import('../api/admin/_session.mjs');

const call = async (req) => {
  let code, body;
  const res = { status(c) { code = c; return this; }, json(b) { body = b; return this; }, setHeader() {} };
  await handler({ method: 'GET', query: {}, headers: {}, body: {}, ...req }, res);
  return { code, body };
};
const cookieOf = (setCookie) => setCookie.split(';')[0];

test('no session is refused with 401', async () => {
  for (const action of ['status', 'overview', 'pages', 'issues', 'jobs', 'articles']) {
    assert.equal((await call({ query: { action } })).code, 401, action);
  }
  assert.equal((await call({ method: 'POST', query: { action: 'run_audit' } })).code, 401);
});

test('a forged or tampered cookie is refused', async () => {
  const forged = 'admin_session=' + Date.now() + '.admin.' + crypto.randomBytes(32).toString('hex');
  assert.equal((await call({ query: { action: 'overview' }, headers: { cookie: forged } })).code, 401);
});

test('staff sessions get 403 on every action, including writes', async () => {
  const staff = cookieOf(makeSessionCookie('staff', 'Sam'));
  for (const action of ['status', 'overview', 'pages', 'issues', 'jobs', 'articles']) {
    assert.equal((await call({ query: { action }, headers: { cookie: staff } })).code, 403, action);
  }
  assert.equal((await call({ method: 'POST', query: { action: 'run_audit' }, headers: { cookie: staff } })).code, 403);
  assert.equal((await call({ method: 'POST', query: { action: 'decide_many' }, headers: { cookie: staff }, body: { items: [{ article_id: 1, revision_id: 1 }] } })).code, 403);
  assert.equal((await call({ method: 'POST', query: { action: 'issue' }, headers: { cookie: staff }, body: { id: 1, status: 'ignored' } })).code, 403);
});

test('an admin session passes the gate (then fails on the missing database, not on auth)', async () => {
  const admin = cookieOf(makeSessionCookie('admin'));
  const r = await call({ query: { action: 'overview' }, headers: { cookie: admin } });
  assert.notEqual(r.code, 401);
  assert.notEqual(r.code, 403);
});
