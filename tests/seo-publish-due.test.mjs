import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname;
const SITE = 'https://www.medwaykentremovals.co.uk';
const page = (slug, canonical) => `<!DOCTYPE html><html><head><title>${slug}</title><link rel="canonical" href="${canonical}"><meta name="description" content="d"></head><body><article><h1>${slug}</h1><p>text</p></article></body></html>`;

test('the daily housekeeping adds posts to the sitemap, but not a page whose canonical is another page', () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-'));
  fs.cpSync(path.join(ROOT, 'scripts'), path.join(T, 'scripts'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'seo'), path.join(T, 'seo'), { recursive: true });
  fs.mkdirSync(path.join(T, 'blog/posts'), { recursive: true });
  fs.mkdirSync(path.join(T, 'blog/scheduled'), { recursive: true });
  fs.writeFileSync(path.join(T, 'blog/posts/normal-post.html'), page('normal-post', `${SITE}/blog/posts/normal-post`));
  fs.writeFileSync(path.join(T, 'blog/posts/price-guide-copy.html'), page('price-guide-copy', `${SITE}/removal-costs-kent`));
  fs.writeFileSync(path.join(T, 'blog.html'), '<html><body><div class="blog-grid"></div></body></html>');
  fs.writeFileSync(path.join(T, 'sitemap.xml'), '<?xml version="1.0"?>\n<urlset>\n</urlset>\n');
  execFileSync(process.execPath, [path.join(T, 'scripts/publish-due.mjs')], { cwd: T, env: { ...process.env, PUBLISH_DATE: '2026-10-20' } });
  const sm = fs.readFileSync(path.join(T, 'sitemap.xml'), 'utf8');
  assert.ok(sm.includes(`${SITE}/blog/posts/normal-post`), 'a normal post is added');
  assert.ok(!sm.includes('price-guide-copy'), 'a canonicalised page is left out');
  fs.rmSync(T, { recursive: true, force: true });
});
