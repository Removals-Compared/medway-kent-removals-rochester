// ════════════════════════════════════════════════════════════
//  Brings thin LIVE posts (the old bare page format) into the approval queue so
//  they can be rewritten properly. Nothing on the site changes: each post becomes
//  an article waiting for a redraft. The live page keeps its address; once a
//  rewrite is approved it replaces the page in place and keeps its original date.
//
//    node scripts/seo-import-published.mjs --db            every live post in the bare format
//    node scripts/seo-import-published.mjs --db --slugs a,b   only these
//
//  Safe to repeat: a post already in the queue is skipped.
// ════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { parseBarePost } from './seo-queue-lib.mjs';
import { checkDraft, allowedAmountsFrom, corpusEntry } from '../seo/lib/seo-quality-lib.mjs';

const args = process.argv.slice(2);
const val = (n) => { const i = args.indexOf('--' + n); return i > -1 ? args[i + 1] : null; };
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const SITE = 'https://www.medwaykentremovals.co.uk';
if (!args.includes('--db')) { console.error('Add --db to import into the database (DATABASE_URL required).'); process.exit(2); }
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is not set'); process.exit(2); }
const { neon } = await import('@neondatabase/serverless');
const q = (t, p = []) => neon(process.env.DATABASE_URL).query(t, p);

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const dir = path.join(ROOT, 'blog', 'posts');
const wanted = val('slugs') ? new Set(val('slugs').split(',').map((s) => s.trim())) : null;
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.html')).filter((f) => !wanted || wanted.has(f.replace(/\.html$/, '')));
const pricing = read('pricing.md'), facts = JSON.parse(read('seo/business-facts.json'));
const sitePaths = new Set((await q(`SELECT path FROM seo_pages`)).map((r) => r.path));
const ctxBase = { allowedAmounts: allowedAmountsFrom(pricing, facts.allowed_extra_amounts || []), sitePaths, corpus: [] };

let added = 0, skipped = 0;
for (const f of files.sort()) {
  const slug = f.replace(/\.html$/, '');
  const html = fs.readFileSync(path.join(dir, f), 'utf8');
  if (!/<article class="blog-post"/.test(html)) continue; // only the bare format here
  if ((await q(`SELECT 1 FROM seo_articles WHERE slug = $1`, [slug])).length) { skipped++; continue; }
  const p = parseBarePost(html, slug);
  const quality = checkDraft({ title: p.title, meta_description: p.meta_description, slug, content: p.content, keyword: '', hasImage: false }, { ...ctxBase, existingSlugs: new Set() });
  const art = (await q(
    `INSERT INTO seo_articles (slug, title, kind, status, source, published_url, published_at) VALUES ($1,$2,'post','planned','bot',$3,$4) RETURNING id`,
    [slug, p.title, `${SITE}/blog/posts/${slug}`, p.date]))[0];
  const meta = { slug, kind: 'post', source_file: `blog/posts/${f}`, blog_meta_html: p.blog_meta_html, imported_published: true, original_date: p.date };
  const rev = (await q(`INSERT INTO seo_article_revisions (article_id, version, title, meta_description, content, meta, created_by) VALUES ($1,1,$2,$3,$4,$5::jsonb,'import') RETURNING id, content_hash`, [art.id, p.title, p.meta_description, p.content, JSON.stringify(meta)]))[0];
  const report = { ...quality, revision_id: rev.id, content_hash: rev.content_hash, acknowledged: [], checked_at: new Date().toISOString() };
  const status = quality.critical_count > 0 ? 'needs_revision' : 'awaiting_approval';
  await q(`UPDATE seo_articles SET current_revision_id=$2, quality_score=$3, quality_report=$4::jsonb, status=$5 WHERE id=$1`, [art.id, rev.id, quality.score, JSON.stringify(report), status]);
  await q(`INSERT INTO seo_activity (actor, action, article_id, detail) VALUES ('import','published_imported',$1,$2)`, [art.id, `${slug}: ${quality.stats.words} words, ${status}`]);
  added++;
  console.log(`  imported ${slug}: ${quality.stats.words} words, ${status}`);
}
console.log(`Done: ${added} live post(s) added to the approval queue, ${skipped} already there. The live pages were not changed.`);
