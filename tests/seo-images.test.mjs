import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { figureHtml, withFigure, hasFigure, firstBlogImage } from '../seo/lib/seo-images-lib.mjs';
import { renderPost } from '../seo/lib/seo-post-render.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const manifest = JSON.parse(fs.readFileSync(ROOT + 'seo/data/blog-images.json', 'utf8')).images;
const entry = { file: '/images/blog/example.webp', alt: 'A "quoted" <alt> & text', width: 1600, height: 900 };

test('the picture is added once, as the first element, with escaped alt text', () => {
  const html = withFigure('<h2>One</h2><p>Text</p>', entry);
  assert.ok(html.startsWith('<figure'));
  assert.ok(html.includes('alt="A &quot;quoted&quot; &lt;alt&gt; &amp; text"'));
  assert.ok(html.includes('width="1600" height="900"'));
  assert.equal(withFigure(html, entry), html, 'adding it again changes nothing');
  assert.ok(hasFigure(html, entry.file) && !hasFigure('<p>x</p>', entry.file));
  assert.equal(firstBlogImage(html), entry.file);
  assert.equal(firstBlogImage('<img src="/images/logo.webp">'), null);
});

test('every featured image in the manifest is a real, light, honestly described file', () => {
  const entries = Object.entries(manifest);
  assert.equal(entries.length, 15);
  assert.equal(new Set(entries.map(([, e]) => e.file)).size, entries.length, 'no picture is used twice');
  for (const [slug, e] of entries) {
    assert.match(slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.equal(e.file, `/images/blog/${slug}.webp`);
    const stat = fs.statSync(ROOT + e.file.slice(1));
    assert.ok(stat.size > 10_000 && stat.size < 300_000, `${slug} is ${stat.size} bytes`);
    assert.ok(e.alt.length >= 10 && e.alt.length <= 125, `${slug} alt length`);
    assert.ok(!/\b(our|we|medway|kent removals|team|crew)\b/i.test(e.alt), `${slug}: the description must not claim the photo shows the company`);
    assert.ok(!/[–—]/.test(e.alt));
  }
});

test('a rendered post with a picture gets og:image and structured-data image; one without does not', () => {
  const base = { title: 'A test title for the page', meta_description: 'x'.repeat(130), slug: 'a-test-post', faqs: [] };
  const body = '<h2>One</h2><p>' + 'word '.repeat(50) + '</p>';
  const withPic = renderPost({ ...base, content: withFigure(body, entry) }, { date: '2026-10-20' });
  assert.ok(withPic.includes('<meta property="og:image" content="https://www.medwaykentremovals.co.uk/images/blog/example.webp">'));
  assert.ok(withPic.includes('"image":"https://www.medwaykentremovals.co.uk/images/blog/example.webp"'));
  const without = renderPost({ ...base, content: body }, { date: '2026-10-20' });
  assert.ok(!without.includes('og:image') && !without.includes('"image":'));
});
