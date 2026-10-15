import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkDraft, cleanWriting, allowedAmountsFrom, amountsIn, corpusEntry, keyOf } from '../scripts/seo-quality-lib.mjs';

const pricing = fs.readFileSync(new URL('../pricing.md', import.meta.url), 'utf8');
const allowedAmounts = allowedAmountsFrom(pricing);
const sitePaths = new Set(['/', '/house-removals', '/man-and-van', '/removal-costs-kent', '/blog/posts/moving-house-checklist-medway']);
const para = (n, seed = 'word') => `<p>${Array.from({ length: n }, (_, i) => seed + (i % 300)).join(' ')}</p>`;
const good = () => ({
  title: 'Moving house in Rochester: a practical guide',
  meta_description: 'A practical, honest guide to planning a house move in Rochester, from booking a date to what to do on the day. Written by a local firm.',
  slug: 'moving-house-in-rochester-guide',
  keyword: 'moving house rochester',
  content: `<h2>One</h2>${para(300, 'alpha')}<h2>Two</h2>${para(300, 'beta')}<h2>Three</h2>${para(300, 'gamma')}<p>See <a href="/house-removals">house removals</a> and our <a href="/removal-costs-kent">cost guide</a>. Moving house rochester is easier with a plan.</p>`,
});
const ctx = () => ({ allowedAmounts, sitePaths, existingSlugs: new Set(['storage']), corpus: [] });
const codes = (r, sev) => r.findings.filter((f) => !sev || f.severity === sev).map((f) => f.code);

test('pricing.md amounts are read as the allowed list', () => {
  assert.ok(allowedAmounts.has(350) && allowedAmounts.has(1150) && allowedAmounts.has(900));
  assert.ok(!allowedAmounts.has(80));
  assert.deepEqual(amountsIn('from £1,150 to £2,000.50'), [1150, 2000.5]);
});

test('a clean, well-formed draft passes with no critical findings', () => {
  const r = checkDraft({ ...good(), hasImage: true }, ctx());
  assert.equal(r.critical_count, 0, JSON.stringify(codes(r, 'critical')));
  assert.ok(r.score >= 90);
});

test('prices must come from pricing.md; owner can acknowledge a specific one', () => {
  const d = good(); d.content += '<p>Van hire costs £80 to £150 and a 3 bedroom move is from £550.</p>';
  const r = checkDraft(d, ctx());
  const bad = r.findings.filter((f) => f.code === 'unverified_price');
  assert.deepEqual(bad.map((f) => f.detail).sort(), ['£150', '£80']);
  assert.equal(r.critical_count, 2);
  const r2 = checkDraft(d, { ...ctx(), acknowledged: new Set(bad.map((f) => f.key)) });
  assert.equal(r2.critical_count, 0);
  assert.equal(r2.findings.filter((f) => f.severity === 'acknowledged').length, 2);
  // an acknowledgement is tied to the exact amount: a new bad price is still critical
  d.content += '<p>Packing is £999.</p>';
  assert.equal(checkDraft(d, { ...ctx(), acknowledged: new Set(bad.map((f) => f.key)) }).critical_count, 1);
});

test('invented credentials, awards, years, superlatives, staff vetting and testimonials are critical', () => {
  const claims = [
    'We are an award-winning removals firm.', 'We are fully accredited by the BAR.', 'With 15 years of experience we move you safely.',
    'Trading since 2009 across Kent.', 'We are the cheapest in Medway.', 'All our staff are DBS checked.',
    'Rated 4.9 stars by customers.', 'Over 200 reviews say so.', 'Our fleet of 8 vans is ready.',
    '"They were wonderful and nothing was damaged at all", Sarah Jones',
  ];
  for (const c of claims) {
    const d = good(); d.content += `<p>${c}</p>`;
    assert.ok(codes(checkDraft(d, ctx()), 'critical').includes('unverified_claim'), c);
  }
  const ok = good(); ok.content += '<p>We have 5 stars from 50+ Google reviews and goods in transit insurance.</p>';
  assert.equal(codes(checkDraft(ok, ctx()), 'critical').includes('unverified_claim'), false);
});

test('structure problems are critical: h1, scripts, placeholders, too short, bad slug, taken slug', () => {
  const t = (mut, code) => { const d = good(); mut(d); assert.ok(codes(checkDraft(d, ctx()), 'critical').includes(code), code); };
  t((d) => { d.content = '<h1>Hi</h1>' + d.content; }, 'h1_in_body');
  t((d) => { d.content += '<script>alert(1)</script>'; }, 'unsafe_markup');
  t((d) => { d.content += '<p onclick="x()">hi</p>'; }, 'unsafe_markup');
  t((d) => { d.content += '<p>[insert price here]</p>'; }, 'placeholder_text');
  t((d) => { d.content = '<h2>a</h2><p>too short</p>'; }, 'too_short');
  t((d) => { d.slug = 'Bad Slug!'; }, 'slug_invalid');
  t((d) => { d.slug = 'storage'; }, 'slug_taken');
  t((d) => { d.meta_description = ''; }, 'meta_missing');
  t((d) => { d.title = ''; }, 'title_missing');
});

test('links: unknown internal pages are critical, few links is a warning, external is a note', () => {
  const d = good(); d.content += '<a href="/not-a-page">x</a><a href="https://example.com/x">y</a>';
  const r = checkDraft(d, ctx());
  assert.ok(codes(r, 'critical').includes('broken_internal_link'));
  assert.ok(codes(r, 'info').includes('external_link'));
  const few = good(); few.content = few.content.replace(/<a [^>]*>[^<]*<\/a>/g, 'text');
  assert.ok(codes(checkDraft(few, ctx()), 'warn').includes('few_internal_links'));
});

test('keyword stuffing is critical, a missing keyword is a warning', () => {
  const d = good(); d.content += `<p>${'moving house rochester '.repeat(60)}</p>`;
  assert.ok(codes(checkDraft(d, ctx()), 'critical').includes('keyword_stuffing'));
  const m = good(); m.title = 'A practical guide to planning your move'; m.keyword = 'storage in chatham';
  assert.ok(codes(checkDraft(m, ctx()), 'warn').includes('keyword_missing'));
});

test('near-duplicate of an existing page is critical; similar is a warning; different is fine', () => {
  const d = good();
  const same = corpusEntry('/removals-chatham', d.content);
  assert.ok(codes(checkDraft(d, { ...ctx(), corpus: [same] }), 'critical').includes('near_duplicate'));
  const other = corpusEntry('/x', `<p>${Array.from({ length: 900 }, (_, i) => 'zeta' + i).join(' ')}</p>`);
  assert.ok(!codes(checkDraft(d, { ...ctx(), corpus: [other] })).includes('near_duplicate'));
});

test('long dashes are cleaned and the owner is told what to check', () => {
  assert.equal(cleanWriting('Good value — and honest.'), 'Good value, and honest.');
  assert.equal(cleanWriting('It ended. — Next.'), 'It ended. Next.');
  const r = checkDraft({ ...good(), claims_to_verify: ['Check the parking rules in Strood'] }, ctx());
  assert.ok(codes(r, 'info').includes('check_this'));
  assert.equal(keyOf('a', 'b'), keyOf('a', 'b'));
  assert.notEqual(keyOf('a', 'b'), keyOf('a', 'c'));
});
