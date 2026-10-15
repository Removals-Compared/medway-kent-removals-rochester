import test from 'node:test';
import assert from 'node:assert/strict';
import { proposeTitles, trimBrand, validateTitle, validateDescription, descriptionsNeeded, proposeRelated, proposeSitemap, applyTitle, applyDescription, applyRelatedLink, removeSitemapEntry, addSitemapEntry } from '../seo/lib/seo-fixes-lib.mjs';

const SITE = 'https://www.medwaykentremovals.co.uk';

test('titles: only the site name is trimmed, only on blog posts, only when that makes the title fit', () => {
  const posts = [
    { path: '/blog/posts/a', title: 'How Long Does a House Removal Take in Medway and Kent? | Medway &amp; Kent Removals Rochester' },
    { path: '/blog/posts/b', title: 'What is goods in transit insurance and why does it matter for your move? | Medway &amp; Kent Removals' },
    { path: '/blog/posts/c', title: 'Short title | Medway &amp; Kent Removals' },
    { path: '/man-and-van', title: 'Man and Van Rochester &amp; Medway | Small Moves Kent | Medway &amp; Kent Removals' },
    { path: '/removals-tunbridge-wells', title: 'Removals Tunbridge Wells | Fully Insured | Medway &amp; Kent Removals' },
  ];
  const { rule, needAi } = proposeTitles(posts);
  assert.deepEqual(rule.map((r) => r.path), ['/blog/posts/a']);
  assert.equal(rule[0].after, 'How Long Does a House Removal Take in Medway and Kent?');
  assert.ok(rule[0].before.includes('& Kent Removals Rochester'), 'before is shown decoded');
  assert.deepEqual(needAi.map((n) => n.path), ['/blog/posts/b'], 'a title still too long without the site name needs a rewrite');
  assert.ok(![...rule, ...needAi].some((x) => x.path === '/man-and-van' || x.path === '/removals-tunbridge-wells'), 'busy pages are never touched');
  assert.equal(trimBrand('Plain title with no site name'), null);
  assert.equal(trimBrand('A | Medway Kent Removals'), 'A');
});

test('AI titles and descriptions are rejected if they break the rules', () => {
  const ok = 'How early should you book a removal company in Kent?';
  assert.equal(validateTitle(ok, 'old'), null);
  assert.match(validateTitle('x'.repeat(70), 'old'), /20 to 60/);
  assert.match(validateTitle('A great title — with a dash here', 'old'), /long dash/);
  assert.match(validateTitle('Cheapest removals in Kent from £99 today', 'old'), /price/);
  assert.match(validateTitle('Award-winning removals across Medway', 'old'), /claim/);
  assert.match(validateTitle(ok, ok), /same as the current/);
  const allowed = new Set([350, 550]);
  const d = (n) => 'A practical guide to planning a house move in Kent, from booking a date to moving day, with tips from a local firm. '.slice(0, n);
  assert.equal(validateDescription(d(130), 'old', allowed), null);
  assert.match(validateDescription(d(60), 'old', allowed), /100 to 155/);
  assert.match(validateDescription(d(130) + ' '.repeat(40) + 'x'.repeat(40), 'old', allowed), /100 to 155/);
  assert.match(validateDescription('Moves from £350 to £999 across Kent, planned by a friendly local team who do this every single week.', 'old', allowed), /£999/);
  assert.equal(validateDescription('Moves from £350 to £550 across Kent, planned by a friendly local team who do this every single week of the year.', 'old', allowed), null);
  assert.match(validateDescription('Fully accredited and award-winning removals across Medway and Kent, with a team that does this every week.', 'old', allowed), /claim/);
});

test('descriptions needing a rewrite: over 160 or under 70, posts only', () => {
  const posts = [{ path: '/blog/posts/a', meta_description: 'x'.repeat(165) }, { path: '/blog/posts/b', meta_description: 'x'.repeat(120) }, { path: '/blog/posts/c', meta_description: 'short one' }, { path: '/services', meta_description: 'x'.repeat(190) }];
  assert.deepEqual(descriptionsNeeded(posts).map((d) => d.path), ['/blog/posts/a', '/blog/posts/c']);
});

test('related links go from related posts that already have a related box, never from the target or an existing linker', () => {
  const mk = (path, o = {}) => ({ path, title: path.split('/').pop().replace(/-/g, ' '), hasRelated: true, links: new Set(), inbound: 5, ...o });
  const posts = [
    mk('/blog/posts/moving-house-in-folkestone', { inbound: 1 }),
    mk('/blog/posts/moving-house-in-dover'),
    mk('/blog/posts/folkestone-moving-tips'),
    mk('/blog/posts/folkestone-parking-guide'),
    mk('/blog/posts/storage-for-students'),
    mk('/blog/posts/folkestone-and-dover-ferry-moves', { links: new Set(['/blog/posts/moving-house-in-folkestone']) }),
    mk('/blog/posts/folkestone-no-box', { hasRelated: false }),
  ];
  const out = proposeRelated(posts);
  assert.deepEqual(out.map((o) => o.path).sort(), ['/blog/posts/folkestone-moving-tips', '/blog/posts/folkestone-parking-guide']);
  assert.ok(out.every((o) => o.kind === 'related_link' && o.after.includes('href="/blog/posts/moving-house-in-folkestone"')));
  assert.ok(!out.some((o) => o.path === '/blog/posts/storage-for-students' || o.path === '/blog/posts/moving-house-in-dover'), 'unrelated posts (no shared topic word) are not used');
  assert.ok(!out.some((o) => o.path === '/blog/posts/folkestone-and-dover-ferry-moves'), 'a post that already links is not used again');
  assert.ok(!out.some((o) => o.path === '/blog/posts/folkestone-no-box'), 'a post with no related-articles box is not used');
  assert.match(out[0].reason, /linked from only 1 other page/);
  const many = proposeRelated([mk('/blog/posts/a-kent-guide-x', { inbound: 0 }), mk('/blog/posts/b-kent-guide-x', { inbound: 0 }), mk('/blog/posts/c-kent-guide-x', { inbound: 0 }), mk('/blog/posts/d-guide-x')], { perSource: 1 });
  const per = {}; many.forEach((m) => { per[m.path] = (per[m.path] || 0) + 1; }); assert.ok(Object.values(per).every((n) => n <= 1), 'a source gains at most the allowed number of links');
});

test('sitemap: removes pages that point elsewhere as canonical, adds missing indexable pages, never thank-you', () => {
  const out = proposeSitemap([
    { path: '/blog/posts/removal-costs-kent-2026-price-guide', canonical: '/removal-costs-kent', indexable: true, inSitemap: true },
    { path: '/privacy-policy', canonical: '/privacy-policy', indexable: true, inSitemap: false },
    { path: '/thank-you', canonical: '/thank-you', indexable: false, inSitemap: false },
    { path: '/about', canonical: '/about', indexable: true, inSitemap: true },
  ], { today: '2026-10-15' });
  assert.deepEqual(out.map((o) => [o.kind, o.path]), [['sitemap_remove', '/blog/posts/removal-costs-kent-2026-price-guide'], ['sitemap_add', '/privacy-policy']]);
});

const page = `<html><head><title>Old long title here that is far too long for Google | Medway &amp; Kent Removals</title>
<meta name="description" content="Old description &amp; more.">
<meta property="og:title" content="Old long title here that is far too long for Google | Medway &amp; Kent Removals">
<meta property="og:description" content="Old description &amp; more.">
<script type="application/ld+json">{"@type":"BlogPosting","headline":"Old heading","description":"Old description & more."}</script></head>
<body><h1>Old heading</h1><div class="related-posts"><h3>More</h3><a href="/storage" class="related-link">Storage</a></div></body></html>`;

test('applying a title edits the title tag and og:title only, and refuses if the page has changed', () => {
  const before = 'Old long title here that is far too long for Google | Medway & Kent Removals';
  const r = applyTitle(page, before, 'Old long title here, short & sweet');
  assert.ok(r.ok);
  assert.match(r.html, /<title>Old long title here, short &amp; sweet<\/title>/);
  assert.match(r.html, /og:title" content="Old long title here, short &amp; sweet"/);
  assert.match(r.html, /<h1>Old heading<\/h1>/);
  assert.match(r.html, /"headline":"Old heading"/, 'the structured-data headline is untouched');
  assert.equal(applyTitle(page, 'something else', 'x').ok, false);
  assert.match(applyTitle(page, 'something else', 'x').why, /changed since/);
});

test('applying a description edits meta, og and structured data, and refuses if the page has changed', () => {
  const r = applyDescription(page, 'Old description & more.', 'A better description, "quoted" & clear.');
  assert.ok(r.ok);
  assert.match(r.html, /name="description" content="A better description, &quot;quoted&quot; &amp; clear\."/);
  assert.match(r.html, /og:description" content="A better description, &quot;quoted&quot; &amp; clear\."/);
  assert.ok(r.html.includes('"description":"A better description, \\"quoted\\" & clear."'));
  assert.equal(applyDescription(page, 'nope', 'x').ok, false);
});

test('applying a related link adds it once, inside the existing box, and nothing else changes', () => {
  const a = '<a href="/blog/posts/new-post" class="related-link">New post</a>';
  const r = applyRelatedLink(page, a);
  assert.ok(r.ok && r.html.includes('class="related-link">Storage</a>' + a + '</div>'));
  assert.equal(r.html.replace(a, ''), page);
  assert.equal(applyRelatedLink(r.html, a).already, true, 'a second application does nothing');
  assert.equal(applyRelatedLink('<html><body>no box</body></html>', a).ok, false);
});

test('sitemap edits remove exactly one entry or add one in the existing style', () => {
  const xml = `<?xml version="1.0"?>\n<urlset>\n  <url>\n    <loc>${SITE}/a</loc>\n    <lastmod>2026-01-01</lastmod>\n  </url>\n  <url>\n    <loc>${SITE}/b</loc>\n    <lastmod>2026-01-01</lastmod>\n  </url>\n</urlset>\n`;
  const r = removeSitemapEntry(xml, '/a', SITE);
  assert.ok(r.ok && !r.html.includes('/a<') && r.html.includes(`${SITE}/b`) && (r.html.match(/<url>/g) || []).length === 1);
  assert.equal(removeSitemapEntry(r.html, '/a', SITE).ok, false);
  const added = addSitemapEntry(xml, '/privacy-policy', SITE, '2026-10-15');
  assert.ok(added.ok && added.html.includes(`<loc>${SITE}/privacy-policy</loc>`) && added.html.trim().endsWith('</urlset>'));
  assert.equal(addSitemapEntry(added.html, '/privacy-policy', SITE, '2026-10-15').already, true);
});
