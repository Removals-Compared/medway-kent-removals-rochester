import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPost, fmtDate, publishedDateOf, jsonLd } from '../seo/lib/seo-post-render.mjs';
import { parsePage } from '../seo/lib/seo-audit-lib.mjs';

const body = (n) => Array.from({ length: n }, (_, i) => 'word' + (i % 200)).join(' ');
const article = (over = {}) => ({
  title: 'Moving house in Gillingham: parking and access',
  meta_description: 'How to plan parking and access for a house move in Gillingham, from permits and narrow roads to loading times, with practical tips from a local firm.',
  slug: 'moving-house-in-gillingham-parking-and-access',
  content: `<h2>Start</h2><p>${body(500)} <a href="/house-removals">House removals</a> and <a href="/removal-costs-kent">costs</a>.</p><h2>Frequently asked questions</h2><h3>How early?</h3><p>Four weeks.</p>`,
  faqs: [{ q: 'How early should I book?', a: 'Four weeks ahead is sensible.' }], keyword: 'moving house gillingham', ...over,
});
const opts = (over = {}) => ({ date: '2026-10-21', related: [{ path: '/house-removals', title: 'House removals' }, { path: '/storage', title: 'Storage' }], ...over });

test('a rendered page is a complete, valid page for the right address', () => {
  const html = renderPost(article(), opts());
  const p = parsePage(html, 'https://www.medwaykentremovals.co.uk/blog/posts/moving-house-in-gillingham-parking-and-access');
  assert.equal(p.title, 'Moving house in Gillingham: parking and access | Medway & Kent Removals');
  assert.equal(p.meta_description, article().meta_description);
  assert.equal(p.canonical, 'https://www.medwaykentremovals.co.uk/blog/posts/moving-house-in-gillingham-parking-and-access');
  assert.equal(p.h1_count, 1);
  assert.equal(p.h1, 'Moving house in Gillingham: parking and access');
  assert.equal(p.jsonld_errors, 0);
  assert.ok(p.schema_types.includes('BlogPosting') && p.schema_types.includes('FAQPage'));
  assert.ok(p.word_count > 500);
  assert.equal(/\{\{[A-Z0-9_]+\}\}/.test(html), false, 'no template placeholders left');
  assert.match(html, /Published 21 Oct 2026 &nbsp;\|&nbsp; 3 min read/);
  assert.match(html, /&copy; 2026 /);
  assert.ok(html.includes('<link rel="stylesheet" href="/style.css">'), 'uses the site stylesheet');
  assert.ok(html.includes('GTM-WQHT5D2L') && html.includes('/sticky-bar.js'), 'keeps the site tracking and call bar like every other post');
});

test('the structured data is valid JSON with the FAQ, and cannot break out of its script tag', () => {
  const html = renderPost(article({ title: 'A </script><b>tricky</b> title & more', faqs: [{ q: 'Q </script>?', a: 'A' }] }), opts());
  const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
  const j = JSON.parse(ld);
  assert.equal(j['@graph'][0].datePublished, '2026-10-21');
  assert.equal(j['@graph'][1]['@type'], 'FAQPage');
  assert.equal(ld.includes('</script'), false);
  assert.ok(/<h1>A &lt;\/script&gt;&lt;b&gt;tricky/.test(html), 'title is escaped in the heading');
  assert.equal(JSON.parse(JSON.stringify(jsonLd({ title: 't', meta_description: 'd', slug: 'x', date: '2026-01-01' })))['@type'], 'BlogPosting', 'no FAQ means a plain BlogPosting');
});

test('related links, dashes and dates', () => {
  const html = renderPost(article({ content: '<h2>A</h2><p>Good value — and honest.</p>' }), opts());
  assert.match(html, /<div class="related-posts"><h3>You might also find useful<\/h3><a href="\/house-removals" class="related-link">House removals<\/a>/);
  assert.equal(html.includes('—'), false, 'long dashes are removed');
  assert.equal(renderPost(article(), opts({ related: [] })).includes('<div class="related-posts">'), false);
  assert.equal(fmtDate('2026-09-05'), '5 Sep 2026');
});

test('an update keeps the original published date and bumps the modified date', () => {
  const first = renderPost(article(), opts({ date: '2026-10-21' }));
  assert.equal(publishedDateOf(first), '2026-10-21');
  const again = renderPost(article(), opts({ date: publishedDateOf(first), modified: '2027-02-03' }));
  assert.match(again, /"datePublished":"2026-10-21"/);
  assert.match(again, /"dateModified":"2027-02-03"/);
  assert.match(again, /Published 21 Oct 2026/);
  assert.match(again, /&copy; 2027 /);
});

test('bad input is refused instead of producing a broken page', () => {
  assert.throws(() => renderPost(article({ slug: 'Bad Slug!' }), opts()), /Invalid slug/);
  assert.throws(() => renderPost(article({ content: '' }), opts()), /required/);
  assert.throws(() => renderPost(article({ title: '' }), opts()), /required/);
});

test('the original published date is found in every form your existing pages use', () => {
  assert.equal(publishedDateOf('..."datePublished": "2026-09-22",...'), '2026-09-22');
  assert.equal(publishedDateOf('..."datePublished":"2026-09-22T10:00:00Z"...'), '2026-09-22');
  assert.equal(publishedDateOf('..."datePublished":"3 Jun 2025","url":"x"'), '2025-06-03');
  assert.equal(publishedDateOf('<p class="post-meta">Published 20 May 2025 &nbsp;|&nbsp; 9 min read</p>'), '2025-05-20');
  assert.equal(publishedDateOf('<p>nothing</p>'), null);
});
