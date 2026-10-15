// Run with:  node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePage, analyse, classify, toPath, internalPath, jaccard } from '../seo/lib/seo-audit-lib.mjs';

const SITE = 'https://www.medwaykentremovals.co.uk';
const page = (path, { title = 'A reasonable page title for testing', desc = 'x'.repeat(120), canonical, robots = '', h1 = 'Heading', words = 1200, extra = '', head = '' } = {}) => {
  const url = SITE + path;
  const body = Array.from({ length: words }, (_, i) => 'word' + (i % 400)).join(' ');
  return `<html><head><title>${title}</title><meta name="description" content="${desc}">
    <link rel="canonical" href="${canonical ?? url}">${robots ? `<meta name="robots" content="${robots}">` : ''}${head}</head>
    <body><header><a href="/nav-link">nav</a></header><h1>${h1}</h1><p>${body}</p>${extra}<footer><a href="/foot">f</a></footer></body></html>`;
};
const ctxFor = (paths, over = {}) => ({
  site: SITE,
  sitemap: paths.map((p) => ({ url: SITE + p, path: p, nonHtml: false })),
  robotsTxt: `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml`,
  status: Object.fromEntries(paths.map((p) => [p, 200])),
  redirects: {},
  ...over,
});
const types = (issues) => issues.map((i) => i.type);

test('classify and path helpers', () => {
  assert.equal(classify('/'), 'home');
  assert.equal(classify('/house-removals'), 'service');
  assert.equal(classify('/removals-chatham'), 'town');
  assert.equal(classify('/blog/posts/some-post'), 'post');
  assert.equal(classify('/services'), 'hub');
  assert.equal(toPath('https://www.medwaykentremovals.co.uk/a/b/?x=1#y'), '/a/b');
  assert.equal(internalPath('/blog/posts/x', '/'), '/blog/posts/x');
  assert.equal(internalPath('https://example.com/x'), null);
  assert.equal(internalPath('mailto:a@b.c'), null);
  assert.equal(internalPath('/style.css'), null);
  assert.equal(internalPath('/api/quote'), null);
  assert.equal(internalPath('sibling', '/blog/posts/x'), '/blog/posts/sibling');
});

test('parsePage reads the basics and ignores nav/footer text and links', () => {
  const p = parsePage(page('/removals-x', { extra: '<a href="/house-removals">h</a><img src="a.jpg"><img src="b.jpg" alt="ok">' }), SITE + '/removals-x');
  assert.equal(p.page_type, 'town');
  assert.equal(p.h1_count, 1);
  assert.equal(p.images, 2);
  assert.equal(p.images_missing_alt, 1);
  assert.ok(p.contextual_links.includes('/house-removals'));
  assert.ok(!p.contextual_links.includes('/nav-link'));
  assert.ok(p.all_links.includes('/nav-link'));
  assert.ok(p.word_count >= 1200);
});

test('a healthy page raises no errors or warnings', () => {
  const a = parsePage(page('/house-removals'), SITE + '/house-removals');
  const b = parsePage(page('/storage', { title: 'Another good unique title for storage' , desc: 'y'.repeat(130), extra: '<a href="/house-removals">x</a>' }), SITE + '/storage');
  a.contextual_links = ['/storage']; b.contextual_links = ['/house-removals'];
  const issues = analyse([a, b], ctxFor(['/house-removals', '/storage']));
  assert.deepEqual(issues.filter((i) => i.severity !== 'info'), []);
});

test('missing and badly sized metadata is flagged', () => {
  const html = '<html><head></head><body><h1>a</h1><h1>b</h1><p>hi</p></body></html>';
  const issues = analyse([parsePage(html, SITE + '/blog/posts/p')], ctxFor(['/blog/posts/p']));
  const t = types(issues);
  for (const x of ['title_missing', 'meta_missing', 'canonical_missing', 'h1_count', 'thin_content']) assert.ok(t.includes(x), x);
  assert.equal(issues.find((i) => i.type === 'thin_content').severity, 'error');
  const long = parsePage(page('/storage', { title: 'T'.repeat(80), desc: 'D'.repeat(200) }), SITE + '/storage');
  const t2 = types(analyse([long], ctxFor(['/storage'])));
  assert.ok(t2.includes('title_long') && t2.includes('meta_long'));
});

test('noindex pages listed in the sitemap are errors; pages missing from the sitemap are flagged', () => {
  const ni = parsePage(page('/storage', { robots: 'noindex' }), SITE + '/storage');
  assert.ok(types(analyse([ni], ctxFor(['/storage']))).includes('noindex_in_sitemap'));
  const orphan = parsePage(page('/new-page'), SITE + '/new-page');
  assert.ok(types(analyse([orphan], ctxFor(['/storage']))).includes('not_in_sitemap'));
});

test('a page that points its canonical elsewhere is not asked to be in the sitemap', () => {
  const dup = parsePage(page('/blog/posts/copy', { canonical: SITE + '/removal-costs-kent' }), SITE + '/blog/posts/copy');
  const t = types(analyse([dup], ctxFor(['/storage'])));
  assert.ok(t.includes('canonical_mismatch') && !t.includes('not_in_sitemap'));
});

test('canonical pointing at another page is flagged', () => {
  const p = parsePage(page('/blog/posts/a', { canonical: SITE + '/removal-costs-kent' }), SITE + '/blog/posts/a');
  assert.ok(types(analyse([p], ctxFor(['/blog/posts/a']))).includes('canonical_mismatch'));
});

test('broken and redirecting internal links are reported against the linking page', () => {
  const p = parsePage(page('/storage', { extra: '<a href="/gone">g</a><a href="/moved">m</a>' }), SITE + '/storage');
  const issues = analyse([p], ctxFor(['/storage'], { status: { '/storage': 200, '/gone': 404, '/moved': 301 }, redirects: { '/moved': '/new' } }));
  const broken = issues.find((i) => i.type === 'broken_link');
  assert.equal(broken.severity, 'error');
  assert.equal(broken.issue_key, '/gone');
  assert.ok(issues.some((i) => i.type === 'internal_redirect' && i.issue_key === '/moved'));
});

test('duplicate titles and descriptions are flagged on both pages', () => {
  const a = parsePage(page('/storage', { title: 'Same title for both pages here' }), SITE + '/storage');
  const b = parsePage(page('/man-and-van', { title: 'Same title for both pages here' }), SITE + '/man-and-van');
  const dup = analyse([a, b], ctxFor(['/storage', '/man-and-van'])).filter((i) => i.type === 'dup_title');
  assert.equal(dup.length, 2);
});

test('review claims that differ from the confirmed 5 stars / 50+ reviews are errors', () => {
  const bad = (rv, rc) => `<script type="application/ld+json">{"@type":"LocalBusiness","aggregateRating":{"@type":"AggregateRating","ratingValue":"${rv}","reviewCount":"${rc}"}}</script>`;
  const mk = (rv, rc) => analyse([parsePage(page('/storage', { head: bad(rv, rc) }), SITE + '/storage')], ctxFor(['/storage']));
  assert.ok(!types(mk(5, 50)).includes('review_claim'));
  assert.ok(!types(mk(5, 62)).includes('review_claim'));
  assert.ok(types(mk(4.9, 200)).includes('review_claim'));
  assert.ok(types(mk(5, 12)).includes('review_claim'));
});

test('invalid JSON-LD is an error', () => {
  const p = parsePage(page('/storage', { head: '<script type="application/ld+json">{ not json </script>' }), SITE + '/storage');
  assert.ok(types(analyse([p], ctxFor(['/storage']))).includes('jsonld_invalid'));
});

test('near-duplicate wording between two town pages is noted, different pages are not', () => {
  const base = Array.from({ length: 300 }, (_, i) => 'shared' + i).join(' ');
  const mk = (path, tail) => parsePage(`<html><head><title>${path} title long enough here</title><meta name="description" content="${'d'.repeat(100)}"><link rel="canonical" href="${SITE + path}"></head><body><h1>h</h1><p>${base} ${tail}</p></body></html>`, SITE + path);
  const a = mk('/removals-a', Array.from({ length: 30 }, (_, i) => 'alpha' + i).join(' '));
  const b = mk('/removals-b', Array.from({ length: 30 }, (_, i) => 'beta' + i).join(' '));
  assert.ok(jaccard(a.shingles, b.shingles) > 0.4);
  assert.equal(analyse([a, b], ctxFor(['/removals-a', '/removals-b'])).filter((i) => i.type === 'near_duplicate').length, 2);
  const c = mk('/removals-c', Array.from({ length: 300 }, (_, i) => 'unique' + i).join(' ').replace(/^/, ''));
  c.shingles = new Set(Array.from({ length: 300 }, (_, i) => 'zz' + i));
  assert.equal(analyse([a, c], ctxFor(['/removals-a', '/removals-c'])).filter((i) => i.type === 'near_duplicate').length, 0);
});

test('sitemap and robots problems', () => {
  const ctx = ctxFor(['/storage'], { robotsTxt: 'User-agent: *\nDisallow: /', status: { '/storage': 404, '/llms.txt': 200 } });
  ctx.sitemap.push({ url: SITE + '/llms.txt', path: '/llms.txt', nonHtml: true });
  const t = types(analyse([], ctx));
  for (const x of ['sitemap_dead', 'sitemap_nonhtml', 'robots_no_sitemap', 'robots_blocks_all']) assert.ok(t.includes(x), x);
});

test('weak internal linking is only a note', () => {
  const a = parsePage(page('/blog/posts/a'), SITE + '/blog/posts/a');
  const iss = analyse([a], ctxFor(['/blog/posts/a'])).find((i) => i.type === 'weak_internal_links');
  assert.equal(iss.severity, 'info');
});
