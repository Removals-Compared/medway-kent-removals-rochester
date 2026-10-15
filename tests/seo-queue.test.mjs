import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQueuedPost, parseBarePost } from '../scripts/seo-queue-lib.mjs';

const file = `<!DOCTYPE html><html><head><title>The Real Cost of DIY vs Professional Removal in Kent | Medway Kent Removals</title>
<meta name="description" content="Hiring &amp; doing it yourself seems cheaper. But is it?"></head><body>
<article class="blog-post">
<h1>The Real Cost of DIY vs Professional Removal in Kent</h1>
<p class="blog-meta">By Amos Osho, Founder of Medway and Kent Removals | October 2026</p>
<p>First paragraph.</p>
<h2>Section</h2><p>More.</p>
</article><a id="wa-float" href="#">WhatsApp</a></body></html>`;

test('a queued post is split into title, description, body and the template parts', () => {
  const p = parseQueuedPost(file, '2026-10-20-the-real-cost-of-diy-vs-professional-removal-kent.html');
  assert.equal(p.date, '2026-10-20');
  assert.equal(p.slug, 'the-real-cost-of-diy-vs-professional-removal-kent');
  assert.equal(p.title, 'The Real Cost of DIY vs Professional Removal in Kent');
  assert.equal(p.meta_description, 'Hiring & doing it yourself seems cheaper. But is it?');
  assert.ok(p.content.startsWith('<p>First paragraph.</p>'), p.content.slice(0, 40));
  assert.ok(!/<h1|blog-meta|<\/article>/.test(p.content), 'template parts are kept out of the editable body');
  assert.match(p.blog_meta_html, /By Amos Osho/);
});

test('files that are not queue posts are refused clearly', () => {
  assert.throws(() => parseQueuedPost(file, 'about.html'), /Not a queue file name/);
  assert.throws(() => parseQueuedPost('<html><body>no article</body></html>', '2026-10-20-x.html'), /No <article>/);
});

test('a live post in the bare format is read with its slug, original date and body', () => {
  const live = file.replace('<head>', '<head><script type="application/ld+json">{"@type":"BlogPosting","datePublished": "2026-09-22"}</script>');
  const p = parseBarePost(live, 'the-real-cost-of-diy-vs-professional-removal-kent');
  assert.equal(p.slug, 'the-real-cost-of-diy-vs-professional-removal-kent');
  assert.equal(p.title, 'The Real Cost of DIY vs Professional Removal in Kent');
  assert.equal(p.date, '2026-09-22');
  assert.ok(p.content.startsWith('<p>First paragraph.</p>') && !/<h1|blog-meta/.test(p.content));
  assert.throws(() => parseBarePost('<html><body><div class="post-body">x</div></body></html>', 'x'), /not in the bare post format/);
});
