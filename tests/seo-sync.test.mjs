import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesRevision, renderFile, renderInner, articleInner } from '../scripts/seo-sync-lib.mjs';
import { parseQueuedPost } from '../scripts/seo-queue-lib.mjs';

const file = `<!DOCTYPE html><html><head><title>Old title | Medway Kent Removals</title>
<meta name="description" content="Old description.">
<meta property="og:title" content="Old title | Medway Kent Removals"><meta property="og:description" content="Old description.">
<script type="application/ld+json">{"@context": "https://schema.org", "@type": "BlogPosting", "headline": "Old title", "description": "Old description.", "author": {"@type": "Person", "name": "Amos Osho"}}</script>
</head><body>
<article class="blog-post">
<h1>Old title</h1>
<p class="blog-meta">By Amos Osho | October 2026</p>
<p>Old body &amp; more.</p>
</article><a id="wa-float" href="#">chat</a></body></html>`;
const imported = () => { const p = parseQueuedPost(file, '2026-10-20-old-title.html'); return { title: p.title, meta_description: p.meta_description, content: p.content, meta: { blog_meta_html: p.blog_meta_html } }; };

test('an unedited import equals its own file', () => assert.equal(matchesRevision(file, imported()), true));

test('any change to the approved text means the file no longer matches', () => {
  assert.equal(matchesRevision(file, { ...imported(), content: imported().content + '<p>extra</p>' }), false);
  assert.equal(matchesRevision(file, { ...imported(), title: 'Different' }), false);
  assert.equal(matchesRevision('<html>no article</html>', imported()), false);
});

test('rendering writes the approved version into body, title, description, social tags and structured data, and nothing else', () => {
  const rev = { title: 'New & better title', meta_description: 'A "quoted" new description.', content: '<h2>Fresh</h2><p>New body.</p>', meta: { blog_meta_html: '<p class="blog-meta">By Amos Osho | October 2026</p>' } };
  const out = renderFile(file, rev);
  assert.equal(matchesRevision(out, rev), true);
  assert.match(out, /<title>New &amp; better title \| Medway Kent Removals<\/title>/);
  assert.match(out, /<meta name="description" content="A &quot;quoted&quot; new description\.">/);
  assert.match(out, /og:title" content="New &amp; better title \| Medway Kent Removals"/);
  const ld = JSON.parse(out.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(ld.headline, 'New & better title');
  assert.equal(ld.description, 'A "quoted" new description.');
  assert.equal(ld.author.name, 'Amos Osho');
  assert.match(out, /<a id="wa-float" href="#">chat<\/a>/, 'content outside the article is untouched');
  assert.equal(articleInner(out).includes('Old body'), false);
  assert.throws(() => renderFile('<html></html>', rev), /no <article>/);
  assert.ok(renderInner(rev).startsWith('\n<h1>New &amp; better title</h1>'));
});

test('the brand name is only added to the page title when the whole title still fits in 60 characters', () => {
  const base = { meta_description: 'd', content: '<h2>x</h2><p>y</p>', meta: {} };
  const long = renderFile(file, { ...base, title: 'A rather long article title that is about fifty chars' });
  assert.match(long, /<title>A rather long article title that is about fifty chars<\/title>/);
  assert.match(renderFile(file, { ...base, title: 'Short title' }), /<title>Short title \| Medway Kent Removals<\/title>/);
});
