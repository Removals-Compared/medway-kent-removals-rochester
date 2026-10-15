// ════════════════════════════════════════════════════════════
//  Publishes APPROVED new articles as pages in blog/posts/.
//  (Posts from the old schedule go through seo-sync-queue.mjs + publish-due.mjs.)
//
//  Only an article that is `approved` AND has a valid approval of its exact
//  current version (hash match) is written. The page is rendered from the
//  approved revision with the site's own post design. The step then marks the
//  article `publishing`; scripts/seo-verify-published.mjs flips it to
//  `published` once the live page is confirmed.
//
//  Updates: an already-published article whose new version has been approved is
//  re-rendered over its page, keeping its original published date.
//
//  Run before publish-due.mjs, which adds the blog index card and sitemap entry.
// ════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { renderPost, publishedDateOf, SITE } from '../seo/lib/seo-post-render.mjs';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const today = process.env.PUBLISH_DATE || new Date().toISOString().slice(0, 10);
if (!process.env.DATABASE_URL) { console.log('No DATABASE_URL: nothing to publish.'); process.exit(0); }
const { neon } = await import('@neondatabase/serverless');
const q = (t, p = []) => neon(process.env.DATABASE_URL).query(t, p);

let rows, titles;
try {
  rows = await q(
    `SELECT a.id, a.slug, a.published_url, a.target_keyword, r.id AS rev_id, r.title, r.meta_description, r.content, r.meta
       FROM seo_articles a JOIN seo_article_revisions r ON r.id = a.current_revision_id
      WHERE a.status = 'approved' AND a.kind = 'post' AND a.source <> 'scheduled_queue'
        AND (a.scheduled_for IS NULL OR a.scheduled_for <= $1::date)
        AND EXISTS (SELECT 1 FROM seo_approvals p WHERE p.revision_id = r.id AND p.decision = 'approve' AND p.content_hash = r.content_hash)
      ORDER BY a.id`, [today]);
  titles = new Map((await q(`SELECT path, title FROM seo_pages`)).map((p) => [p.path, String(p.title || '').replace(/\s*\|.*$/, '')]));
} catch (e) { console.log('Approval queue unreachable, nothing published: ' + String(e.message).slice(0, 80)); process.exit(0); }

const relatedFor = (content, meta) => {
  const paths = [...new Set([...[...content.matchAll(/<a\s[^>]*href=["'](\/[^"'#?]*)["']/gi)].map((m) => m[1].replace(/\/+$/, '') || '/'), ...((meta.internal_links || []).map((l) => l.path))])];
  return paths.filter((p) => titles.has(p) && p !== '/').slice(0, 4).map((p) => ({ path: p, title: titles.get(p) }));
};

let published = 0, held = 0;
for (const r of rows) {
  const meta = r.meta || {};
  const slug = meta.slug || r.slug;
  const dest = path.join(ROOT, 'blog', 'posts', slug + '.html');
  const fail = async (why) => { console.log(`FAILED ${slug}: ${why}`); await q(`UPDATE seo_articles SET status='failed', last_error=$2 WHERE id=$1 AND status IN ('approved','publishing')`, [r.id, why.slice(0, 400)]); held++; };
  try {
    const exists = fs.existsSync(dest);
    if (exists && !r.published_url) { await fail('A page with this address already exists, so it was not overwritten.'); continue; }
    const date = (exists && publishedDateOf(fs.readFileSync(dest, 'utf8'))) || today;
    const html = renderPost(
      { title: r.title, meta_description: r.meta_description, slug, content: r.content, faqs: meta.faqs || [], keyword: meta.keyword || r.target_keyword, category: meta.category },
      { date, modified: today, related: relatedFor(r.content, meta) });
    const url = `${SITE}/blog/posts/${slug}`;
    const moved = await q(`UPDATE seo_articles SET status='publishing', published_url=$2, last_error=NULL WHERE id=$1 AND status='approved' RETURNING id`, [r.id, url]);
    if (!moved.length) continue; // someone changed it meanwhile
    fs.writeFileSync(dest, html);
    console.log(`${exists ? 'updated' : 'published'} blog/posts/${slug}.html`);
    published++;
  } catch (e) { await fail(String(e.message)); }
}
console.log(published || held ? `${published} page(s) written, ${held} failed` : 'no approved new posts to publish');
