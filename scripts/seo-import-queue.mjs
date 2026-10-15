// ════════════════════════════════════════════════════════════
//  One-off import: brings the old auto-publishing queue (blog/scheduled)
//  under the approval queue. Each future post becomes an article that is
//  AWAITING APPROVAL (or "needs revision" if the quality gate finds a
//  critical problem). Nothing is approved or published by this script.
//
//    node scripts/seo-import-queue.mjs --db [--from 2026-10-15]
//
//  Safe to re-run: a post already imported (same slug) is skipped.
// ════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { parseQueuedPost } from './seo-queue-lib.mjs';
import { checkDraft, allowedAmountsFrom, corpusEntry } from '../seo/lib/seo-quality-lib.mjs';

const args = process.argv.slice(2);
const val = (n) => { const i = args.indexOf('--' + n); return i > -1 ? args[i + 1] : null; };
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const from = val('from') || new Date().toISOString().slice(0, 10);
if (!args.includes('--db')) { console.error('Add --db to import into the database (DATABASE_URL required).'); process.exit(2); }
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is not set'); process.exit(2); }

const { neon } = await import('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
const q = (t, p = []) => sql.query(t, p);

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const htmlIn = (dir) => { try { return fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith('.html') && !f.endsWith('-block.html')).map((f) => path.join(dir, f)); } catch { return []; } };
const pricing = read('pricing.md');
const facts = JSON.parse(read('seo/business-facts.json'));
const sitePaths = new Set((await q(`SELECT path FROM seo_pages`)).map((r) => r.path));
const existingSlugs = new Set();
const corpus = [];
for (const f of [...htmlIn('.'), ...htmlIn('blog/posts')]) {
  const p = '/' + f.replace(/\.html$/, '');
  corpus.push(corpusEntry(p === '/index' ? '/' : p, read(f)));
  existingSlugs.add(path.basename(f, '.html'));
}
const ctx = { allowedAmounts: allowedAmountsFrom(pricing, facts.allowed_extra_amounts || []), sitePaths, existingSlugs, corpus };

const files = htmlIn('blog/scheduled').map((f) => path.basename(f)).filter((f) => f.slice(0, 10) >= from).sort();
console.log(`${files.length} queued posts dated ${from} or later`);
let added = 0, skipped = 0;
for (const f of files) {
  const p = parseQueuedPost(read(path.join('blog/scheduled', f)), f);
  if ((await q(`SELECT 1 FROM seo_articles WHERE slug = $1`, [p.slug])).length) { skipped++; console.log(`  skip (already imported): ${p.slug}`); continue; }
  const quality = checkDraft({ title: p.title, meta_description: p.meta_description, slug: p.slug, content: p.content, keyword: '', hasImage: false }, { ...ctx, existingSlugs: new Set([...existingSlugs].filter((s) => s !== p.slug)) });
  const art = (await q(
    `INSERT INTO seo_articles (slug, title, kind, status, source, scheduled_for) VALUES ($1,$2,'post','planned','scheduled_queue',$3) RETURNING id`,
    [p.slug, p.title, p.date]))[0];
  const meta = { slug: p.slug, kind: 'post', source_file: p.source_file, scheduled_for: p.date, blog_meta_html: p.blog_meta_html, imported: true };
  const rev = (await q(
    `INSERT INTO seo_article_revisions (article_id, version, title, meta_description, content, meta, created_by) VALUES ($1,1,$2,$3,$4,$5::jsonb,'import') RETURNING id, content_hash`,
    [art.id, p.title, p.meta_description, p.content, JSON.stringify(meta)]))[0];
  const report = { ...quality, revision_id: rev.id, content_hash: rev.content_hash, acknowledged: [], checked_at: new Date().toISOString() };
  const status = quality.critical_count > 0 ? 'needs_revision' : 'awaiting_approval';
  await q(`UPDATE seo_articles SET current_revision_id=$2, quality_score=$3, quality_report=$4::jsonb, status=$5 WHERE id=$1`, [art.id, rev.id, quality.score, JSON.stringify(report), status]);
  await q(`INSERT INTO seo_activity (actor, action, article_id, detail) VALUES ('import','queue_imported',$1,$2)`, [art.id, `${p.source_file}: ${status}, ${quality.critical_count} critical, ${quality.warn_count} warnings`]);
  added++;
  console.log(`  imported ${p.date} ${p.slug}: ${status} (critical ${quality.critical_count}, warnings ${quality.warn_count}, ${quality.stats.words} words)`);
}
console.log(`Done: ${added} imported, ${skipped} skipped. None approved or published.`);
