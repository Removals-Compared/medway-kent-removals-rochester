import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseJson, makeClaude, runDraft, slugify, researchPrompt } from '../seo/lib/seo-draft-lib.mjs';
import { allowedAmountsFrom } from '../seo/lib/seo-quality-lib.mjs';

const pricing = fs.readFileSync(new URL('../pricing.md', import.meta.url), 'utf8');
const facts = JSON.parse(fs.readFileSync(new URL('../seo/business-facts.json', import.meta.url), 'utf8'));
const pages = [{ path: '/house-removals', title: 'House removals' }, { path: '/removal-costs-kent', title: 'Removal costs in Kent' }, { path: '/removals-chatham', title: 'Removals Chatham' }];
const ctx = () => ({ facts, pricing, pages, corpus: [], existingSlugs: new Set(), allowedAmounts: allowedAmountsFrom(pricing), sitePaths: new Set(pages.map((p) => p.path)), model: 'test-model' });
const body = (n, seed) => Array.from({ length: n }, (_, i) => seed + (i % 250)).join(' ');
const research = { intent: 'planning a move', audience: 'Chatham homeowners', angle: 'local access detail', outline: [{ h2: 'a', points: [] }, { h2: 'b', points: [] }, { h2: 'c', points: [] }], faq: [{ q: 'q?' }], internal_links: [{ path: '/house-removals', anchor: 'house removals' }], claims_to_verify: ['Check Chatham parking rules'], avoid: [] };
const article = (extra = '') => ({ title: 'House removals in Chatham: what to plan — and when', meta_description: 'A practical guide to planning house removals in Chatham, covering booking, access, parking and moving day, from a local Medway firm.', slug: 'House Removals In Chatham!', content_html: `<h2>Start</h2><p>${body(440, 'alpha')}</p><h2>Middle</h2><p>${body(440, 'beta')}</p><h2>End</h2><p>${body(440, 'gamma')} house removals in chatham. <a href="/house-removals">House removals</a> and <a href="/removal-costs-kent">costs</a>.${extra}</p>`, faqs: [{ q: 'How early?', a: 'Four weeks.' }], image_suggestions: [{ description: 'boxes', alt: 'Boxes in a hallway' }], claims_to_verify: ['Confirm Saturday availability'] });
const stub = (replies) => { const calls = []; const f = async (a) => { calls.push(a); const r = replies.shift(); if (r instanceof Error) throw r; return typeof r === 'string' ? r : JSON.stringify(r); }; f.calls = calls; return f; };
const input = { keyword: 'house removals in chatham', kind: 'post', evidence: { impressions: 340 } };

test('slugify and parseJson cope with messy model output', () => {
  assert.equal(slugify('House Removals & Storage in Chatham!'), 'house-removals-and-storage-in-chatham');
  assert.deepEqual(parseJson('Sure!\n```json\n{"a": "x}y", "b": [1, {"c": 2}]}\n```\nDone'), { a: 'x}y', b: [1, { c: 2 }] });
  assert.throws(() => parseJson('no json here'), /no JSON/);
  assert.throws(() => parseJson('{"a": 1'), /cut off/);
});

test('three separate steps run in order and the result is cleaned and scored', async () => {
  const llm = stub([research, article(), { unsupported: [{ claim: 'We are the best in Kent', why: 'not in the facts' }], verdict: 'needs_owner_check' }]);
  const steps = [];
  const out = await runDraft({ input, ctx: ctx(), llm, onStep: (s) => steps.push(s) });
  assert.deepEqual(steps, ['researching', 'drafting', 'quality_check']);
  assert.equal(llm.calls.length, 3);
  assert.match(llm.calls[0].system, /SEO researcher/);
  assert.match(llm.calls[1].system, /copywriter/);
  assert.match(llm.calls[2].system, /fact-checker/);
  assert.match(llm.calls[0].user, /removals-chatham|chatham/i);
  assert.ok(llm.calls[0].user.includes('£350'), 'the price list is given to the researcher');
  const r = out.revision;
  assert.equal(r.title.includes('—'), false, 'long dash removed');
  assert.equal(r.meta.slug, 'house-removals-in-chatham');
  assert.equal(r.meta.generated.review_verdict, 'needs_owner_check');
  assert.ok(r.meta.claims_to_verify.some((c) => c.includes('best in Kent')) && r.meta.claims_to_verify.some((c) => c.includes('Chatham parking')) && r.meta.claims_to_verify.some((c) => c.includes('Saturday')));
  assert.equal(out.quality.critical_count, 0, JSON.stringify(out.quality.findings.filter((f) => f.severity === 'critical')));
  assert.ok(out.quality.findings.some((f) => f.code === 'check_this'));
});

test('an invented price in the draft is caught by the gate even though the model produced it', async () => {
  const llm = stub([research, article('<p>Our packing service costs just £42.</p>'), { unsupported: [], verdict: 'ok' }]);
  const out = await runDraft({ input, ctx: ctx(), llm });
  assert.ok(out.quality.findings.some((f) => f.code === 'unverified_price' && f.severity === 'critical'));
  assert.ok(out.quality.critical_count >= 1);
});

test('a bad reply is retried once with the reason, and a second failure is a clear error', async () => {
  const ok = stub(['not json at all', research, article(), { unsupported: [], verdict: 'ok' }]);
  await runDraft({ input, ctx: ctx(), llm: ok });
  assert.match(ok.calls[1].user, /previous reply was rejected: no JSON/);
  const bad = stub([research, { title: 'x' }, { title: 'x' }]);
  await assert.rejects(runDraft({ input, ctx: ctx(), llm: bad }), /Writing step failed: "meta_description" must be a non-empty string/);
});

test('if the fact-check step breaks, the owner is told to check by hand instead of the draft being lost', async () => {
  const llm = stub([research, article(), 'garbage', 'garbage']);
  const out = await runDraft({ input, ctx: ctx(), llm });
  assert.equal(out.revision.meta.generated.review_verdict, 'needs_owner_check');
  assert.ok(out.revision.meta.claims_to_verify.some((c) => c.includes('automatic fact-check could not run')));
});

test('the Claude client retries server errors and rate limits but not bad requests', async () => {
  const mk = (responses) => { const seen = []; const f = async (url, init) => { seen.push(JSON.parse(init.body)); const r = responses.shift(); return { ok: r.status < 300, status: r.status, json: async () => r.body }; }; f.seen = seen; return f; };
  const f1 = mk([{ status: 529, body: { error: { message: 'overloaded' } } }, { status: 429, body: { error: { message: 'slow down' } } }, { status: 200, body: { content: [{ type: 'text', text: 'hello' }] } }]);
  const out = await makeClaude({ apiKey: 'k', model: 'm', fetchFn: f1, sleep: async () => {} })({ system: 's', user: 'u' });
  assert.equal(out, 'hello'); assert.equal(f1.seen.length, 3); assert.equal(f1.seen[0].model, 'm');
  const f2 = mk([{ status: 400, body: { error: { message: 'bad model' } } }]);
  await assert.rejects(makeClaude({ apiKey: 'k', fetchFn: f2, sleep: async () => {} })({ system: 's', user: 'u' }), /Claude API 400: bad model/);
  assert.equal(f2.seen.length, 1);
});

test('a too-short draft is automatically expanded; if expansion fails the gate still blocks it', async () => {
  const short = { ...article(), content_html: `<h2>Start</h2><p>${body(200, 'alpha')} house removals in chatham</p><h2>b</h2><p>${body(200, 'beta')}</p><h2>c</h2><p>${body(100, 'gamma')} <a href="/house-removals">a</a> <a href="/removal-costs-kent">b</a></p>` };
  const llm = stub([research, short, { content_html: article().content_html }, { unsupported: [], verdict: 'ok' }]);
  const out = await runDraft({ input, ctx: ctx(), llm });
  assert.equal(llm.calls.length, 4);
  assert.match(llm.calls[2].user, /too short/);
  assert.ok(out.quality.stats.words >= 1200, 'expanded to ' + out.quality.stats.words);
  assert.ok(!out.quality.findings.some((f) => f.code === 'too_short'));
  const llm2 = stub([research, short, 'garbage', 'garbage', { unsupported: [], verdict: 'ok' }]);
  const out2 = await runDraft({ input, ctx: ctx(), llm: llm2 });
  assert.ok(out2.quality.findings.some((f) => f.code === 'too_short' && f.severity === 'critical'), 'a failed expansion leaves the draft blocked, not published short');
  const llm3 = stub([research, { ...short, slug: 'something-else' }, { content_html: article().content_html }, { unsupported: [], verdict: 'ok' }]);
  const out3 = await runDraft({ input: { ...input, keep_slug: 'the-original-slug' }, ctx: ctx(), llm: llm3 });
  assert.equal(out3.revision.meta.slug, 'the-original-slug', 'a redraft keeps the address that was scheduled');
});

test('the research step has room to finish (a cut-off reply failed a real run)', () => {
  assert.ok(researchPrompt({ facts, pricing, pages, input }).maxTokens >= 6000);
});

test('the research prompt carries the rules that stop invented facts', () => {
  const p = researchPrompt({ facts, pricing, pages, input });
  for (const s of ['Never use em dashes', 'Never invent prices', 'ONLY the facts supplied']) assert.ok(p.system.includes(s) || p.system.toLowerCase().includes(s.toLowerCase()), s);
});

test('when rewriting a live post, the researcher is shown the text that is already there', () => {
  const withText = researchPrompt({ facts, pricing, pages, input: { ...input, existing_text: 'Old short text about completion day.' } });
  assert.match(withText.user, /EXISTING ARTICLE TEXT/);
  assert.match(withText.user, /Old short text about completion day\./);
  assert.doesNotMatch(researchPrompt({ facts, pricing, pages, input }).user, /EXISTING ARTICLE TEXT/);
});
