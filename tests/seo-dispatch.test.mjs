import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL = 'postgres://x';
const { dispatchWorkflow } = await import('../api/admin/_seo.mjs');

const withFetch = async (impl, fn, env = {}) => {
  const real = globalThis.fetch, calls = [], keep = { ...process.env }, err = console.error;
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return impl(url, init); };
  console.error = () => {};
  Object.assign(process.env, env);
  try { return await fn(calls); } finally { globalThis.fetch = real; console.error = err; for (const k of Object.keys(env)) { if (k in keep) process.env[k] = keep[k]; else delete process.env[k]; } }
};
const res = (status, body = {}) => ({ status, json: async () => body });

test('without a token it says exactly that and never calls GitHub', async () => {
  delete process.env.GITHUB_DISPATCH_TOKEN;
  await withFetch(() => res(204), async (calls) => {
    const r = await dispatchWorkflow('audit', 5);
    assert.deepEqual(r, { dispatched: false, reason: 'GITHUB_DISPATCH_TOKEN is not set on this deployment' });
    assert.equal(calls.length, 0);
  });
});

test('a 204 means the workflow was started, with the right request', async () => {
  await withFetch(() => res(204), async (calls) => {
    assert.deepEqual(await dispatchWorkflow('audit', 7), { dispatched: true });
    assert.equal(calls[0].url, 'https://api.github.com/repos/Removals-Compared/medway-kent-removals-rochester/actions/workflows/seo-audit.yml/dispatches');
    assert.equal(calls[0].init.headers.authorization, 'Bearer tok');
    assert.deepEqual(JSON.parse(calls[0].init.body), { ref: 'main', inputs: { job_id: '7' } });
  }, { GITHUB_DISPATCH_TOKEN: 'tok' });
  await withFetch(() => res(204), async (calls) => {
    await dispatchWorkflow('draft', 1); await dispatchWorkflow('ai_check', 2); await dispatchWorkflow('gsc_import', 3);
    assert.deepEqual(calls.map((c) => c.url.split('/workflows/')[1]), ['seo-draft.yml/dispatches', 'seo-ai-check.yml/dispatches', 'seo-gsc-import.yml/dispatches']);
  }, { GITHUB_DISPATCH_TOKEN: 'tok' });
});

test('a refusal from GitHub is reported with its status and message, not hidden', async () => {
  await withFetch(() => res(403, { message: 'Resource not accessible by personal access token' }), async () => {
    const r = await dispatchWorkflow('audit', 1);
    assert.equal(r.dispatched, false);
    assert.equal(r.reason, 'GitHub returned 403: Resource not accessible by personal access token');
  }, { GITHUB_DISPATCH_TOKEN: 'tok' });
  await withFetch(() => res(404, { message: 'Not Found' }), async () => assert.match((await dispatchWorkflow('audit', 1)).reason, /404: Not Found/), { GITHUB_DISPATCH_TOKEN: 'tok' });
  await withFetch(() => res(422, { message: "Workflow does not have 'workflow_dispatch' trigger" }), async () => assert.match((await dispatchWorkflow('audit', 1)).reason, /422/), { GITHUB_DISPATCH_TOKEN: 'tok' });
});

test('a network failure is caught and explained instead of crashing the request', async () => {
  await withFetch(() => { throw new Error('getaddrinfo ENOTFOUND api.github.com'); }, async () => {
    const r = await dispatchWorkflow('audit', 1);
    assert.equal(r.dispatched, false);
    assert.match(r.reason, /could not reach GitHub: getaddrinfo ENOTFOUND/);
  }, { GITHUB_DISPATCH_TOKEN: 'tok' });
});

test('repository and branch can be overridden by environment', async () => {
  await withFetch(() => res(204), async (calls) => {
    await dispatchWorkflow('audit', 1);
    assert.match(calls[0].url, /repos\/Other\/repo\/actions/);
    assert.equal(JSON.parse(calls[0].init.body).ref, 'dev');
  }, { GITHUB_DISPATCH_TOKEN: 'tok', GITHUB_REPO: 'Other/repo', SEO_WORKFLOW_REF: 'dev' });
});
